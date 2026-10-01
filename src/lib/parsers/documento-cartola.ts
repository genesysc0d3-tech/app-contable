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
  return tipo === "excel" || tipo === "csv";
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

type DocArchivo = { id: string; storage_provider: string | null; storage_path: string };

// El resumen en vivo se pide varias veces seguidas mientras el cliente acomoda
// las columnas: el archivo se guarda unos minutos en memoria de la instancia
// para no bajarlo de nuevo en cada cambio. Clave = documento (ya validado por empresa).
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 8;
const cache = new Map<string, { en: number; buf: ArrayBuffer }>();

export async function bajarArchivoCartola(sb: SupabaseClient, doc: DocArchivo, opts: { cache?: boolean } = {}): Promise<ArrayBuffer> {
  const key = `${doc.id}:${doc.storage_path}`;
  const hit = opts.cache ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.en < CACHE_MS) return hit.buf;
  const provider = doc.storage_provider === "r2" ? "r2" : "supabase";
  const bajar = async (path: string): Promise<Buffer> => {
    const { data, error } = await sb.storage.from("documentos").download(path);
    if (error || !data) throw new Error("no file");
    return Buffer.from(await data.arrayBuffer());
  };
  const fileBuf = await descargarDocumento(provider, doc.storage_path, bajar);
  const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength) as ArrayBuffer;
  if (opts.cache) {
    cache.set(key, { en: Date.now(), buf });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return buf;
}

/** Cliente service-role (lecturas de parser_logs/parser_adapters filtradas por empresa, auditoría). */
export function clienteServicio(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createServiceClient<Database>(url, key) : null;
}
