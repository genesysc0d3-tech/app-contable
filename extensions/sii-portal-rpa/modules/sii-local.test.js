import { describe, it, expect } from "vitest";
import { validateSiiBoletaJob } from "./sii-local.js";

const futuro = () => new Date(Date.now() + 3_600_000).toISOString();
const base = (over = {}) => ({
  job_id: "j1",
  tipo_dte: 39,
  expires_at: futuro(),
  auto_emit: true,
  emisor_rut: "76.269.769-6", // RUT con DV válido
  ...over,
});

describe("validateSiiBoletaJob — gate de emisor (fail-closed)", () => {
  it("job real válido con emisor_rut válido → null (pasa)", () => {
    expect(validateSiiBoletaJob(base())).toBeNull();
  });
  it("emisión real SIN emisor_rut → EMISOR_RUT_INVALID (no abre ventana)", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: undefined }))).toBe("EMISOR_RUT_INVALID");
    expect(validateSiiBoletaJob(base({ emisor_rut: "" }))).toBe("EMISOR_RUT_INVALID");
  });
  it("emisión real con emisor_rut de DV inválido → EMISOR_RUT_INVALID", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: "76.269.769-7" }))).toBe("EMISOR_RUT_INVALID");
    expect(validateSiiBoletaJob(base({ emisor_rut: "no-rut" }))).toBe("EMISOR_RUT_INVALID");
  });
  it("acepta el RUT en cualquier formato mientras el DV sea válido", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: "762697696" }))).toBeNull();
    expect(validateSiiBoletaJob(base({ emisor_rut: "76269769-6" }))).toBeNull();
  });
  it("learn_only NO exige emisor_rut (no emite)", () => {
    expect(validateSiiBoletaJob(base({ auto_emit: false, learn_only: true, emisor_rut: undefined }))).toBeNull();
  });
  it("gates previos intactos", () => {
    expect(validateSiiBoletaJob(base({ job_id: undefined }))).toBe("JOB_ID_MISSING");
    expect(validateSiiBoletaJob(base({ tipo_dte: 33 }))).toBe("TIPO_DTE_INVALID");
    expect(validateSiiBoletaJob(base({ expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe("JOB_EXPIRED");
    expect(validateSiiBoletaJob(base({ auto_emit: false, learn_only: false }))).toBe("AUTO_EMIT_OR_LEARN_ONLY_REQUIRED");
  });
});
