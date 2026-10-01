/**
 * Capa única de archivos del producto. Principio: ARCHIVOS → Cloudflare R2,
 * DATOS → Supabase. Toda subida/bajada de archivos pesados (cartolas, comprobantes,
 * PDFs, logos, imágenes) pasa por acá. R2 da 10 GB + egress ilimitado gratis (vs
 * 1 GB + 5 GB de Supabase) → no quemamos el free tier. Ver memoria
 * `reference_cloudflare_r2`.
 *
 * R2 SOLO se escribe desde el server (credenciales secretas). Las subidas
 * client-side deben ir por una ruta del server o una URL prefirmada.
 *
 * Esta es la foundation (S0a): expone el esquema de keys + el tipo de provider +
 * wrappers finos de R2. Las vueltas siguientes cablean subidas (S0b), lecturas
 * provider-aware (S0c) y la migración de lo existente (S0d).
 */
import { isR2Configured, uploadToR2, downloadFromR2, r2SignedGetUrl } from "./r2";

export type StorageProvider = "r2" | "supabase";

/** Proveedor por defecto para subidas NUEVAS: R2 si está configurado, si no Supabase. */
export function defaultStorageProvider(): StorageProvider {
  return isR2Configured() ? "r2" : "supabase";
}

/** Sanitiza un nombre de archivo para usarlo dentro de una key (sin rutas ni espacios). */
export function safeFileName(name: string): string {
  const clean = (name || "archivo").replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean.slice(-120) || "archivo";
}

/**
 * Key ordenada y única: `{empresaId}/{kind}/{año}/{uuid}__{nombre}`.
 * El año habilita reglas de antigüedad (lifecycle a Infrequent Access).
 */
export function buildStorageKey(empresaId: string, kind: string, originalName: string): string {
  const year = new Date().getUTCFullYear();
  const uuid = globalThis.crypto.randomUUID();
  return `${empresaId}/${kind}/${year}/${uuid}__${safeFileName(originalName)}`;
}

/** Sube bytes a R2 (server-only). Devuelve provider + key para guardar en la DB. */
export async function putFileR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<{ provider: StorageProvider; key: string; url: string | null }> {
  const { url } = await uploadToR2(key, body, contentType);
  return { provider: "r2", key, url };
}

/** Baja bytes de R2 como Buffer (server-only). */
export async function getFileR2(key: string): Promise<Buffer> {
  return downloadFromR2(key);
}

/** URL firmada de lectura de R2 (para servir un objeto privado por tiempo limitado). */
export async function signedUrlR2(key: string, expiresInSeconds = 3600): Promise<string> {
  return r2SignedGetUrl(key, expiresInSeconds);
}

/**
 * Sube un documento (cartola/comprobante) a R2 y devuelve la key + provider para
 * guardar en la DB. Solo R2 (server). Si no hay R2 configurado, el caller usa su
 * fallback de Supabase Storage.
 */
export async function subirDocumentoR2(
  empresaId: string,
  nombreArchivo: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<{ provider: StorageProvider; key: string }> {
  const key = buildStorageKey(empresaId, "documento", nombreArchivo);
  await putFileR2(key, body, contentType);
  return { provider: "r2", key };
}

/**
 * Descarga bytes de un documento según su provider. Para 'supabase' (legacy) usa
 * el downloader que provee el caller (que tiene el cliente Supabase).
 */
export async function descargarDocumento(
  provider: StorageProvider,
  path: string,
  supabaseDownload: (p: string) => Promise<Buffer>,
): Promise<Buffer> {
  if (provider === "r2") return getFileR2(path);
  return supabaseDownload(path);
}

/**
 * ¿Este path de storage pertenece a ESTA empresa? (auditoría 2026-10-01)
 *
 * /api/archivo baja con service role el storage_path (y los del álbum) que dice la
 * fila de documentos_subidos — y esa fila la puede escribir el propio usuario por
 * PostgREST. Sin este candado, poner en su fila el path de OTRA empresa le servía
 * el archivo ajeno. Todo path legítimo nace con el prefijo `{empresaId}/`:
 * buildStorageKey (R2: `{empresa}/{kind}/{año}/…`), subir-procesar e ingesta de
 * Telegram en Supabase (`{empresa}/{docId}/{nombre}`), PDFs del SII
 * (`{empresa}/boletas-sii-local/…`, `{empresa}/simpleapi-dte/…`).
 * Los marcadores sin archivo ("memoria", "album", "boleta-lote://…",
 * "sii-local-pdf-pendiente/…") no pasan — tampoco tenían bytes que servir.
 */
export function esPathDeEmpresa(path: unknown, empresaId: unknown): path is string {
  if (typeof path !== "string" || typeof empresaId !== "string" || !empresaId) return false;
  if (!path.startsWith(`${empresaId}/`)) return false;
  // Sin escapes del prefijo: ni "..", ni ".", ni separadores raros ni controles.
  if (/[\\\u0000-\u001f]/.test(path)) return false;
  return path.split("/").every((seg) => seg !== ".." && seg !== ".");
}
