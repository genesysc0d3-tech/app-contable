import { describe, it, expect } from "vitest";
import { derivarMontosDte } from "./montos-dte";

describe("derivarMontosDte", () => {
  it("exenta: el total entero es neto y no hay IVA", () => {
    expect(derivarMontosDte(119_000, false)).toEqual({ neto: 119_000, iva: 0 });
  });

  it("afecta: neto = total/1,19 e IVA = el resto", () => {
    expect(derivarMontosDte(119_000, true)).toEqual({ neto: 100_000, iva: 19_000 });
  });

  it("neto + IVA === total SIEMPRE, aunque el total no sea representable exacto", () => {
    for (const total of [1, 7, 100_001, 33_333, 999_999, 1_234_567]) {
      const { neto, iva } = derivarMontosDte(total, true);
      expect(neto + iva).toBe(total);
    }
  });

  it("redondea el total antes de repartir (no deja decimales colgando)", () => {
    const { neto, iva } = derivarMontosDte(119_000.4, true);
    expect(neto + iva).toBe(119_000);
  });

  it("total cero no fabrica IVA", () => {
    expect(derivarMontosDte(0, true)).toEqual({ neto: 0, iva: 0 });
  });
});
