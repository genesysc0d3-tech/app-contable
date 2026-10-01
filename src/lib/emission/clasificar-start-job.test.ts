import { describe, expect, it } from "vitest";
import { clasificarStartJob } from "./clasificar-start-job";

describe("clasificarStartJob — DATOS_CAMBIARON (seguridad 2026-09-30, punto 2)", () => {
  it("409 DATOS_CAMBIARON → frena el lote (lo que falta queda guardado) con motivo honesto", () => {
    const r = clasificarStartJob(409, { ok: false, error: "DATOS_CAMBIARON", campos: ["monto"] });
    expect(r.tipo).toBe("frenada");
    if (r.tipo === "frenada") expect(r.motivo).toContain("cambió");
  });
});

describe("clasificarStartJob — el lote no revienta en cadena", () => {
  it("candado PROPIO (caso LC 23:43) → frenada con motivo honesto, nunca 'Equipo'", () => {
    const r = clasificarStartJob(409, { ok: false, error: "EMISION_BLOQUEADA", bloqueo: { is_mine: true, locked_until: "2026-09-28T02:52:07Z" } });
    expect(r.tipo).toBe("frenada");
    if (r.tipo === "frenada") {
      expect(r.motivo).toContain("Tu emisión anterior");
      expect(r.motivo).toContain("23:52");
      expect(r.motivo).not.toContain("Equipo");
    }
  });
  it("candado de OTRA persona → frenada con su nombre", () => {
    const r = clasificarStartJob(409, { error: "EMISION_BLOQUEADA", bloqueo: { is_mine: false, usuario_nombre: "Marge" } });
    expect(r).toMatchObject({ tipo: "frenada" });
    if (r.tipo === "frenada") expect(r.motivo).toContain("Marge");
  });
  it("a medias / sin respuesta → saltar sin pausa", () => {
    expect(clasificarStartJob(409, { error: "REVISION_PENDIENTE" })).toEqual({ tipo: "a_medias" });
    expect(clasificarStartJob(409, { error: "SIN_RESPUESTA" })).toEqual({ tipo: "a_medias" });
  });
  it("en curso → frenada", () => {
    expect(clasificarStartJob(409, { error: "EMISION_EN_CURSO" }).tipo).toBe("frenada");
  });
  it("pausa del server, ya emitida y ok se mantienen", () => {
    expect(clasificarStartJob(409, { code: "EMISION_PAUSADA" }).tipo).toBe("pausada");
    expect(clasificarStartJob(409, { error: "PROPUESTA_YA_EMITIDA", folio: 7, boleta_id: "b" })).toEqual({ tipo: "ya_emitida", folio: 7, boletaId: "b", boletaCreatedAt: null });
    expect(clasificarStartJob(200, { ok: true, job_id: "j", expires_at: "x", folios_hoy: [1] })).toMatchObject({ tipo: "ok", jobId: "j", foliosHoy: [1] });
  });
  it("cualquier otro rechazo → error (como antes: fallida de esa boleta)", () => {
    expect(clasificarStartJob(500, { error: "PROPUESTA_CHECK_FAILED" }).tipo).toBe("error");
    expect(clasificarStartJob(402, { error: "CUOTA" }).tipo).toBe("error");
  });

  it("429 (racha de saltadas) → reintentar, no fallida", () => {
    expect(clasificarStartJob(429, { error: "RATE_LIMITED", retry_after_seconds: 7 })).toEqual({ tipo: "reintentar", esperaMs: 7000 });
  });
  it("candado ya vencido (bloqueo null) → motivo neutro, no 'tu emisión'", () => {
    const r = clasificarStartJob(409, { error: "EMISION_BLOQUEADA", bloqueo: null });
    expect(r.tipo).toBe("frenada");
    if (r.tipo === "frenada") expect(r.motivo).not.toContain("Tu emisión anterior");
  });
});
