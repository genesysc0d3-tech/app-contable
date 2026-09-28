import { describe, expect, it } from "vitest";
import { esLapidaEfectiva, SIN_RESPUESTA_DESDE } from "./lapida";

const ahora = new Date("2026-09-28T12:00:00Z");
const base = { propuesta_id: "p", created_at: "2026-09-28T02:37:07Z", expires_at: "2026-09-28T02:52:07Z" };

describe("esLapidaEfectiva — tabla de verdad", () => {
  it("caso LC: running vencido del lote → sin_respuesta (ya no vuelve a Listas)", () => {
    expect(esLapidaEfectiva({ ...base, estado: "running" }, ahora)).toBe("sin_respuesta");
  });
  it("running vivo → null (es 'en curso', lo cubre otro chequeo)", () => {
    expect(esLapidaEfectiva({ ...base, estado: "running", expires_at: "2026-09-28T12:10:00Z" }, ahora)).toBeNull();
  });
  it("revision_pendiente → a_medias", () => {
    expect(esLapidaEfectiva({ ...base, estado: "revision_pendiente" }, ahora)).toBe("a_medias");
  });
  it("sin propuesta (boleta única) → null", () => {
    expect(esLapidaEfectiva({ ...base, propuesta_id: null, estado: "running" }, ahora)).toBeNull();
  });
  it("failed / cancelled / completed vencidos → null", () => {
    for (const estado of ["failed", "cancelled", "completed", "expired"]) {
      expect(esLapidaEfectiva({ ...base, estado }, ahora)).toBeNull();
    }
  });
  it("colgado anterior al corte → null (se resuelve a mano)", () => {
    expect(esLapidaEfectiva({ ...base, estado: "running", created_at: "2026-09-27T20:00:00Z" }, ahora)).toBeNull();
    expect(SIN_RESPUESTA_DESDE <= base.created_at).toBe(true);
  });
});
