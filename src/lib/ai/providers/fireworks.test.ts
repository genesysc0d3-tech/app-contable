import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proveedor Fireworks (2026-09-26). Sin llamadas reales: fetch simulado con el
// mismo streaming SSE que usa opencode-stream.
function sse(content: string) {
  const lines = [
    `data: ${JSON.stringify({ model: "accounts/fireworks/models/deepseek-v4p1-flash", choices: [{ delta: { content } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3300, completion_tokens: 870 } })}\n`,
    "data: [DONE]\n",
  ];
  return new Response(new ReadableStream<Uint8Array>({
    start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(l)); c.close(); },
  }), { status: 200 });
}
const MOV = { fecha: "2026-09-01", monto: 1000, descripcion: "MOV", tipo_flujo: "entrada" as const, origen: "cartola", n_documento: "" };

beforeEach(() => {
  vi.resetModules();
  delete process.env.FIREWORKS_MODEL;
  delete process.env.FIREWORKS_REASONING;
  process.env.FIREWORKS_API_KEY = "fw-test";
  process.env.OPENCODE_GO_API_KEY = "oc-test";
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.AI_PROVIDER; });

describe("FireworksProvider", () => {
  it("llama a Fireworks con DeepSeek V4.1 Flash, su key y reasoning_effort low", async () => {
    const f = vi.fn(async (..._a: unknown[]) => sse('{"propuestas":[{"movimiento_index":0,"tipo_propuesto":"boleta","total":1000,"confianza":0.8}]}'));
    vi.stubGlobal("fetch", f);
    const { FireworksProvider } = await import("./fireworks");
    const r = await new FireworksProvider().classifyMovimientos!([MOV]);
    expect(r.propuestas).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fw-test");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("accounts/fireworks/models/deepseek-v4p1-flash");
    expect(body.reasoning_effort).toBe("low");
    expect(body.stream).toBe(true);
  });

  it("costo = precio de Fireworks (US$0,22 / US$0,66 por millón)", async () => {
    const { FireworksProvider } = await import("./fireworks");
    expect(new FireworksProvider().getCost(1_000_000, 1_000_000)).toBeCloseTo(0.88, 5);
  });

  it("un modelo fuera de la allowlist se rechaza (fail-closed, Ley 21.719)", async () => {
    process.env.FIREWORKS_MODEL = "accounts/fireworks/models/glm-5p3-flash";
    const { FireworksProvider } = await import("./fireworks");
    expect(() => new FireworksProvider()).toThrow(/PROCESADOR_NO_APROBADO/);
  });

  it("sin FIREWORKS_API_KEY no arranca", async () => {
    delete process.env.FIREWORKS_API_KEY;
    const { FireworksProvider } = await import("./fireworks");
    expect(() => new FireworksProvider()).toThrow(/FIREWORKS_API_KEY/);
  });
});

describe("selección de proveedor", () => {
  it("AI_PROVIDER=fireworks elige Fireworks; sin variable sigue OpenCode (prod intacto)", async () => {
    const { getAIProvider } = await import("../provider");
    const { FireworksProvider } = await import("./fireworks");
    expect(getAIProvider()).not.toBeInstanceOf(FireworksProvider);
    process.env.AI_PROVIDER = "fireworks";
    expect(getAIProvider()).toBeInstanceOf(FireworksProvider);
    process.env.AI_PROVIDER = "otro";
    expect(() => getAIProvider()).toThrow(/no soportado/);
  });

  it("OpenCode sigue llamando a su URL de siempre", async () => {
    const f = vi.fn(async (..._a: unknown[]) => sse('{"propuestas":[]}'));
    vi.stubGlobal("fetch", f);
    const { OpenCodeGoProvider } = await import("./opencodego");
    await new OpenCodeGoProvider().classifyMovimientos!([MOV]);
    expect(f.mock.calls[0][0]).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).reasoning_effort).toBeUndefined();
  });
});
