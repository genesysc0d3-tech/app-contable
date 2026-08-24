/**
 * OCR de imágenes (screenshots/fotos de comprobantes).
 *
 * Dos carriles, en orden: primero el Mac mini (Apple Vision en local — la imagen
 * no sale de la casa, ~350 ms, gratis; ver ocr-mini.ts), y si no está disponible
 * se cae al remoto de abajo. Punto ÚNICO de OCR del producto: lo usan cartolas,
 * Telegram y comprobantes sueltos, así que cambiar de motor se hace solo acá.
 *
 * - Lectura de imagen: MiniMax M3 (multimodal, modelo de pago de Go → no
 *   entrena con los datos). Confirmado leyendo comprobantes chilenos.
 * - Agrupado de varias imágenes de la misma operación: DeepSeek V4 Flash.
 *
 * Sin OpenCode: todo bajo la suscripción Go que ya se paga. Cloudflare frente
 * a OpenCode responde 1010 sin firma de navegador → se manda User-Agent.
 */

import { requirePaidModel } from "./model-guard";
import { fetchOpenCodeStreaming } from "./opencode-stream";
import { assertApprovedDataProcessor } from "./egress";
import { ocrConMini, ocrMiniHabilitado } from "./ocr-mini";

const OPENCODE_BASE = "https://opencode.ai/zen/go/v1";
const OCR_MODEL = process.env.OPENCODE_OCR_MODEL || "minimax-m3";
const GROUP_MODEL = process.env.OPENCODE_GO_MODEL || "deepseek-v4-flash";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const OCR_PROMPT =
  "Extrae TODO el texto visible en esta imagen. Mantén la estructura, fechas, nombres y campos exactos. Si es un chat, preserva quién dice qué; si es un comprobante, preserva todos los campos.\n" +
  "MONTOS (pesos chilenos): el punto es separador de MILES, NO decimal. '$53.000' son cincuenta y tres mil pesos. Transcribe cada monto como número entero sin puntos ni símbolo: '$53.000' → 53000, '$1.250.000' → 1250000.\n" +
  "Responde solo con el texto, sin explicaciones.";

interface OcrResult {
  text: string;
  tokens_input: number;
  tokens_output: number;
}

/** Quita el bloque de razonamiento <think>…</think> que algunos modelos anteponen. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function openCodeChat(
  model: string,
  content: string | Array<Record<string, unknown>>,
  timeoutMs = 120_000,
): Promise<{ text: string; tokens_input: number; tokens_output: number }> {
  const apiKey = process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) throw new Error("OPENCODE_GO_API_KEY no configurada");
  requirePaidModel(model, "ocr");
  // Gate fail-closed (Ley 21.719): la imagen/datos de terceros solo van a un
  // procesador aprobado con retención cero.
  assertApprovedDataProcessor("opencodego", model);

  // Streaming SIEMPRE: el gateway de OpenCode corta las respuestas no-stream a
  // los ~80s (regresión 2026-08-19). Timeout por inactividad, no total — ver
  // opencode-stream.ts.
  try {
    const data = await fetchOpenCodeStreaming({
      url: `${OPENCODE_BASE}/chat/completions`,
      apiKey,
      idleTimeoutMs: timeoutMs,
      extraHeaders: { "User-Agent": BROWSER_UA },
      body: {
        model,
        temperature: 0.1,
        messages: [{ role: "user", content }],
      },
    });
    return {
      text: stripThink(data.content),
      tokens_input: data.tokens_input,
      tokens_output: data.tokens_output,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenCode ${model}: sin respuesta en ${timeoutMs}ms (timeout de inactividad)`);
    }
    throw err;
  }
}

/** De dónde viene la imagen, para que el mini pueda bajarla sin credenciales. */
export interface OcrContexto {
  empresaId?: string | null;
  documentoId?: string | null;
  storagePath?: string | null;
  storageProvider?: string | null;
}

/**
 * Extrae texto de una imagen.
 *
 * Primero intenta el mini (Vision local: la imagen no sale del país, ~350 ms,
 * gratis). Si el carril está apagado, el mini no responde o falla, cae al
 * proveedor remoto — un mini caído nunca puede dejar sin boleta a nadie.
 */
export async function ocrImage(
  imageBase64: string,
  mimeType: string,
  timeoutMs = 120_000,
  ctx?: OcrContexto,
): Promise<OcrResult> {
  if (ocrMiniHabilitado()) {
    const local = await ocrConMini({
      base64: imageBase64,
      mimeType,
      empresaId: ctx?.empresaId,
      documentoId: ctx?.documentoId,
      storagePath: ctx?.storagePath,
      storageProvider: ctx?.storageProvider,
    });
    // El mini no consume tokens de ningún proveedor: por eso van en cero.
    if (local) return { text: local.text, tokens_input: 0, tokens_output: 0 };
  }

  return openCodeChat(OCR_MODEL, [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
    { type: "text", text: OCR_PROMPT },
  ], timeoutMs);
}

/**
 * OCR de varias imágenes y agrupado de las relacionadas (misma operación).
 * Devuelve el texto agrupado listo para el pipeline de clasificación.
 */
export async function ocrAndGroupImages(
  images: {
    base64: string;
    mimeType: string;
    fileName: string;
    /** Ruta en el storage: deja que el mini baje la imagen sin credenciales. */
    storagePath?: string | null;
    storageProvider?: string | null;
  }[],
  opts?: { skipGrouping?: boolean; ocrTimeoutMs?: number; contexto?: OcrContexto },
): Promise<{
  groupedText: string;
  totalTokensInput: number;
  totalTokensOutput: number;
}> {
  const ocrResults = await Promise.all(
    images.map(async (img) => {
      const result = await ocrImage(img.base64, img.mimeType, opts?.ocrTimeoutMs ?? 120_000, {
        ...opts?.contexto,
        storagePath: img.storagePath ?? null,
        storageProvider: img.storageProvider ?? null,
      });
      return { fileName: img.fileName, ...result };
    })
  );

  let totalTokensInput = ocrResults.reduce((s, r) => s + r.tokens_input, 0);
  let totalTokensOutput = ocrResults.reduce((s, r) => s + r.tokens_output, 0);

  if (images.length <= 1) {
    return { groupedText: ocrResults[0]?.text ?? "", totalTokensInput, totalTokensOutput };
  }

  // Telegram/álbum = 1 venta: saltar la 2ª pasada IA de agrupado (DeepSeek) —
  // concatenar alcanza y ahorra un round-trip de modelo (más rápido).
  if (opts?.skipGrouping) {
    return { groupedText: ocrResults.map((r) => r.text).join("\n\n"), totalTokensInput, totalTokensOutput };
  }

  // Agrupar imágenes de la misma operación con un modelo de texto (DeepSeek).
  const groupingPrompt = `Eres un asistente contable chileno. Analiza estos textos extraídos de imágenes de operaciones P2P/crypto.

Para cada imagen identifica: tipo (chat_p2p/comprobante_transferencia/release_crypto/otro), monto en CLP, nombre/alias de la contraparte, fecha, RUT si aparece.

Luego agrupa las imágenes que pertenecen a la misma operación (mismo monto + misma persona).

Responde con el texto agrupado por operación, separando cada operación con "---OPERACION---". Dentro de cada operación, concatena los textos relevantes en orden cronológico.

TEXTOS EXTRAÍDOS:
${ocrResults.map((r, i) => `[Imagen ${i + 1}: ${r.fileName}]\n${r.text}`).join("\n\n")}`;

  try {
    const grouped = await openCodeChat(GROUP_MODEL, groupingPrompt);
    totalTokensInput += grouped.tokens_input;
    totalTokensOutput += grouped.tokens_output;
    return {
      groupedText: grouped.text || ocrResults.map((r) => r.text).join("\n\n"),
      totalTokensInput,
      totalTokensOutput,
    };
  } catch {
    // Si el agrupado falla, concatenar es suficiente para el pipeline.
    return {
      groupedText: ocrResults.map((r) => r.text).join("\n\n"),
      totalTokensInput,
      totalTokensOutput,
    };
  }
}
