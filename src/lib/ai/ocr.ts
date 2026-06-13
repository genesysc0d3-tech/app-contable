/**
 * OCR de imágenes (screenshots/fotos de comprobantes).
 *
 * Dos motores, seleccionables por OCR_PROVIDER:
 *  - "opencode" (default si hay OPENCODE_GO_API_KEY): MiniMax M3 vía OpenCode
 *    Go. Multimodal confirmado, incluido en la suscripción Go (no cobra por
 *    imagen) y no entrena con los datos (modelo de pago). Mejor costo.
 *  - "mistral": mistral-ocr-latest. Fallback robusto.
 * Si el motor principal falla, cae al otro cuando su API key está disponible.
 */

import { Mistral } from "@mistralai/mistralai";

const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
const OPENCODE_BASE = "https://opencode.ai/zen/go/v1";
const OPENCODE_OCR_MODEL = process.env.OPENCODE_OCR_MODEL || "minimax-m3";
// Cloudflare frente a OpenCode responde 1010 a clientes sin firma de
// navegador; mandamos un User-Agent estándar para pasar.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const OCR_PROMPT =
  "Extrae TODO el texto visible en esta imagen. Mantén la estructura, números, fechas, montos y nombres exactos. Si es un chat, preserva quién dice qué. Si es un comprobante, preserva todos los campos. Responde solo con el texto, sin explicaciones.";

interface OcrResult {
  text: string;
  tokens_input: number;
  tokens_output: number;
}

function hasOpenCode(): boolean {
  return !!process.env.OPENCODE_GO_API_KEY;
}
function hasMistral(): boolean {
  return !!process.env.MISTRAL_API_KEY;
}

/** Quita el bloque de razonamiento <think>…</think> que algunos modelos anteponen. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** OCR con MiniMax M3 (OpenCode Go): multimodal, incluido en la suscripción. */
async function ocrImageOpenCode(imageBase64: string, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) throw new Error("OPENCODE_GO_API_KEY no configurada");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${OPENCODE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
      },
      body: JSON.stringify({
        model: OPENCODE_OCR_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              { type: "text", text: OCR_PROMPT },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenCode OCR ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const text = stripThink(typeof raw === "string" ? raw : "");
    return {
      text,
      tokens_input: data?.usage?.prompt_tokens ?? 0,
      tokens_output: data?.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** OCR con Mistral (mistral-ocr-latest). */
async function ocrImageMistral(imageBase64: string, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY no configurada");
  const client = new Mistral({ apiKey });

  const response = await client.chat.complete({
    model: MISTRAL_OCR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", imageUrl: `data:${mimeType};base64,${imageBase64}` },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
    temperature: 0.1,
  });
  const choice = response.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  return {
    text,
    tokens_input: response.usage?.promptTokens ?? 0,
    tokens_output: response.usage?.completionTokens ?? 0,
  };
}

/**
 * Extrae texto de una imagen. Elige motor por OCR_PROVIDER; si el principal
 * falla y el otro tiene key, hace fallback para no perder el comprobante.
 */
export async function ocrImage(imageBase64: string, mimeType: string): Promise<OcrResult> {
  const preferOpenCode = (process.env.OCR_PROVIDER ?? "opencode") !== "mistral" && hasOpenCode();
  const primary = preferOpenCode ? ocrImageOpenCode : ocrImageMistral;
  const fallback = preferOpenCode ? ocrImageMistral : ocrImageOpenCode;
  const fallbackReady = preferOpenCode ? hasMistral() : hasOpenCode();

  try {
    return await primary(imageBase64, mimeType);
  } catch (err) {
    if (fallbackReady) {
      console.warn(`[ocr] motor principal falló (${err instanceof Error ? err.message : err}); usando fallback`);
      return await fallback(imageBase64, mimeType);
    }
    throw err;
  }
}

/**
 * OCR de varias imágenes y agrupado de las relacionadas (misma operación).
 * Devuelve el texto agrupado listo para el pipeline de clasificación.
 */
export async function ocrAndGroupImages(
  images: { base64: string; mimeType: string; fileName: string }[]
): Promise<{
  groupedText: string;
  totalTokensInput: number;
  totalTokensOutput: number;
}> {
  const ocrResults = await Promise.all(
    images.map(async (img) => {
      const result = await ocrImage(img.base64, img.mimeType);
      return { fileName: img.fileName, ...result };
    })
  );

  let totalTokensInput = ocrResults.reduce((s, r) => s + r.tokens_input, 0);
  let totalTokensOutput = ocrResults.reduce((s, r) => s + r.tokens_output, 0);

  if (images.length <= 1) {
    return { groupedText: ocrResults[0]?.text ?? "", totalTokensInput, totalTokensOutput };
  }

  // Agrupar imágenes de la misma operación con un modelo de texto.
  const groupingPrompt = `Eres un asistente contable chileno. Analiza estos textos extraídos de imágenes de operaciones P2P/crypto.

Para cada imagen identifica: tipo (chat_p2p/comprobante_transferencia/release_crypto/otro), monto en CLP, nombre/alias de la contraparte, fecha, RUT si aparece.

Luego agrupa las imágenes que pertenecen a la misma operación (mismo monto + misma persona).

Responde con el texto agrupado por operación, separando cada operación con "---OPERACION---". Dentro de cada operación, concatena los textos relevantes en orden cronológico.

TEXTOS EXTRAÍDOS:
${ocrResults.map((r, i) => `[Imagen ${i + 1}: ${r.fileName}]\n${r.text}`).join("\n\n")}`;

  try {
    const grouped = await groupText(groupingPrompt);
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

/** Agrupado de textos: mismo proveedor que el OCR (texto plano). */
async function groupText(prompt: string): Promise<{ text: string; tokens_input: number; tokens_output: number }> {
  const preferOpenCode = (process.env.OCR_PROVIDER ?? "opencode") !== "mistral" && hasOpenCode();
  if (preferOpenCode) {
    const res = await fetch(`${OPENCODE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
      },
      body: JSON.stringify({
        model: process.env.OPENCODE_GO_MODEL || "deepseek-v4-flash",
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    return {
      text: stripThink(data?.choices?.[0]?.message?.content ?? ""),
      tokens_input: data?.usage?.prompt_tokens ?? 0,
      tokens_output: data?.usage?.completion_tokens ?? 0,
    };
  }
  const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });
  const r = await client.chat.complete({
    model: process.env.MISTRAL_MODEL || "mistral-small-latest",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });
  const c = r.choices?.[0]?.message?.content;
  return {
    text: typeof c === "string" ? c : "",
    tokens_input: r.usage?.promptTokens ?? 0,
    tokens_output: r.usage?.completionTokens ?? 0,
  };
}
