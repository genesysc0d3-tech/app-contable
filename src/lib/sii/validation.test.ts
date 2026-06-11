import { describe, it, expect } from "vitest";
import {
  cleanRut,
  formatRut,
  validarRut,
  calcularIVA,
  descomponerBruto,
  validarBoleta,
  RECEPTOR_OBLIGATORIO_DESDE,
} from "./validation";

describe("RUT — módulo 11 oficial", () => {
  it("limpia puntos, guión y normaliza K", () => {
    expect(cleanRut("12.345.678-5")).toBe("123456785");
    expect(cleanRut("6-k")).toBe("6K");
  });

  it("formatea con puntos y guión", () => {
    expect(formatRut("123456785")).toBe("12.345.678-5");
  });

  it("acepta RUTs con dígito verificador correcto", () => {
    expect(validarRut("12.345.678-5")).toBe(true);
    expect(validarRut("11.111.111-1")).toBe(true);
    expect(validarRut("6-K")).toBe(true); // DV K (resto 10)
    expect(validarRut("6-k")).toBe(true); // case-insensitive
  });

  it("rechaza DV incorrecto, vacío y basura", () => {
    expect(validarRut("12.345.678-9")).toBe(false);
    expect(validarRut("")).toBe(false);
    expect(validarRut("1")).toBe(false);
    expect(validarRut("ABCD")).toBe(false);
  });
});

describe("IVA 19% — redondeo al peso", () => {
  it("calcula IVA redondeado", () => {
    expect(calcularIVA(1000)).toBe(190);
    expect(calcularIVA(105)).toBe(20); // 19.95 → 20
  });

  it("descomponerBruto: neto + iva == total siempre", () => {
    for (const total of [1190, 1000, 99_990, 180_001, 7, 123_457]) {
      const d = descomponerBruto(total);
      expect(d.neto + d.iva).toBe(total);
      expect(d.total).toBe(total);
    }
    expect(descomponerBruto(1190)).toEqual({ neto: 1000, iva: 190, total: 1190 });
  });
});

describe("validarBoleta — reglas SII 39/41", () => {
  const linea = (monto: number, nombre = "Servicio") => [{ nombre, monto }];

  it("boleta afecta (39): total bruto se descompone en neto + IVA", () => {
    const r = validarBoleta({ tipo_dte: 39, detalles: linea(1190) });
    expect(r.ok).toBe(true);
    expect(r.totales).toEqual({ neto: 1000, exento: 0, iva: 190, total: 1190 });
  });

  it("boleta exenta (41): todo el total es exento, sin IVA", () => {
    const r = validarBoleta({ tipo_dte: 41, detalles: linea(50_000) });
    expect(r.ok).toBe(true);
    expect(r.totales).toEqual({ neto: 0, exento: 50_000, iva: 0, total: 50_000 });
  });

  it("receptor opcional hasta $180.000 EXACTOS (Res. Ex. 174/2017 es >, no >=)", () => {
    const r = validarBoleta({ tipo_dte: 39, detalles: linea(RECEPTOR_OBLIGATORIO_DESDE) });
    expect(r.ok).toBe(true);
  });

  it("sobre $180.000 exige RUT y razón social del receptor", () => {
    const r = validarBoleta({ tipo_dte: 39, detalles: linea(RECEPTOR_OBLIGATORIO_DESDE + 1) });
    expect(r.ok).toBe(false);
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("RECEPTOR_RUT_OBLIGATORIO");
    expect(codes).toContain("RECEPTOR_RAZON_SOCIAL_OBLIGATORIA");
  });

  it("sobre $180.000 con receptor completo pasa", () => {
    const r = validarBoleta({
      tipo_dte: 39,
      detalles: linea(200_000),
      receptor_rut: "12.345.678-5",
      receptor_razon_social: "Cliente SpA",
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza RUT receptor con DV malo", () => {
    const r = validarBoleta({ tipo_dte: 39, detalles: linea(1000), receptor_rut: "12.345.678-9" });
    expect(r.errors.map((e) => e.code)).toContain("RUT_INVALIDO");
  });

  it("rechaza detalle vacío y montos no enteros", () => {
    const vacio = validarBoleta({ tipo_dte: 39, detalles: [] });
    expect(vacio.ok).toBe(false);
    expect(vacio.errors.map((e) => e.code)).toContain("DETALLE_VACIO");
    expect(vacio.totales).toBeUndefined();

    const decimal = validarBoleta({ tipo_dte: 39, detalles: linea(10.5) });
    expect(decimal.errors.map((e) => e.code)).toContain("LINEA_MONTO_NO_ENTERO");
  });

  it("detalle vs monto_total: tolera ±1 peso de redondeo, rechaza más", () => {
    const ok = validarBoleta({ tipo_dte: 39, detalles: linea(1190), monto_total: 1191 });
    expect(ok.errors.map((e) => e.code)).not.toContain("DETALLE_NO_CUADRA");

    const malo = validarBoleta({ tipo_dte: 39, detalles: linea(1190), monto_total: 1200 });
    expect(malo.errors.map((e) => e.code)).toContain("DETALLE_NO_CUADRA");
  });
});
