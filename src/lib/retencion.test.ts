import { describe, it, expect } from "vitest";
import { cutoffRetencionISO, GLOSA_CADUCADA, RETENCION_ANOS } from "./retencion";

// Fecha fija: Date.now() no es determinista. Elegimos un futuro donde SÍ habrá
// datos de más de 6 años, para razonar sobre el corte.
const NOW = Date.UTC(2032, 0, 1);
const ANO_MS = 365.25 * 24 * 60 * 60 * 1000;

describe("retención de glosa cruda — 6 años (Código Tributario)", () => {
  it("el corte cae exactamente 6 años ANTES de ahora (jamás en el futuro)", () => {
    const cutoff = new Date(cutoffRetencionISO(NOW)).getTime();
    expect(cutoff).toBeLessThan(NOW); // pasado, nunca futuro
    expect((NOW - cutoff) / ANO_MS).toBeCloseTo(RETENCION_ANOS, 5);
  });

  it("una glosa reciente NUNCA cae bajo el corte (no se anonimiza data viva)", () => {
    // Guarda contra el bug catastrófico: invertir la dirección y scrubbear datos
    // recientes en vez de los caducados.
    const cutoff = new Date(cutoffRetencionISO(NOW)).getTime();
    expect(NOW).toBeGreaterThan(cutoff); // hoy → segura
    expect(NOW - 5 * ANO_MS).toBeGreaterThan(cutoff); // 5 años → aún dentro de los 6, segura
    expect(NOW - 7 * ANO_MS).toBeLessThan(cutoff); // 7 años → caduca
  });

  it("el marcador de anonimización no puede contener PII (ni dígitos ni RUT)", () => {
    expect(GLOSA_CADUCADA).not.toMatch(/\d/);
    expect(GLOSA_CADUCADA).not.toMatch(/\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/);
    expect(GLOSA_CADUCADA.toUpperCase()).not.toContain("TRANSFER");
  });
});
