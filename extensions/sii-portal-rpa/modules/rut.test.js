import { describe, it, expect } from "vitest";
import { normalizeRut, computeDv, isRutValido, rutIguales, extractRutTokens } from "./rut.js";

describe("normalizeRut — acepta todas las formas → 'CUERPO-DV'", () => {
  it("con puntos y guion", () => expect(normalizeRut("76.269.769-6")).toBe("76269769-6"));
  it("con guion sin puntos", () => expect(normalizeRut("76269769-6")).toBe("76269769-6"));
  it("sin separadores (último char = DV)", () => expect(normalizeRut("762697696")).toBe("76269769-6"));
  it("con espacios sueltos", () => expect(normalizeRut("  76.269.769 - 6 ")).toBe("76269769-6"));
  it("DV k minúscula → K", () => expect(normalizeRut("12.345.678-k")).toBe("12345678-K"));
  it("ceros a la izquierda se descartan", () => expect(normalizeRut("0076269769-6")).toBe("76269769-6"));
  it("vacío → null", () => expect(normalizeRut("")).toBeNull());
  it("solo DV → null", () => expect(normalizeRut("K")).toBeNull());
  it("null/undefined → null", () => { expect(normalizeRut(null)).toBeNull(); expect(normalizeRut(undefined)).toBeNull(); });
  it("K en el cuerpo (no en DV) → null", () => expect(normalizeRut("1K2")).toBeNull());
  it("cuerpo demasiado largo (>8) → null", () => expect(normalizeRut("1234567890-1")).toBeNull());
});

describe("computeDv — módulo 11 (incluye ramas 0 y K)", () => {
  it("rama K (resto 10)", () => expect(computeDv("6")).toBe("K"));   // 6*2=12, 12%11=1, 11-1=10 → K
  it("rama 0 (resto 11)", () => expect(computeDv("0")).toBe("0"));   // 0 → 11-0=11 → 0
  it("dígito normal", () => expect(computeDv("1")).toBe("9"));       // 1*2=2, 11-2=9
  it("cuerpo real 76269769 → 6", () => expect(computeDv("76269769")).toBe("6"));
  it("cuerpo real 11111111 → 1", () => expect(computeDv("11111111")).toBe("1"));
  it("cuerpo real 12345678 → 5", () => expect(computeDv("12345678")).toBe("5"));
});

describe("isRutValido — DV declarado debe coincidir con el calculado", () => {
  it("válidos", () => {
    expect(isRutValido("76.269.769-6")).toBe(true);
    expect(isRutValido("11.111.111-1")).toBe(true);
    expect(isRutValido("12.345.678-5")).toBe(true);
  });
  it("DV incoherente → false", () => {
    expect(isRutValido("12.345.678-K")).toBe(false); // el DV real es 5, no K
    expect(isRutValido("76269769-7")).toBe(false);
    expect(isRutValido("11.111.111-2")).toBe(false);
  });
  it("basura → false", () => {
    expect(isRutValido("")).toBe(false);
    expect(isRutValido("no-rut")).toBe(false);
    expect(isRutValido(null)).toBe(false);
  });
});

describe("rutIguales — igualdad ESTRICTA, nunca substring", () => {
  it("misma identidad en distintas formas → true", () => {
    expect(rutIguales("11111111-1", "11.111.111-1")).toBe(true);
    expect(rutIguales("762697696", "76.269.769-6")).toBe(true);
  });
  it("cuerpo distinto (substring) → false", () => {
    expect(rutIguales("1.111.111-1", "11.111.111-1")).toBe(false);
  });
  it("mismo cuerpo, DV distinto → false (el DV cuenta)", () => {
    expect(rutIguales("11.111.111-1", "11111111-2")).toBe(false);
  });
  it("vacío nunca iguala", () => {
    expect(rutIguales("", "11.111.111-1")).toBe(false);
    expect(rutIguales(null, null)).toBe(false);
  });
});

describe("extractRutTokens — lee RUT de texto de opciones, sin falsos positivos", () => {
  it("extrae el RUT de 'RUT NOMBRE'", () => {
    expect(extractRutTokens("18.662.087-9 CONSTANZA MARCELA DUCAUD NORAMBUENA")).toEqual(["18662087-9"]);
    expect(extractRutTokens("77.002.244-4 INMOBILIARIA FICA BASCUR SPA")).toEqual(["77002244-4"]);
  });
  it("NO inventa RUT desde números en el nombre", () => {
    expect(extractRutTokens("COMERCIAL 24-7 SPA")).toEqual([]);
    expect(extractRutTokens("sin rut aquí")).toEqual([]);
  });
  it("dedup y múltiples", () => {
    const t = extractRutTokens("77.002.244-4 A · 77002244-4 B · 18.662.087-9 C");
    expect(t).toEqual(["77002244-4", "18662087-9"]);
  });
  it("vacío/null → []", () => {
    expect(extractRutTokens("")).toEqual([]);
    expect(extractRutTokens(null)).toEqual([]);
  });
});
