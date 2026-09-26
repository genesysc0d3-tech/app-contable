import { describe, expect, it, vi } from "vitest";

// Incidente LC 2026-09-26: un trozo de 15 filas se truncó (el modelo de
// razonamiento gastó los 16.000 tokens pensando) y "RESPUESTA_TRUNCADA" botó la
// cartola ENTERA. Ahora el trozo truncado se parte en dos y cada mitad se
// clasifica aparte; los índices de la segunda mitad se corren para que cada
// propuesta siga apuntando a SU movimiento.
// processor.ts arrastra módulos de servidor; para esta unidad no se usan.
vi.mock("server-only", () => ({}));
const llamadas: number[] = [];
vi.mock("./provider", () => ({
  getAIProvider: () => ({
    classifyMovimientos: async (movs: { descripcion: string }[]) => {
      llamadas.push(movs.length);
      if (movs.length > 4) {
        const err = new Error("RESPUESTA_TRUNCADA: prueba") as Error & { truncado?: boolean };
        err.truncado = true;
        throw err;
      }
      return {
        propuestas: movs.map((m, i) => ({
          movimiento_index: i,
          tipo_propuesto: "transferencia_p2p",
          confianza: 0.7,
          total: 0,
          notas: m.descripcion, // eco: permite verificar que cada propuesta quedó con SU movimiento
        })),
        tokens_input: 10,
        tokens_output: 5,
        modelo: "fake",
        finish_reason: "stop",
        raw_response_length: 1,
      };
    },
  }),
}));

describe("trozo truncado → se parte en dos", () => {
  it("clasifica las 15 filas en mitades sin botar el trozo, con índices correctos", async () => {
    const { classifyChunkWithRetry } = await import("./processor");
    const movs = Array.from({ length: 15 }, (_, i) => ({
      fecha: "2026-09-21", monto: 1000 + i, descripcion: `MOV ${i}`,
      tipo_flujo: "entrada" as const, origen: "cartola_preparseada", n_documento: "",
    }));
    const r = await classifyChunkWithRetry(3, movs, "prompt");
    expect(r.index).toBe(3);
    expect(r.movimientos.map((m) => m.descripcion)).toEqual(movs.map((m) => m.descripcion));
    expect(r.propuestas).toHaveLength(15);
    r.propuestas.forEach((p, i) => {
      expect(p.movimiento_index).toBe(i);
      expect(p.notas).toBe(`MOV ${i}`);
      expect(p.total).toBe(1000 + i);
    });
    // 15 trunca → 8 trunca + 7 trunca → 4,4 + 4,3: nunca se reintenta el mismo tamaño.
    expect(llamadas[0]).toBe(15);
    expect(Math.max(...llamadas.slice(1))).toBeLessThan(15);
  });
});
