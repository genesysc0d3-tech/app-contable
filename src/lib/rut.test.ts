import { describe, expect, it } from "vitest";
import { validarRut, formatRut } from "./rut";

describe("validarRut (módulo 11)", () => {
  it("acepta RUT válidos con y sin puntos/guion", () => {
    expect(validarRut("11.111.111-1")).toBe(true);
    expect(validarRut("11111111-1")).toBe(true);
    expect(validarRut("111111111")).toBe(true);
  });

  it("acepta dígito verificador K (módulo 11 = 10)", () => {
    expect(validarRut("8.888.888-K")).toBe(true);
    expect(validarRut("8888888k")).toBe(true); // k minúscula
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(validarRut("11.111.111-2")).toBe(false);
    expect(validarRut("12.345.678-9")).toBe(false);
  });

  it("rechaza entradas inválidas (muy corto, cuerpo no numérico)", () => {
    expect(validarRut("1")).toBe(false);
    expect(validarRut("")).toBe(false);
    expect(validarRut("abc-1")).toBe(false);
  });
});

describe("formatRut", () => {
  it("formatea como XX.XXX.XXX-D", () => {
    expect(formatRut("123456785")).toBe("12.345.678-5");
    expect(formatRut("11111111-1")).toBe("11.111.111-1");
  });

  it("normaliza K a mayúscula", () => {
    expect(formatRut("8888888k")).toBe("8.888.888-K");
  });

  it("devuelve la entrada tal cual si es muy corta", () => {
    expect(formatRut("1")).toBe("1");
  });
});
