import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { validarBoleta, type BoletaInput } from "@/lib/sii/validation";
import { obtenerConfigEmision, providerForTipoDte } from "@/lib/intermediario/client";
import { chileDateString } from "@/lib/chile-date";
import { issueMockBoleta } from "@/lib/emission/mock";
import { blockUnsupportedBackendProvider } from "@/lib/emission/provider-guards";

/**
 * Capa intermediaria (emula Haulmer / OpenFactura).
 * Recibe datos simples del usuario, valida, consume folio del CAF,
 * genera el XML DTE, lo "envía" al SII mock, y persiste la boleta.
 *
 * Si en el futuro se cambia a integración real, solo se reemplaza la
 * llamada interna a /api/sii-mock/dte/recibir por la URL real del SII
 * — la app no se entera.
 */

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[emitir-boleta] error no controlado", error);
    return NextResponse.json(
      { ok: false, error: "EMITIR_BOLETA_FAILED", detalle: error instanceof Error ? error.message : "Error inesperado" },
      { status: 500 },
    );
  }
}

async function handlePost(request: Request) {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas(rut, razon_social, giro, direccion, comuna)")
    .eq("id", user.id)
    .single();
  if (!usuario || !usuario.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  const empresa = usuario.empresas as unknown as {
    rut: string; razon_social: string; giro: string | null; direccion: string | null; comuna: string | null;
  } | null;
  if (!empresa?.rut || !empresa?.razon_social) {
    return NextResponse.json(
      { ok: false, error: "EMPRESA_SIN_DATOS_FISCALES", detalle: "Empresa debe tener RUT y razón social configurados" },
      { status: 422 },
    );
  }

  // DEMO: omitimos verificación de certificado SII.
  // En producción: const certCheck = await verificarCertificado(usuario.empresa_id);

  // 2. Parse body
  let body: BoletaInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // 3. Validar usando reglas del SII
  const validation = validarBoleta(body);
  if (!validation.ok || !validation.totales) {
    return NextResponse.json(
      { ok: false, error: "VALIDACION_FALLIDA", errores: validation.errors },
      { status: 422 },
    );
  }

  // 4. Service client para folio + insert (bypassea RLS controlado por la lógica del endpoint)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient(url, key);
  const emisionConfig = await obtenerConfigEmision(usuario.empresa_id).catch(() => null);
  if (!emisionConfig) {
    return NextResponse.json(
      { ok: false, error: "EMISION_CONFIG_ERROR", detalle: "No se pudo leer el proveedor de emisión de la empresa" },
      { status: 500 },
    );
  }
  const proveedorEfectivo = providerForTipoDte(emisionConfig, body.tipo_dte);
  if (process.env.NODE_ENV !== "production") {
    console.info("[emitir-boleta] proveedor efectivo", {
      empresaId: usuario.empresa_id,
      tipoDte: body.tipo_dte,
      proveedor: proveedorEfectivo,
    });
  }

  const providerBlock = blockUnsupportedBackendProvider(proveedorEfectivo);
  if (providerBlock) return providerBlock;

  // 5. Mock consume CAF local. Otros proveedores no deben caer a este carril.
  const fecha_emision = chileDateString();
  const fechaEmisionReal = fecha_emision;
  const proveedorRespuesta: Record<string, unknown> | null = null;

  if (proveedorEfectivo !== "mock") {
    return NextResponse.json(
      { ok: false, error: "PROVEEDOR_NO_IMPLEMENTADO", detalle: "Este proveedor no tiene carril backend habilitado para emisión directa." },
      { status: 502 },
    );
  }

  const mockIssue = await issueMockBoleta({
    sb,
    empresaId: usuario.empresa_id,
    empresa,
    body,
    totales: validation.totales,
    fechaEmision: fechaEmisionReal,
  });
  if (!mockIssue.ok) {
    return NextResponse.json(
      { ok: false, error: mockIssue.error, codigo_rechazo: mockIssue.codigo_rechazo, detalle: mockIssue.detalle },
      { status: mockIssue.status },
    );
  }

  // 8. Persistir boleta
  const { data: boleta, error: insertErr } = await sb
    .from("boletas_emitidas")
    .insert({
      empresa_id: usuario.empresa_id,
      tipo_dte: body.tipo_dte,
      folio: mockIssue.folio,
      caf_id: mockIssue.cafId,
      fecha_emision: fechaEmisionReal,
      emisor_rut: empresa.rut,
      emisor_razon_social: empresa.razon_social,
      emisor_giro: empresa.giro,
      emisor_direccion: empresa.direccion,
      emisor_comuna: empresa.comuna,
      receptor_rut: body.receptor_rut ?? null,
      receptor_razon_social: body.receptor_razon_social ?? null,
      receptor_direccion: body.receptor_direccion ?? null,
      receptor_comuna: body.receptor_comuna ?? null,
      monto_neto: validation.totales.neto,
      monto_exento: validation.totales.exento,
      iva: validation.totales.iva,
      monto_total: validation.totales.total,
      detalles: body.detalles,
      xml_dte: mockIssue.xmlDte,
      ted: mockIssue.ted,
      track_id: mockIssue.trackId,
      estado: mockIssue.estadoPersistencia,
      emision_proveedor: proveedorEfectivo,
      emision_sandbox: false,
      proveedor_respuesta: proveedorRespuesta,
    })
    .select("id, folio, monto_total, estado, track_id, fecha_emision")
    .single();

  if (insertErr || !boleta) {
    return NextResponse.json(
      { ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message },
      { status: 500 },
    );
  }

  const receptorLabel = body.receptor_razon_social?.trim() || "consumidor final";
  const { error: docInsertErr } = await sb.from("documentos_subidos").insert({
    empresa_id: usuario.empresa_id,
    nombre_archivo: `Boleta unica #${boleta.folio} - ${receptorLabel}`,
    tipo: "boleta_unica",
    storage_path: `boleta-unica://${boleta.id}`,
    estado: "procesado",
    movimientos_detectados: 1,
    created_at: `${fechaEmisionReal}T12:00:00.000Z`,
    progreso_ia: {
      origen: "emision_directa",
      proveedor: proveedorEfectivo,
      sandbox: false,
      boleta_id: boleta.id,
      folio: boleta.folio,
      tipo_dte: body.tipo_dte,
      monto_total: boleta.monto_total,
      receptor: receptorLabel,
      etiqueta: "Boleta unica",
    },
  });

  return NextResponse.json({
    ok: true,
    boleta_id: boleta.id,
    folio: boleta.folio,
    tipo_dte: body.tipo_dte,
    fecha_emision: boleta.fecha_emision,
    monto_total: boleta.monto_total,
    track_id: boleta.track_id,
    estado: boleta.estado,
    registro_agregados: docInsertErr ? "warning" : "ok",
    proveedor: proveedorEfectivo,
    sandbox: false,
    mensaje: `Boleta tipo ${body.tipo_dte} folio ${boleta.folio} emitida (${proveedorEfectivo})`,
  });
}

export const dynamic = "force-dynamic";
