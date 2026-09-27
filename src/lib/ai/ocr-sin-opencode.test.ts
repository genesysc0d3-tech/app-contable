import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Compliance (2026-09-26): con AI_PROVIDER=fireworks (producción), NADA sale a
// OpenCode — ni el respaldo del OCR cuando la mini no responde, ni el agrupado.
vi.mock("server-only", () => ({}));
function sse(content: string) {
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`,
    "data: [DONE]\n",
  ];
  return new Response(new ReadableStream<Uint8Array>({
    start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(l)); c.close(); },
  }), { status: 200 });
}

beforeEach(() => {
  vi.resetModules();
  delete process.env.OCR_MINI_ENABLED; // mini "caída": va al respaldo remoto
  process.env.AI_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY = "fw-app";
  process.env.OPENCODE_GO_API_KEY = "oc";
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.AI_PROVIDER; });

describe("OCR y agrupado sin OpenCode en producción", () => {
  it("el respaldo del OCR va a Fireworks (DeepSeek V4.1 Flash), no a OpenCode", async () => {
    const f = vi.fn(async (..._a: unknown[]) => sse("Monto: $53.000"));
    vi.stubGlobal("fetch", f);
    const { ocrImage } = await import("./ocr");
    const r = await ocrImage("aGVsbG8=", "image/png");
    expect(r.text).toContain("53.000");
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.startsWith("https://api.fireworks.ai/"))).toBe(true);
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("accounts/fireworks/models/deepseek-v4p1-flash");
  });

  it("el agrupado de varias imágenes tampoco toca OpenCode", async () => {
    const f = vi.fn(async (..._a: unknown[]) => sse("texto"));
    vi.stubGlobal("fetch", f);
    const { ocrAndGroupImages } = await import("./ocr");
    await ocrAndGroupImages([
      { base64: "aGVsbG8=", mimeType: "image/png", fileName: "a.png" },
      { base64: "aGVsbG8=", mimeType: "image/png", fileName: "b.png" },
    ]);
    expect(f.mock.calls.length).toBe(3); // 2 OCR + 1 agrupado
    expect(f.mock.calls.every((c) => !String(c[0]).includes("opencode.ai"))).toBe(true);
  });

  it("sin AI_PROVIDER (preview/dev) sigue OpenCode", async () => {
    delete process.env.AI_PROVIDER;
    const f = vi.fn(async (..._a: unknown[]) => sse("x"));
    vi.stubGlobal("fetch", f);
    const { ocrImage } = await import("./ocr");
    await ocrImage("aGVsbG8=", "image/png");
    expect(String(f.mock.calls[0][0])).toContain("opencode.ai");
  });
});
