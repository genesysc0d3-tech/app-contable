import { describe, it, expect } from "vitest";
import { construirAMedias } from "./a-medias";

const prop = (id: string, fecha: string, total: number) => ({
  id, total, tipo_dte: 41, receptor_nombre: null, fecha, descripcion: `TEF ${id}`, documento_nombre: "BICE.xlsx",
});

describe("construirAMedias (pestaña 'A medias' de Emitir)", () => {
  it("una lápida por propuesta, con job_id para registrar el folio", () => {
    const items = construirAMedias(
      [{ job_id: "j1", propuesta_id: "p1", created_at: "2026-09-25T18:27:00Z" }],
      [prop("p1", "2026-09-01", 196000)],
    );
    expect(items).toEqual([expect.objectContaining({ id: "p1", job_id: "j1", monto_total: 196000, fecha: "2026-09-01" })]);
  });
  it("con reintentos (varias lápidas) sale UNA vez con el job más reciente", () => {
    const items = construirAMedias(
      [
        { job_id: "viejo", propuesta_id: "p1", created_at: "2026-09-23T20:58:00Z" },
        { job_id: "nuevo", propuesta_id: "p1", created_at: "2026-09-24T17:42:00Z" },
      ],
      [prop("p1", "2025-09-07", 142000)],
    );
    expect(items).toHaveLength(1);
    expect(items[0].job_id).toBe("nuevo");
  });
  it("una lápida sin propuesta cargada no revienta ni aparece", () => {
    expect(construirAMedias([{ job_id: "j", propuesta_id: "fantasma", created_at: "2026-09-25T00:00:00Z" }], [])).toEqual([]);
  });
  it("ordena por fecha del movimiento y luego por monto (para cotejar con el SII)", () => {
    const items = construirAMedias(
      [
        { job_id: "a", propuesta_id: "p1", created_at: "2026-09-25T18:27:00Z" },
        { job_id: "b", propuesta_id: "p2", created_at: "2026-09-25T18:33:00Z" },
        { job_id: "c", propuesta_id: "p3", created_at: "2026-09-25T18:39:00Z" },
      ],
      [prop("p1", "2026-09-03", 100000), prop("p2", "2026-09-01", 196000), prop("p3", "2026-09-01", 15000)],
    );
    expect(items.map((i) => i.id)).toEqual(["p3", "p2", "p1"]);
  });
});
