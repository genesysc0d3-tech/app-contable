import { describe, expect, it, vi, beforeEach } from "vitest";

// Regresión del incidente 2026-08-13 (cartola de 675 movs que nunca terminaba):
// minimax-m3 con chunks de 100 agotaba max_tokens → JSON truncado
// (finish_reason="length") → parseo fallido → 3 reintentos de ~125s → la
// invocación de Vercel moría a los 300s sin checkpoint → loop infinito.
beforeEach(() => {
  vi.resetModules();
  process.env.OPENCODE_GO_API_KEY = "test-key";
  process.env.OPENCODE_GO_MODEL = "minimax-m3";
});

// El provider ahora consume la API en streaming (SSE) — ver opencode-stream.ts.
// Los mocks emiten el mismo contenido como chunks data: de un stream real.
function sseMock(args: { content: string; finish: string; usage?: { prompt_tokens: number; completion_tokens: number } }) {
  const lines = [
    `data: ${JSON.stringify({ model: "minimax-m3", choices: [{ delta: { content: args.content } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: args.finish }] })}\n`,
    ...(args.usage ? [`data: ${JSON.stringify({ choices: [], usage: args.usage })}\n`] : []),
    "data: [DONE]\n",
  ];
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  }), { status: 200 });
}

describe("respuesta truncada del modelo", () => {
  it("finish_reason='length' lanza error marcado como truncado (no se reintenta)", async () => {
    const fetchMock = vi.fn(async () => sseMock({
      content: '{"propuestas":[{"movimiento_ind',
      finish: "length",
      usage: { prompt_tokens: 900, completion_tokens: 16000 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { OpenCodeGoProvider } = await import("./providers/opencodego");
    const provider = new OpenCodeGoProvider();
    const movs = Array.from({ length: 100 }, (_, i) => ({
      fecha: "2026-08-01", monto: 1000, descripcion: `MOV ${i}`,
      tipo_flujo: "entrada" as const, origen: "cartola", n_documento: "",
    }));

    await expect(provider.classifyMovimientos!(movs)).rejects.toMatchObject({ truncado: true });
    // Una sola llamada: el retry vive en el processor y se corta con `truncado`.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finish_reason='stop' parsea normal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseMock({
      content: '{"propuestas":[{"movimiento_index":0,"tipo_propuesto":"boleta","total":1000,"confianza":0.8}]}',
      finish: "stop",
      usage: { prompt_tokens: 500, completion_tokens: 900 },
    })));

    const { OpenCodeGoProvider } = await import("./providers/opencodego");
    const provider = new OpenCodeGoProvider();
    const r = await provider.classifyMovimientos!([
      { fecha: "2026-08-01", monto: 1000, descripcion: "MOV", tipo_flujo: "entrada" as const, origen: "cartola", n_documento: "" },
    ]);
    expect(r.propuestas).toHaveLength(1);
    expect(r.finish_reason).toBe("stop");
  });
});

describe("CHUNK_SIZE medido contra el modelo real", () => {
  it("se mantiene en un tamaño que NO trunca (medido: 40 ok, 100 trunca)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./processor.ts", import.meta.url), "utf8"));
    const m = src.match(/const CHUNK_SIZE = (\d+);/);
    expect(m).not.toBeNull();
    const size = Number(m![1]);
    // Si alguien lo sube, que sea con medición nueva (ver comentario en processor.ts).
    expect(size).toBeLessThanOrEqual(50);
    expect(size).toBeGreaterThan(0);
  });
});

describe("el YIELD no puede ser tratado como error (regresión 2026-08-13)", () => {
  it("procesarDocumento re-lanza ProcessorYieldError antes de sobrescribir progreso_ia", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./processor.ts", import.meta.url), "utf8");
    // El guard debe estar ANTES del update que reemplaza progreso_ia (ese update
    // borraba el checkpoint recién guardado → el documento reempezaba de cero).
    const guard = src.indexOf("if (err instanceof ProcessorYieldError) throw err;");
    const update = src.indexOf('estado: "error",\n        progreso_ia:');
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(update);
  });

  it("markJobYielded no toca progreso_ia (el checkpoint debe sobrevivir)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../document-processing/queue.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("async function markJobYielded"), src.indexOf("async function markJobFailedOrRetryable"));
    expect(fn).not.toContain("progreso_ia");
    expect(fn).toContain('status: "retryable"');
  });

  it("el checkpoint vive en el job, NO en progreso_ia (que se sobrescribe)", async () => {
    const fs = await import("node:fs");
    const proc = fs.readFileSync(new URL("./processor.ts", import.meta.url), "utf8");
    // Lectura y escritura van contra document_processing_jobs.checkpoint.
    expect(proc).toContain('.from("document_processing_jobs")');
    expect(proc).toContain("guardarCheckpoint");
    // Y progreso_ia ya no lo transporta (processOneJob lo pisa al arrancar).
    const tipos = fs.readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    expect(tipos).not.toMatch(/^\s*checkpoint\?:/m);
  });
});
