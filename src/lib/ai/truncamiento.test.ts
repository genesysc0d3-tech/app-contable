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

describe("respuesta truncada del modelo", () => {
  it("finish_reason='length' lanza error marcado como truncado (no se reintenta)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "minimax-m3",
        usage: { prompt_tokens: 900, completion_tokens: 16000 },
        choices: [{ finish_reason: "length", message: { content: '{"propuestas":[{"movimiento_ind' } }],
      }),
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
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "minimax-m3",
        usage: { prompt_tokens: 500, completion_tokens: 900 },
        choices: [{ finish_reason: "stop", message: { content: '{"propuestas":[{"movimiento_index":0,"tipo_propuesto":"boleta","total":1000,"confianza":0.8}]}' } }],
      }),
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
