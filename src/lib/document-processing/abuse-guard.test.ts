import { afterEach, describe, expect, it } from "vitest";
import { topeJobsIaDia, verificarTopeDiarioIa, type JobsCountClient } from "./abuse-guard";

// Protege el cortafuegos de costo #3: el tope diario de jobs de IA por
// empresa. Si alguien lo relaja (deja de contar, ignora el tope, o el
// default se dispara), estos tests muerden.

function clientConCount(count: number | null, error: { message: string } | null = null): JobsCountClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => Promise.resolve({ count, error }),
        }),
      }),
    }),
  };
}

afterEach(() => {
  delete process.env.MASSDTE_TOPE_JOBS_IA_DIA;
});

describe("verificarTopeDiarioIa — cortafuegos de costo", () => {
  it("bajo el tope: pasa, con el conteo real", async () => {
    const res = await verificarTopeDiarioIa(clientConCount(3), "emp-1");
    expect(res).toEqual({ ok: true, usados: 3, tope: topeJobsIaDia() });
  });

  it("EN el tope: cerrado (>= , no >)", async () => {
    process.env.MASSDTE_TOPE_JOBS_IA_DIA = "10";
    const res = await verificarTopeDiarioIa(clientConCount(10), "emp-1");
    expect(res.ok).toBe(false);
  });

  it("sobre el tope: cerrado", async () => {
    process.env.MASSDTE_TOPE_JOBS_IA_DIA = "10";
    const res = await verificarTopeDiarioIa(clientConCount(500), "emp-1");
    expect(res).toEqual({ ok: false, usados: 500, tope: 10 });
  });

  it("fail-open CONSCIENTE si el conteo falla (es cortafuegos de costo, no de datos)", async () => {
    const res = await verificarTopeDiarioIa(clientConCount(null, { message: "boom" }), "emp-1");
    expect(res.ok).toBe(true);
  });

  it("el default es generoso pero finito (no se puede apagar por accidente)", () => {
    expect(topeJobsIaDia()).toBeGreaterThanOrEqual(50);
    expect(topeJobsIaDia()).toBeLessThanOrEqual(1000);
  });

  it("env inválida cae al default, no a infinito", () => {
    process.env.MASSDTE_TOPE_JOBS_IA_DIA = "no-un-numero";
    expect(topeJobsIaDia()).toBe(150);
    process.env.MASSDTE_TOPE_JOBS_IA_DIA = "-5";
    expect(topeJobsIaDia()).toBe(150);
  });
});
