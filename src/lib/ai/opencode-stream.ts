/**
 * Cliente streaming (SSE) para la API OpenAI-compatible de OpenCode Go.
 *
 * Por qué streaming y no un fetch normal: desde el 2026-08-19 el gateway de
 * OpenCode corta las respuestas NO streaming a los ~80s con un 500 "Internal
 * server error". Nuestros lotes de clasificación generan por varios minutos,
 * así que TODA llamada larga moría (incidente clienta M&E, 2026-08-21; el
 * pipeline quedó 2 días sin un solo job exitoso). Con `stream: true` la
 * respuesta fluye por pedazos y el corte no aplica — verificado: el mismo
 * request que muere a los 80s sin streaming completa en ~47s streameado.
 *
 * El timeout acá es POR INACTIVIDAD (se rearma con cada chunk recibido), no
 * total: una generación sana larga nunca debe abortarse; una conexión muda sí.
 */

export interface OpenCodeStreamResult {
  content: string;
  finish_reason: string | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
}

interface StreamChunk {
  model?: string;
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export async function fetchOpenCodeStreaming(args: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  idleTimeoutMs?: number;
  extraHeaders?: Record<string, string>;
}): Promise<OpenCodeStreamResult> {
  const idleMs = args.idleTimeoutMs ?? 120_000;
  const controller = new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), idleMs);
  const rearm = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleMs);
  };

  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        ...(args.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        ...args.body,
        stream: true,
        // Pide el usage en el último chunk (extensión OpenAI). Si el gateway
        // no lo soporta, simplemente no llega y reportamos 0 — no es fatal.
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenCode Go API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finishReason: string | null = null;
    let model: string | null = null;
    let tokensIn = 0;
    let tokensOut = 0;

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        return; // chunk malformado aislado: se ignora, el resto del stream sigue
      }
      if (chunk.model) model = chunk.model;
      const choice = chunk.choices?.[0];
      if (typeof choice?.delta?.content === "string") content += choice.delta.content;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rearm();
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);

    return {
      content,
      finish_reason: finishReason,
      model,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
    };
  } finally {
    clearTimeout(idleTimer);
  }
}
