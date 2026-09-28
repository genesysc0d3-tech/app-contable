import { describe, expect, it } from "vitest";
import { DECLARAR_SIN_RESPUESTA_TRAS_MS, esLapidaEfectiva, plazoDeclararNoSalio, puedeDeclararNoSalio, SIN_RESPUESTA_DESDE } from "./lapida";

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

describe("formato de fecha de Postgres", () => {
  it("'+00:00' con fracciones justo después del corte cuenta como nuevo", () => {
    expect(esLapidaEfectiva({ ...base, estado: "running", created_at: "2026-09-28T00:00:00.5+00:00", expires_at: "2026-09-28T00:15:00.5+00:00" }, ahora)).toBe("sin_respuesta");
  });
});

describe("puedeDeclararNoSalio — la salida humana espera a que el job esté muerto", () => {
  it("a medias → sí", () => {
    expect(puedeDeclararNoSalio({ ...base, estado: "revision_pendiente" }, ahora)).toBe(true);
  });
  it("sin respuesta recién vencida → todavía no (puede seguir viva)", () => {
    const venc = new Date(Date.parse(base.expires_at) + 60_000);
    expect(puedeDeclararNoSalio({ ...base, estado: "running" }, venc)).toBe(false);
  });
  it("sin respuesta vencida hace más de 30 min → sí", () => {
    const tarde = new Date(Date.parse(base.expires_at) + DECLARAR_SIN_RESPUESTA_TRAS_MS + 1);
    expect(puedeDeclararNoSalio({ ...base, estado: "running" }, tarde)).toBe(true);
  });
  it("job sin lápida → no", () => {
    expect(puedeDeclararNoSalio({ ...base, estado: "failed" }, ahora)).toBe(false);
  });
});

describe("plazoDeclararNoSalio — el plazo vale para CADA lápida que se cierra", () => {
  // Intento original sin respuesta, vencido hace 5 min; verificación sellada a medias.
  const ahora5 = new Date("2026-09-28T18:00:00Z");
  const original = { estado: "running", propuesta_id: "p", created_at: "2026-09-28T17:40:00Z", expires_at: "2026-09-28T17:55:00Z" };
  const verifAMedias = { estado: "revision_pendiente", propuesta_id: "p", created_at: "2026-09-28T17:57:00Z", expires_at: "2026-09-28T18:12:00Z" };
  it("la a medias sola se puede declarar al tiro", () => {
    expect(plazoDeclararNoSalio([verifAMedias], ahora5)).toEqual({ ok: true });
  });
  it("pero NO arrastra al original sin respuesta de hace 5 min → desde expires_at + 30 min", () => {
    expect(plazoDeclararNoSalio([verifAMedias, original], ahora5)).toEqual({ ok: false, desdeMs: Date.parse("2026-09-28T18:25:00Z") });
  });
  it("con varias sin respuesta, manda la más tardía", () => {
    const otro = { ...original, created_at: "2026-09-28T17:44:00Z", expires_at: "2026-09-28T17:59:00Z" };
    expect(plazoDeclararNoSalio([original, otro], ahora5)).toEqual({ ok: false, desdeMs: Date.parse("2026-09-28T18:29:00Z") });
  });
  it("cumplidos los 30 min → ok", () => {
    expect(plazoDeclararNoSalio([verifAMedias, original], new Date("2026-09-28T18:26:00Z"))).toEqual({ ok: true });
  });
  it("jobs que no son lápida (failed, vivos) no cuentan", () => {
    expect(plazoDeclararNoSalio([{ ...original, estado: "failed" }, { ...original, expires_at: "2026-09-28T18:10:00Z" }], ahora5)).toEqual({ ok: true });
  });
});
