/**
 * Cliente "intermediario" — capa que emula un proveedor externo tipo
 * Haulmer/OpenFactura. La app nunca habla directo con el SII: habla con este
 * cliente, y el cliente a su vez habla con el SII mock.
 *
 * Responsabilidades que replica fielmente de la realidad:
 *   1. Verificar que el contribuyente delegó su certificado digital al
 *      intermediario (en prod: `.pfx` + clave tributaria subidos; acá: flag
 *      `empresas.tiene_certificado_sii = true`).
 *   2. Gestionar los CAFs automáticamente: si al momento de emitir no hay
 *      folios, el intermediario (actuando como mandatario del contribuyente)
 *      solicita un CAF nuevo al SII y reintenta. El usuario final NUNCA pide
 *      folios a mano — así funciona Haulmer real.
 *   3. Enviar el XML DTE al SII y devolver track_id + estado.
 *   4. Consultar estado posterior del DTE.
 *
 * Cuando se integre con un intermediario real (Haulmer, OpenFactura, etc.),
 * basta reemplazar las implementaciones de estas funciones por fetches HTTP
 * a su API. La firma pública del módulo queda estable.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  recibirDTE,
  consultarEstadoDTE,
  mapEstadoSiiAPersistencia,
  type EstadoDTESII,
} from "@/lib/sii-mock/recepcion";

// Cantidad por defecto que el intermediario pide al SII cuando detecta que
// el contribuyente se está quedando sin folios. Haulmer/OpenFactura usan
// lógicas similares (solicitan "batches" de 50-100 folios a la vez).
const CAF_BATCH_SIZE = 50;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("BACKEND_CONFIG_MISSING");
  return createServiceClient<Database>(url, key);
}

export interface VerificacionCertificado {
  ok: boolean;
  error?: "NO_CERTIFICADO" | "EMPRESA_NO_ENCONTRADA";
  mensaje?: string;
}

/**
 * Verifica que la empresa tenga certificado digital delegado al intermediario.
 * Sin esto, Haulmer real no podría firmar en nombre del contribuyente.
 */
export async function verificarCertificado(
  empresaId: string,
): Promise<VerificacionCertificado> {
  const sb = serviceClient();
  const { data } = await sb
    .from("empresas")
    .select("tiene_certificado_sii")
    .eq("id", empresaId)
    .maybeSingle();
  if (!data) return { ok: false, error: "EMPRESA_NO_ENCONTRADA", mensaje: "Empresa no encontrada" };
  if (!data.tiene_certificado_sii) {
    return {
      ok: false,
      error: "NO_CERTIFICADO",
      mensaje: "El intermediario no puede emitir: el contribuyente aún no cargó su certificado digital SII",
    };
  }
  return { ok: true };
}

/**
 * Asegura que haya un CAF activo con folios disponibles para la empresa+tipo.
 * Si no lo hay, "solicita" un CAF nuevo al SII mock de forma automática
 * (replicando el comportamiento de Haulmer/OpenFactura reales, que gestionan
 * el timbraje de forma transparente).
 *
 * Idempotente: si ya hay folios, no hace nada.
 */
export async function asegurarFoliosDisponibles(
  empresaId: string,
  tipoDte: 33 | 34 | 39 | 41 | 61,
): Promise<{ ok: boolean; solicitado?: boolean; error?: string }> {
  const sb = serviceClient();

  // 1. ¿Hay CAF activo con folios disponibles?
  const { data: activos } = await sb
    .from("boletas_caf_mock")
    .select("folio_actual, folio_hasta")
    .eq("empresa_id", empresaId)
    .eq("tipo_dte", tipoDte)
    .eq("estado", "activo")
    .gt("fecha_vence", new Date().toISOString());

  const totalDisponibles = (activos ?? []).reduce(
    (s: number, c: { folio_actual: number; folio_hasta: number }) =>
      s + Math.max(0, c.folio_hasta - c.folio_actual + 1),
    0,
  );
  if (totalDisponibles > 0) return { ok: true, solicitado: false };

  // 2. No hay — solicitar al SII mock un rango nuevo. Continuar la secuencia.
  const { data: last } = await sb
    .from("boletas_caf_mock")
    .select("folio_hasta")
    .eq("empresa_id", empresaId)
    .eq("tipo_dte", tipoDte)
    .order("folio_hasta", { ascending: false })
    .limit(1)
    .maybeSingle();

  const folio_desde = ((last?.folio_hasta as number | undefined) ?? 0) + 1;
  const folio_hasta = folio_desde + CAF_BATCH_SIZE - 1;

  const { error } = await sb.from("boletas_caf_mock").insert({
    empresa_id: empresaId,
    tipo_dte: tipoDte,
    folio_desde,
    folio_hasta,
    folio_actual: folio_desde,
    estado: "activo",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, solicitado: true };
}

export interface EnvioResultado {
  ok: boolean;
  track_id?: string;
  estado_sii?: EstadoDTESII;
  estado_persistencia?: "aceptado" | "aceptado_reparos" | "rechazado";
  mensaje?: string;
  codigo_rechazo?: string;
  detalle?: string;
}

export type ProveedorBoletas = "mock" | "sii_local" | "simpleapi";
export type ProveedorFacturas = "mock" | "sii_local" | "simpleapi";
export type ProveedorEmision = ProveedorBoletas | ProveedorFacturas;

export interface ConfigEmision {
  proveedor: ProveedorEmision;
  boletasProveedor: ProveedorBoletas;
  facturasProveedor: ProveedorFacturas;
  // Columna legacy: se conserva para migraciones/datos antiguos; BaseAPI ya no es un carril activo.
  baseapiSandbox: boolean;
}

function normalizeBoletasProvider(raw: string | null | undefined): ProveedorBoletas {
  if (raw === "sii_local") return "sii_local";
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

function normalizeFacturasProvider(raw: string | null | undefined): ProveedorFacturas {
  // Carril real de facturas: la extensión en el Sistema de Facturación
  // Gratuito del SII (mismo motor local que boletas).
  if (raw === "sii_local") return "sii_local";
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

export function providerForTipoDte(config: ConfigEmision, tipoDte: number): ProveedorEmision {
  if (tipoDte === 33 || tipoDte === 34) return config.facturasProveedor;
  return config.boletasProveedor;
}

export async function obtenerConfigEmision(empresaId: string): Promise<ConfigEmision> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("empresas")
    .select("emision_proveedor, emision_baseapi_sandbox, boletas_emision_proveedor, facturas_emision_proveedor")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    const message = String(error.message || "");
    if (/emision_proveedor|emision_baseapi_sandbox|boletas_emision_proveedor|facturas_emision_proveedor|column/i.test(message)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[emision-config] columnas de proveedor no disponibles; usando mock", {
          empresaId,
          error: message,
        });
      }
      return { proveedor: "mock", boletasProveedor: "mock", facturasProveedor: "mock", baseapiSandbox: true };
    }
    throw new Error(`EMISION_CONFIG_QUERY_FAILED: ${message}`);
  }
  if (!data) throw new Error("EMISION_CONFIG_EMPRESA_NOT_FOUND");

  const rawProveedor = data?.emision_proveedor;
  const legacyProveedor = normalizeBoletasProvider(rawProveedor);
  const boletasProveedor = normalizeBoletasProvider(data?.boletas_emision_proveedor ?? rawProveedor);
  const facturasProveedor = normalizeFacturasProvider(data?.facturas_emision_proveedor);
  const config: ConfigEmision = {
    proveedor: boletasProveedor ?? legacyProveedor,
    boletasProveedor,
    facturasProveedor,
    baseapiSandbox: data?.emision_baseapi_sandbox !== false,
  };

  if (process.env.NODE_ENV !== "production") {
    console.info("[emision-config]", {
      empresaId,
      rawProveedor: data?.emision_proveedor ?? null,
      proveedor: config.proveedor,
      boletasProveedor: config.boletasProveedor,
      facturasProveedor: config.facturasProveedor,
      baseapiSandbox: config.baseapiSandbox,
    });
  }

  return config;
}

/**
 * Envía un DTE (XML) al SII a través del intermediario. En el mock actual,
 * llamamos directo al módulo de recepción; en producción sería un fetch al
 * API del intermediario real.
 */
export async function enviarDTE(xml_dte: string): Promise<EnvioResultado> {
  const r = recibirDTE(xml_dte);
  if (!r.ok) {
    return {
      ok: false,
      codigo_rechazo: r.codigo_rechazo,
      detalle: r.detalle,
      mensaje: r.error,
    };
  }
  return {
    ok: true,
    track_id: r.track_id,
    estado_sii: r.estado,
    estado_persistencia: mapEstadoSiiAPersistencia(r.estado),
    mensaje: r.mensaje,
  };
}

export interface EstadoResultado {
  ok: boolean;
  track_id: string;
  estado_sii: EstadoDTESII;
  estado_persistencia: "aceptado" | "aceptado_reparos" | "rechazado";
  glosa: string;
}

/**
 * Consulta el estado posterior de un DTE (el intermediario hace polling al
 * SII hasta que confirma aceptación).
 */
export async function consultarEstado(track_id: string): Promise<EstadoResultado> {
  const r = consultarEstadoDTE(track_id);
  return {
    ok: r.ok,
    track_id: r.track_id,
    estado_sii: r.estado,
    estado_persistencia: mapEstadoSiiAPersistencia(r.estado),
    glosa: r.glosa,
  };
}
