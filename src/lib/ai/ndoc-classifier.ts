/**
 * Classifies n_documento fields using Mistral Small to determine
 * if they are unique transaction IDs or RUT/recipient identifiers.
 * Results are cached by pattern to avoid redundant API calls.
 */

import { Mistral } from "@mistralai/mistralai";

interface NDocClassification {
  es_id_transaccion: boolean;
  razon: string;
}

const cache = new Map<string, NDocClassification>();

function getClient(): Mistral {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY no configurada");
  return new Mistral({ apiKey });
}

/**
 * Normalize n_documento to a pattern for caching.
 * E.g. "932758405" and "932758406" share the same pattern "9d{8}"
 * but "76.123.456-7" is a different pattern (RUT-like).
 */
function toPattern(ndoc: string): string {
  return ndoc
    .replace(/\d/g, "D")
    .replace(/D+/g, (m) => `D${m.length}`);
}

/**
 * Classify a single n_documento value. Uses cache by pattern.
 */
async function classifySingle(
  nDocumento: string,
  descripcion: string
): Promise<NDocClassification> {
  const pattern = toPattern(nDocumento);

  const cached = cache.get(pattern);
  if (cached) return cached;

  const client = getClient();
  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

  const prompt = `Analiza este campo de una cartola bancaria chilena:
N° Documento: ${nDocumento}
Descripción: ${descripcion}

¿Este número es un ID único de transacción bancaria o es el RUT/identificador del destinatario/origen?

Criterios:
- RUTs chilenos tienen formato XX.XXX.XXX-X o XXXXXXXX-X (8-9 dígitos + dígito verificador)
- IDs de transacción bancaria son numéricos secuenciales sin dígito verificador
- Si el número coincide con un nombre de persona en la descripción, probablemente es un RUT

Responde solo con JSON: {"es_id_transaccion": true/false, "razon": "explicación breve"}`;

  try {
    const response = await client.chat.complete({
      model,
      messages: [{ role: "user", content: prompt }],
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });

    const text = typeof response.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : '{"es_id_transaccion": true, "razon": "default"}';

    const result: NDocClassification = JSON.parse(text);
    cache.set(pattern, result);
    return result;
  } catch {
    // On error, assume it's a transaction ID (safer for dedup)
    const fallback: NDocClassification = { es_id_transaccion: true, razon: "Error clasificando, asumido como ID transacción" };
    cache.set(pattern, fallback);
    return fallback;
  }
}

/**
 * Classify multiple n_documento values in batch.
 * Groups by pattern to minimize API calls.
 */
export async function clasificarNDocs(
  items: { n_documento: string; descripcion: string }[]
): Promise<Map<string, boolean>> {
  // Group by pattern, pick one representative per pattern
  const patternToItem = new Map<string, { n_documento: string; descripcion: string }>();
  for (const item of items) {
    const pattern = toPattern(item.n_documento);
    if (!patternToItem.has(pattern)) {
      patternToItem.set(pattern, item);
    }
  }

  // Classify unique patterns in parallel (max 5 concurrent)
  const entries = Array.from(patternToItem.entries());
  const MAX_CONCURRENT = 5;
  for (let i = 0; i < entries.length; i += MAX_CONCURRENT) {
    const batch = entries.slice(i, i + MAX_CONCURRENT);
    await Promise.all(
      batch.map(([, item]) => classifySingle(item.n_documento, item.descripcion))
    );
  }

  // Build result map: n_documento -> es_id_transaccion
  const result = new Map<string, boolean>();
  for (const item of items) {
    const pattern = toPattern(item.n_documento);
    const classification = cache.get(pattern);
    result.set(item.n_documento, classification?.es_id_transaccion ?? true);
  }

  return result;
}

/**
 * Clear the cache (useful for testing).
 */
export function clearNDocCache() {
  cache.clear();
}
