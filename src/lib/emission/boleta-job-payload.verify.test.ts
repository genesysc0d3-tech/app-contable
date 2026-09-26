import { describe, it, expect } from "vitest";
import { buildBoletaJob } from "./boleta-job-payload";

const base = {
  empresaId: "e1", emisorRut: "77155156-4", tipoDte: 41 as const, monto: 196000, fechaEmision: "2026-09-25",
  receptor: {}, detalle: "x", logoutAfter: false, jobId: "v1", expiresAt: "2026-09-25T20:00:00Z",
};

describe("buildBoletaJob — job de VERIFICACIÓN (cuadre por evento)", () => {
  it("verifyOnly + verifyWindow → verify_only, ventana redondeada y allow_final_emit false", () => {
    const job = buildBoletaJob({ ...base, verifyOnly: true, verifyWindow: { desde_ms: 1000.4, hasta_ms: 61000.6 } });
    expect(job.verify_only).toBe(true);
    expect(job.verify_window).toEqual({ desde_ms: 1000, hasta_ms: 61001 });
    expect(job.allow_final_emit).toBe(false);
    expect(job.auto_emit).toBe(true); // el validador de la extensión lo exige
  });
  it("sin verifyWindow no se marca verify (una emisión normal jamás lleva allow_final_emit false)", () => {
    const job = buildBoletaJob({ ...base, verifyOnly: true });
    expect(job.verify_only).toBeUndefined();
    expect(job.allow_final_emit).toBe(true);
  });
});
