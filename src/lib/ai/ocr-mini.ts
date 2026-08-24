/**
 * OCR local en el Mac mini (Apple Vision), como alternativa al OCR remoto.
 *
 * Por qué existe: el OCR remoto manda la foto COMPLETA del comprobante —con el
 * RUT y el nombre del tercero en píxeles— a un proveedor sin contrato. La
 * seudonimización de identidad opera sobre TEXTO, así que no alcanza a la
 * imagen. El mini corre Vision en local: la imagen no sale, es ~350 ms y cuesta
 * cero.
 *
 * Cómo funciona: se encola una fila en `ocr_jobs`; un trigger dispara NOTIFY y
 * el worker del mini —que está escuchando— la toma al instante, hace el OCR y
 * escribe el texto. Acá se espera ese resultado por sondeo corto.
 *
 * FAIL-OPEN A PROPÓSITO: si el mini no está, no contesta o falla, esta función
 * devuelve `null` y el llamador sigue por el camino remoto de siempre. Un mini
 * apagado NO puede dejar sin boleta a nadie. Es la única parte del sistema donde
 * fallar hacia adelante es lo correcto: el OCR no decide nada, solo transcribe.
 *
 * La fila se BORRA apenas se lee el texto: el resultado contiene identidad de
 * terceros y no queremos un silo nuevo de datos personales (mismo principio que
 * la bóveda efímera de `tokenize.ts`).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { isR2Configured, r2SignedGetUrl } from "../r2";

/** Cuánto se espera al mini antes de rendirse y usar el proveedor remoto. */
const ESPERA_MS = Number(process.env.OCR_MINI_TIMEOUT_MS || 8_000);
const SONDEO_MS = 250;
/** Vida de la URL firmada: solo tiene que durar lo que el mini tarda en bajarla. */
const URL_TTL_S = 300;

/**
 * ¿Está encendido el carril del mini? Apagado por defecto: encenderlo es una
 * decisión explícita por entorno, no algo que pase solo al desplegar.
 */
export function ocrMiniHabilitado(): boolean {
  return process.env.OCR_MINI_ENABLED === "1" || process.env.OCR_MINI_ENABLED === "true";
}

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cómo le pasamos la imagen al mini.
 *
 * Si está en R2, una URL firmada de vida corta: el mini no necesita credenciales
 * y la fila de la cola queda liviana. Si solo tenemos los bytes en memoria, un
 * `data:` URL — funciona igual, pero engorda la fila, así que es el plan B.
 */
async function urlDeImagen(
  storagePath: string | null | undefined,
  storageProvider: string | null | undefined,
  base64: string,
  mimeType: string,
): Promise<string> {
  if (storagePath && storageProvider === "r2" && isR2Configured()) {
    try {
      return await r2SignedGetUrl(storagePath, URL_TTL_S);
    } catch {
      // Si firmar falla, seguimos con los bytes que ya tenemos en memoria.
    }
  }
  return `data:${mimeType};base64,${base64}`;
}

export interface OcrMiniArgs {
  base64: string;
  mimeType: string;
  empresaId?: string | null;
  documentoId?: string | null;
  storagePath?: string | null;
  storageProvider?: string | null;
  timeoutMs?: number;
}

/**
 * Intenta el OCR en el mini. Devuelve el texto, o `null` si el carril no está
 * disponible o no respondió a tiempo (el llamador debe caer al remoto).
 */
export async function ocrConMini(args: OcrMiniArgs): Promise<{ text: string; ms: number } | null> {
  if (!ocrMiniHabilitado()) return null;
  const db = svc();
  if (!db) return null;

  const limite = args.timeoutMs ?? ESPERA_MS;
  let jobId: string | null = null;

  try {
    const imageUrl = await urlDeImagen(args.storagePath, args.storageProvider, args.base64, args.mimeType);

    const { data: creado, error } = await db
      .from("ocr_jobs")
      .insert({
        empresa_id: args.empresaId ?? null,
        documento_id: args.documentoId ?? null,
        storage_path: args.storagePath ?? "memoria",
        storage_provider: args.storageProvider ?? "memoria",
        metadata: { image_url: imageUrl, mime: args.mimeType } as unknown as Json,
      })
      .select("id")
      .single();
    if (error || !creado) return null;
    jobId = creado.id;

    const t0 = Date.now();
    while (Date.now() - t0 < limite) {
      await dormir(SONDEO_MS);
      const { data: fila } = await db
        .from("ocr_jobs")
        .select("estado, resultado")
        .eq("id", jobId)
        .maybeSingle();
      if (!fila) return null;

      if (fila.estado === "listo") {
        const r = fila.resultado as { text?: unknown } | null;
        const text = typeof r?.text === "string" ? r.text : "";
        // Sin texto útil no sirve de nada: mejor que el remoto lo intente.
        if (!text.trim()) return null;
        return { text, ms: Date.now() - t0 };
      }
      if (fila.estado === "error") return null;
    }
    return null; // se acabó la espera → el llamador usa el remoto
  } catch {
    return null;
  } finally {
    // El texto extraído lleva identidad de terceros: se borra apenas se usa, para
    // no crear un silo nuevo de datos personales. Si el mini estaba lento y llega
    // después, el borrado también evita trabajo huérfano.
    if (jobId) {
      await db.from("ocr_jobs").delete().eq("id", jobId).then(
        () => {},
        () => {},
      );
    }
  }
}
