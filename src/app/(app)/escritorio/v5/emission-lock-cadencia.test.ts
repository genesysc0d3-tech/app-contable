import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CADENCIA_REPOSO_MS, CADENCIA_VIVA_MS, proximaEsperaMs } from "./emission-lock-cadencia";

// Incidente 2026-09-25: /api/emision/jobs = 8.2K llamadas y 5 de 8 min de CPU en
// 12 h (Vercel gratis al 99% del mes). Causa: cadencia de 5 s por `business_mode`
// (toda cuenta Business), sin mirar si la pestaña estaba a la vista.
describe("cadencia del sondeo del candado de emisión", () => {
  it("pestaña oculta → no se sondea, aunque haya candado", () => {
    expect(proximaEsperaMs({ oculta: true, locked: true })).toBeNull();
    expect(proximaEsperaMs({ oculta: true, locked: false })).toBeNull();
  });
  it("candado activo y pestaña visible → cadencia viva (5 s)", () => {
    expect(proximaEsperaMs({ oculta: false, locked: true })).toBe(CADENCIA_VIVA_MS);
  });
  it("reposo (sin candado) → 60 s; business_mode a secas ya no acelera", () => {
    expect(proximaEsperaMs({ oculta: false, locked: false })).toBe(CADENCIA_REPOSO_MS);
    expect(proximaEsperaMs({ oculta: false, locked: null })).toBe(CADENCIA_REPOSO_MS);
  });
  it("un intervalMs custom manda en vivo y nunca baja el reposo de 60 s", () => {
    expect(proximaEsperaMs({ oculta: false, locked: true, intervalMs: 2000 })).toBe(2000);
    expect(proximaEsperaMs({ oculta: false, locked: false, intervalMs: 2000 })).toBe(CADENCIA_REPOSO_MS);
    expect(proximaEsperaMs({ oculta: false, locked: false, intervalMs: 90000 })).toBe(90000);
  });
  it("el hook usa estas reglas y escucha visibilitychange (si no, el incidente vuelve)", () => {
    const hook = readFileSync("src/app/(app)/escritorio/v5/useEmissionLockStatus.ts", "utf8").replace(/^\s*import[\s\S]*?;\s*$/gm, "");
    expect(hook).toContain("proximaEsperaMs(");
    expect(hook).toContain("visibilitychange");
    expect(hook).not.toMatch(/business_mode\s*\|\|/);
  });
});
