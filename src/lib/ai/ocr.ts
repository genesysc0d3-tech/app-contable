/**
 * Mistral OCR for images using mistral-ocr-latest.
 * Extracts structured text from screenshots/photos.
 */

import { Mistral } from "@mistralai/mistralai";

const OCR_MODEL = "mistral-ocr-latest";

interface OcrResult {
  text: string;
  tokens_input: number;
  tokens_output: number;
}

function getClient(): Mistral {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY no configurada");
  return new Mistral({ apiKey });
}

/**
 * Extract text from a single image using Mistral OCR.
 */
export async function ocrImage(imageBase64: string, mimeType: string): Promise<OcrResult> {
  const client = getClient();

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const response = await client.chat.complete({
    model: OCR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            imageUrl: dataUrl,
          },
          {
            type: "text",
            text: "Extrae todo el texto visible en esta imagen. Mantén la estructura, números, fechas, montos y nombres exactos. Si es un chat, preserva quién dice qué. Si es un comprobante, preserva todos los campos.",
          },
        ],
      },
    ],
    temperature: 0.1,
  });

  const choice = response.choices?.[0];
  const text = typeof choice?.message?.content === "string"
    ? choice.message.content
    : "";

  return {
    text,
    tokens_input: response.usage?.promptTokens ?? 0,
    tokens_output: response.usage?.completionTokens ?? 0,
  };
}

/**
 * OCR multiple images and group related ones (same operation).
 * Returns grouped text ready for the classification pipeline.
 */
export async function ocrAndGroupImages(
  images: { base64: string; mimeType: string; fileName: string }[]
): Promise<{
  groupedText: string;
  totalTokensInput: number;
  totalTokensOutput: number;
}> {
  // OCR all images in parallel
  const ocrResults = await Promise.all(
    images.map(async (img) => {
      const result = await ocrImage(img.base64, img.mimeType);
      return { fileName: img.fileName, ...result };
    })
  );

  let totalTokensInput = ocrResults.reduce((s, r) => s + r.tokens_input, 0);
  let totalTokensOutput = ocrResults.reduce((s, r) => s + r.tokens_output, 0);

  if (images.length <= 1) {
    return {
      groupedText: ocrResults[0]?.text ?? "",
      totalTokensInput,
      totalTokensOutput,
    };
  }

  // For multiple images, ask Mistral to group related ones
  const client = getClient();

  const groupingPrompt = `Eres un asistente contable chileno. Analiza estos textos extraídos de imágenes de operaciones P2P/crypto.

Para cada imagen identifica: tipo (chat_p2p/comprobante_transferencia/release_crypto/otro), monto en CLP, nombre/alias de la contraparte, fecha, RUT si aparece.

Luego agrupa las imágenes que pertenecen a la misma operación (mismo monto + misma persona).

Responde con el texto agrupado por operación, separando cada operación con "---OPERACION---". Dentro de cada operación, concatena los textos relevantes en orden cronológico.

TEXTOS EXTRAÍDOS:
${ocrResults.map((r, i) => `[Imagen ${i + 1}: ${r.fileName}]\n${r.text}`).join("\n\n")}`;

  const groupResponse = await client.chat.complete({
    model: process.env.MISTRAL_MODEL || "mistral-small-latest",
    messages: [{ role: "user", content: groupingPrompt }],
    temperature: 0.1,
  });

  const groupedText = typeof groupResponse.choices?.[0]?.message?.content === "string"
    ? groupResponse.choices[0].message.content
    : ocrResults.map((r) => r.text).join("\n\n");

  totalTokensInput += groupResponse.usage?.promptTokens ?? 0;
  totalTokensOutput += groupResponse.usage?.completionTokens ?? 0;

  return { groupedText, totalTokensInput, totalTokensOutput };
}
