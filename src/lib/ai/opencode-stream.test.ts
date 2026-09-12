import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchOpenCodeStreaming } from "./opencode-stream";

function sseResponse(lines: string[], init?: { status?: number }) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return new Response(stream, { status: init?.status ?? 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("fetchOpenCodeStreaming — parser SSE del gateway OpenCode", () => {
  it("acumula deltas, captura finish_reason, usage y model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'data: {"model":"deepseek-v4-flash","choices":[{"delta":{"content":"{\\"a\\":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n',
      "data: [DONE]\n",
    ])));

    const r = await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} });
    expect(r.content).toBe('{"a":1}');
    expect(r.finish_reason).toBe("stop");
    expect(r.model).toBe("deepseek-v4-flash");
    expect(r.tokens_input).toBe(10);
    expect(r.tokens_output).toBe(4);
  });

  it("tolera chunks partidos en medio de una línea (buffering)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"cont',
      'ent":"hola"}}]}\n',
      'data: {"choices":[{"delta":{"content":" mundo"},"finish_reason":"stop"}]}\n',
    ])));
    const r = await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} });
    expect(r.content).toBe("hola mundo");
  });

  it("ignora un chunk malformado aislado sin romper el stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      "data: {esto no es json}\n",
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
    ])));
    const r = await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} });
    expect(r.content).toBe("ok");
  });

  it("propaga el error HTTP con el cuerpo (mismo formato que el cliente viejo)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Internal server error", { status: 500 })));
    await expect(
      fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} }),
    ).rejects.toThrow(/OpenCode Go API error 500/);
  });

  it("stream cortado sin finish_reason (corte silencioso del gateway) lanza error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"{\\"json\\": a med"}}]}\n',
      'data: {"choices":[],"cost":"0"}\n',
    ])));
    await expect(
      fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} }),
    ).rejects.toThrow(/cortado por el gateway/);
  });

  it("SIEMPRE manda x-opencode-session (default a prueba de olvidos)", async () => {
    // El gateway devuelve 400 MissingSessionID sin este header (regresión 2026-09-11).
    const spy = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n']));
    vi.stubGlobal("fetch", spy);
    await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {} });
    const headers = ((spy.mock.calls[0] as unknown[])[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-opencode-session"]).toBeTruthy();
  });

  it("respeta el x-opencode-session ESTABLE que pasa el caller (cache de prompt)", async () => {
    const spy = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n']));
    vi.stubGlobal("fetch", spy);
    await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: {}, extraHeaders: { "x-opencode-session": "sid-fijo-123" } });
    const headers = ((spy.mock.calls[0] as unknown[])[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-opencode-session"]).toBe("sid-fijo-123");
  });

  it("manda stream:true y stream_options en el body", async () => {
    const spy = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n']));
    vi.stubGlobal("fetch", spy);
    await fetchOpenCodeStreaming({ url: "http://x", apiKey: "k", body: { model: "m" } });
    const sent = JSON.parse((spy.mock.calls[0] as unknown[])[1] ? ((spy.mock.calls[0] as unknown[])[1] as RequestInit).body as string : "{}");
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe("m");
    expect(sent.stream_options).toEqual({ include_usage: true });
  });
});
