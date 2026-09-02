import type {
  AIProvider,
  AIResponse,
  AIExtractionResult,
  ClassifyOnlyResponse,
  MovimientoExtraido,
  PropuestaExtraida,
} from "../types";
import {
  buildUserPrompt,
  buildClassifyUserPrompt,
  getClassifyOnlySystemPrompt,
} from "../prompt";
import { requirePaidModel } from "../model-guard";
import { assertApprovedDataProcessor } from "../egress";
import { fetchOpenCodeStreaming } from "../opencode-stream";

const BASE_URL = "https://opencode.ai/zen/go/v1";

const COST_PER_MILLION_INPUT = 0;
const COST_PER_MILLION_OUTPUT = 0;

/**
 * Extrae y parsea el objeto JSON del contenido del modelo, tolerando lo que emiten
 * los modelos de razonamiento aun sin json_object estricto: bloques <think>…</think>
 * (minimax) y cercas markdown ```json … ```. Si no hay JSON, lanza (lo captura el
 * retry del pipeline). deepseek-v4-flash pone su razonamiento en `reasoning_content`
 * aparte, así que su `content` ya viene limpio; esto cubre además a los otros.
 */
export function parseJsonFromContent<T>(content: string): T {
  let t = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as T;
}

interface OpenCodeGoMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenCodeGoResponse {
  choices: {
    message: { content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

export class OpenCodeGoProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENCODE_GO_API_KEY;
    if (!apiKey) throw new Error("OPENCODE_GO_API_KEY no configurada");
    this.apiKey = apiKey;
    this.model = requirePaidModel(process.env.OPENCODE_GO_MODEL || "deepseek-v4-flash", "opencodego");
    // Gate fail-closed (Ley 21.719): solo modelos en la allowlist de encargados
    // con retención cero pueden recibir datos personales.
    assertApprovedDataProcessor("opencodego", this.model);
  }

  private async fetchChat(
    messages: OpenCodeGoMessage[]
  ): Promise<OpenCodeGoResponse> {
    // Streaming SIEMPRE: el gateway de OpenCode mata las respuestas no-stream a
    // los ~80s (regresión 2026-08-19) y nuestros lotes generan por minutos.
    // Detalle completo en opencode-stream.ts. El timeout es por inactividad.
    const data = await fetchOpenCodeStreaming({
      url: `${BASE_URL}/chat/completions`,
      apiKey: this.apiKey,
      body: {
        // NO se fuerza response_format: json_object. Los modelos de razonamiento
        // (deepseek-v4-flash) revientan el upstream ("Upstream request failed") al
        // exigirles JSON puro + un prompt complejo — no pueden razonar y a la vez
        // estar forzados a puro JSON. El prompt ya pide JSON; extraemos el objeto
        // del contenido con parseJsonFromContent (tolera <think> y cercas markdown).
        model: this.model,
        messages,
        temperature: 0.1,
        // Los modelos de razonamiento gastan MUCHOS tokens en reasoning_content, que
        // cuenta contra el output. Sin techo alto, el JSON de respuesta se trunca y el
        // parseo falla. Damos aire para razonamiento + respuesta.
        max_tokens: 16000,
      },
    });

    return {
      choices: [{
        message: { content: data.content },
        finish_reason: data.finish_reason ?? "",
      }],
      usage: {
        prompt_tokens: data.tokens_input,
        completion_tokens: data.tokens_output,
      },
      model: data.model ?? this.model,
    };
  }

  async extractMovimientos(
    contenido: string,
    systemPrompt: string
  ): Promise<AIResponse> {
    const data = await this.fetchChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserPrompt(contenido) },
    ]);

    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === "string"
      ? choice.message.content
      : "";

    const result = parseJsonFromContent<AIExtractionResult>(text);

    return {
      result,
      tokens_input: data.usage?.prompt_tokens ?? 0,
      tokens_output: data.usage?.completion_tokens ?? 0,
      modelo: data.model ?? this.model,
      finish_reason: choice?.finish_reason ?? null,
      raw_response_length: text.length,
    };
  }

  async revisarContexto(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ raw: unknown; tokens_input: number; tokens_output: number; modelo: string }> {
    const data = await this.fetchChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    let raw: unknown = null;
    try { raw = parseJsonFromContent<unknown>(text); } catch { raw = null; }
    return {
      raw,
      tokens_input: data.usage?.prompt_tokens ?? 0,
      tokens_output: data.usage?.completion_tokens ?? 0,
      modelo: data.model ?? this.model,
    };
  }

  async classifyMovimientos(
    movimientos: MovimientoExtraido[],
    systemPrompt?: string
  ): Promise<ClassifyOnlyResponse> {
    const classifyPrompt = systemPrompt || getClassifyOnlySystemPrompt();
    const data = await this.fetchChat([
      { role: "system", content: classifyPrompt },
      { role: "user", content: buildClassifyUserPrompt(movimientos) },
    ]);

    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === "string"
      ? choice.message.content
      : "";
    // Truncamiento (finish_reason="length"): el modelo agotó max_tokens y el JSON
    // viene cortado. Reintentar con el MISMO input da el mismo corte — se marca el
    // error para que el caller no queme reintentos (cada uno cuesta ~2 min y mata
    // la invocación). El arreglo real es bajar CHUNK_SIZE, no reintentar.
    if (choice?.finish_reason === "length") {
      const err = new Error(
        `RESPUESTA_TRUNCADA: el modelo agotó max_tokens con ${movimientos.length} movimientos (JSON incompleto). Reduce CHUNK_SIZE.`,
      );
      (err as Error & { truncado?: boolean }).truncado = true;
      throw err;
    }

    const parsed = parseJsonFromContent<{ propuestas?: PropuestaExtraida[] }>(text);
    const propuestas = Array.isArray(parsed.propuestas) ? parsed.propuestas : [];

    return {
      propuestas,
      tokens_input: data.usage?.prompt_tokens ?? 0,
      tokens_output: data.usage?.completion_tokens ?? 0,
      modelo: data.model ?? this.model,
      finish_reason: choice?.finish_reason ?? null,
      raw_response_length: text.length,
    };
  }

  getCost(tokensInput: number, tokensOutput: number): number {
    return (
      (tokensInput / 1_000_000) * COST_PER_MILLION_INPUT +
      (tokensOutput / 1_000_000) * COST_PER_MILLION_OUTPUT
    );
  }
}
