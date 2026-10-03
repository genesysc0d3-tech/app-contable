import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { descargarDocumento } from "@/lib/storage";
import type { AdapterConfig } from "./types";

/**
 * Piezas compartidas de las rutas del popup "Revisa las columnas"
 * (/api/parser/preview, /resumen y /save-mapping): validar el mapa que manda el
 * navegador y bajar el archivo de la cartola.
 */

/**
 * ¿Este documento se lee con el lector de planillas (y por eso puede pedir
 * "Revisa las columnas")? Excel y CSV: queue.ts manda ambos a parseExcel. Si
 * las rutas del popup rechazaran el CSV, su cartola quedaría con el CTA para
 * siempre y sin Editar/Aprobar (revisión adversarial 2026-09-30).
 */
export function esPlanillaMapeable(tipo: string | null | undefined): boolean {
  // PDF (2026-10-02): la cola lo lee con el mismo lector que el Excel, sobre la
  // grilla armada por posiciones (pdf-grilla.ts). Sin sello pide "Revisa las
  // columnas" igual que una planilla, y el popup ve ESA misma grilla. Un PDF que
  // el router no clasifica como cartola no arma grilla (bajarArchivoCartola falla).
  return tipo === "excel" || tipo === "csv" || tipo === "pdf";
}

/** ¿El mapa que llega del navegador tiene la forma mínima? (el server no confía en la UI) */
export function configValida(cfg: unknown): cfg is AdapterConfig {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Partial<AdapterConfig>;
  if (typeof c.header_row !== "number" || typeof c.skip_rows_before_data !== "number") return false;
  if (!c.columns || typeof c.columns !== "object") return false;
  return typeof c.columns.fecha === "number" && typeof c.columns.descripcion === "number";
}

/**
 * Lo que el navegador puede decidir de un mapa: columnas, filas y formatos.
 * Nunca la revisión del cliente, la cuenta ni los títulos (los pone el server).
 */
export function configDelCliente(cfg: AdapterConfig): AdapterConfig {
  const { revision_cliente: _r, cuenta_huella: _c, titulos: _t, plantilla: _p, plantilla_cols: _pc, ...resto } = cfg;
  return resto;
}

type DocArchivo = { id: string; storage_provider: string | null; storage_path: string; tipo?: string | null; empresa_id?: string | null };

// El resumen en vivo se pide varias veces seguidas mientras el cliente acomoda
// las columnas: el archivo se guarda unos minutos en memoria de la instancia
// para no bajarlo de nuevo en cada cambio. Clave = documento (ya validado por empresa).
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 8;
const cache = new Map<string, { en: number; buf: ArrayBuffer; pdfSinMarcaBanco: boolean }>();

export async function bajarArchivoCartola(sb: SupabaseClient, doc: DocArchivo, opts: { cache?: boolean } = {}): Promise<ArrayBuffer> {
  return (await bajarCartola(sb, doc, opts)).buf;
}

/**
 * Como bajarArchivoCartola, y además si es un PDF SIN marca propia de banco
 * (pdf-router.ts `marca_banco` null): el popup no puede pintarlo "cuadra con tu
 * banco" y pregunta "¿Este PDF es de tu banco?" (vuelta 6, A2).
 */
export async function bajarCartola(sb: SupabaseClient, doc: DocArchivo, opts: { cache?: boolean } = {}): Promise<{ buf: ArrayBuffer; pdfSinMarcaBanco: boolean; bancoConfirmado: boolean }> {
  const key = `${doc.id}:${doc.storage_path}`;
  const hit = opts.cache ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.en < CACHE_MS) return conConfirmacion(hit.buf, hit.pdfSinMarcaBanco, doc.empresa_id);
  const provider = doc.storage_provider === "r2" ? "r2" : "supabase";
  const bajar = async (path: string): Promise<Buffer> => {
    const { data, error } = await sb.storage.from("documentos").download(path);
    if (error || !data) throw new Error("no file");
    return Buffer.from(await data.arrayBuffer());
  };
  const fileBuf = await descargarDocumento(provider, doc.storage_path, bajar);
  const { buf, pdfSinMarcaBanco } = doc.tipo === "pdf"
    ? await libroDeCartolaPdf(sb, doc, new Uint8Array(fileBuf))
    : { buf: fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength) as ArrayBuffer, pdfSinMarcaBanco: false };
  if (opts.cache) {
    cache.set(key, { en: Date.now(), buf, pdfSinMarcaBanco });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  // La confirmación del cliente se consulta en cada llamada (no se guarda en la
  // caché): cambia en cuanto dice "Sí, es mi cartola".
  return conConfirmacion(buf, pdfSinMarcaBanco, doc.empresa_id);
}

/** `bancoConfirmado`: el PDF no trae marca, pero el cliente ya dijo que su formato es de su banco. */
async function conConfirmacion(buf: ArrayBuffer, sinMarca: boolean, empresaId: string | null | undefined) {
  const bancoConfirmado = sinMarca && await bancoConfirmadoPorCliente(buf, empresaId);
  return { buf, pdfSinMarcaBanco: sinMarca && !bancoConfirmado, bancoConfirmado };
}

/**
 * ¿La EMPRESA ya dijo "Sí, es mi cartola" para este formato (vuelta 6, M1)? El
 * mismo criterio que el orquestador: el mapa que elige la caché para esta
 * huella es PROPIO de la empresa y trae revision_cliente.es_banco. Así el popup
 * no vuelve a preguntar lo que el cliente ya respondió.
 */
async function bancoConfirmadoPorCliente(buf: ArrayBuffer, empresaId: string | null | undefined): Promise<boolean> {
  if (!empresaId) return false;
  try {
    const XLSX = await import("xlsx");
    const { leerLibroCartola } = await import("./libro");
    const { computeFingerprint } = await import("./fingerprint");
    const { getAdapterByFingerprint } = await import("./adapter-store");
    const wb = leerLibroCartola(buf, {});
    const rows = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<import("./types").Row>(wb.Sheets[n], { header: 1, defval: "" })).find((r) => r.length);
    if (!rows) return false;
    const a = await getAdapterByFingerprint(computeFingerprint(rows), empresaId);
    return !!a && a.creado_por_empresa_id === empresaId && !!a.config?.revision_cliente?.es_banco && !a.config.revision_cliente.no_es_cartola;
  } catch {
    return false;
  }
}

/**
 * Cartola PDF → la MISMA grilla (.xlsx de texto) que leyó la cola, para que el
 * popup muestre y mapee exactamente lo que el lector vio. Con clave: las mismas
 * variantes del RUT de la empresa que prueba la cola (nunca se persisten).
 */
async function libroDeCartolaPdf(sb: SupabaseClient, doc: DocArchivo, pdf: Uint8Array): Promise<{ buf: ArrayBuffer; pdfSinMarcaBanco: boolean }> {
  const { leerItemsPdf, libroDesdeGrilla } = await import("./pdf-grilla");
  const { clasificarPdf } = await import("./pdf-router");
  const { esErrorDeClavePdf, variantesClaveDesdeRut } = await import("@/lib/document-processing/pdf-protegido");
  let leido: Awaited<ReturnType<typeof leerItemsPdf>> | undefined;
  try {
    leido = await leerItemsPdf(pdf);
  } catch (error) {
    if (!esErrorDeClavePdf(error) || !doc.empresa_id) throw error;
    const { data: empresa } = await sb.from("empresas").select("rut").eq("id", doc.empresa_id).maybeSingle();
    for (const clave of variantesClaveDesdeRut((empresa as { rut?: string } | null)?.rut)) {
      try { leido = await leerItemsPdf(pdf, clave); break; } catch (e) { if (!esErrorDeClavePdf(e)) throw e; }
    }
    if (!leido) throw error;
  }
  // Mismo criterio que la cola: el popup es solo para un PDF que el ROUTER
  // clasificó como cartola, y bajo el tope de páginas.
  if (leido.truncado) throw new Error("PDF con demasiadas páginas");
  const ruta = clasificarPdf(leido.items);
  if (ruta.tipo !== "cartola" || !ruta.rows.length) throw new Error("El PDF no es una cartola");
  return { buf: libroDesdeGrilla(ruta.rows), pdfSinMarcaBanco: !ruta.marca_banco };
}

/** Cliente service-role (lecturas de parser_logs/parser_adapters filtradas por empresa, auditoría). */
export function clienteServicio(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createServiceClient<Database>(url, key) : null;
}
