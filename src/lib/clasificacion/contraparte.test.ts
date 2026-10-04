/**
 * Contraparte (Fase 4): el módulo puro que comparten el aprendizaje de reglas y el Check
 * agrupado. Lo movido desde aprender-regla.ts no cambia (sus tests siguen en
 * src/lib/ai/aprender-regla.test.ts); acá: RUT módulo 11, plataformas como canal,
 * clave para agrupar y cuenta propia.
 */
import { describe, expect, it } from "vitest";
import * as A from "@/lib/ai/aprender-regla";
import {
  claveContraparte, dvRut, extraerPatronContraparte, normalizarRut, pareceCuentaPropia, pareceEmpresa,
  plataformaEnGlosa, regexContraparte, rutEnGlosa,
} from "./contraparte";

describe("lo movido desde aprender-regla no cambia", () => {
  it("aprender-regla re-exporta las MISMAS funciones", () => {
    expect(A.extraerPatronContraparte).toBe(extraerPatronContraparte);
    expect(A.regexContraparte).toBe(regexContraparte);
  });
  it("mismos resultados de siempre", () => {
    expect(extraerPatronContraparte("TRANSFERENCIA DE JUAN PEREZ")).toEqual({ patron: "JUAN PEREZ" });
    expect(extraerPatronContraparte("SOBREGIRO CTE")).toBeNull();
    expect(extraerPatronContraparte("TRANSF DE JOSÉ PÉREZ SPA 12:30")).toEqual({ patron: "JOSÉ PÉREZ" });
    expect(regexContraparte("JUAN PEREZ")).toBe("(^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)");
  });
});

describe("RUT (módulo 11)", () => {
  it("dígito verificador", () => {
    expect(dvRut("12345678")).toBe("5");
    expect(dvRut("11111111")).toBe("1");
    expect(dvRut("10000013")).toBe("K");
  });
  it("normaliza con o sin puntos y rechaza el DV malo", () => {
    expect(normalizarRut("12.345.678-5")).toBe("12345678-5");
    expect(normalizarRut("12345678-5")).toBe("12345678-5");
    expect(normalizarRut("10.000.013-k")).toBe("10000013-K");
    expect(normalizarRut("12.345.678-4")).toBeNull();
    expect(normalizarRut("")).toBeNull();
  });
  it("en la glosa solo con guion (una tira de números es un nº de operación)", () => {
    expect(rutEnGlosa("TRANSF DE 12.345.678-5 JUAN PEREZ")).toBe("12345678-5");
    expect(rutEnGlosa("TEF 11111111-1 MARIA")).toBe("11111111-1");
    expect(rutEnGlosa("TEF 12.345.678-4 MARIA")).toBeNull(); // DV malo
    expect(rutEnGlosa("OPERACION 123456785")).toBeNull(); // sin guion
    expect(rutEnGlosa("REF 0012345678-5X")).toBeNull();
  });
});

describe("plataformas de pago = canal", () => {
  it("reconoce las plataformas de la lista", () => {
    for (const [g, clave] of [
      ["ABONO MERCADOPAGO 76.123", "MERCADOPAGO"], ["TRANSF MERCADO PAGO SPA", "MERCADOPAGO"], ["PAGO FLOW", "FLOW"],
      ["KHIPU TRANSFER", "KHIPU"], ["WEBPAY PLUS", "WEBPAY"], ["GETNET LIQ", "GETNET"], ["SUMUP PAYOUT", "SUMUP"],
      ["BINANCE P2P", "BINANCE"], ["GLOBAL66 ENVIO", "GLOBAL66"], ["PAYPAL *VENTA", "PAYPAL"], ["MACH ABONO", "MACH"], ["TENPO ABONO", "TENPO"],
    ] as const) expect(plataformaEnGlosa(g)?.clave, g).toBe(clave);
  });
  it("no confunde un apellido con una plataforma", () => {
    expect(plataformaEnGlosa("TRANSFERENCIA DE PEDRO MACHUCA")).toBeNull();
    expect(plataformaEnGlosa("TRANSF DE FLORENCIA")).toBeNull();
  });
});

describe("claveContraparte", () => {
  it("plataforma > RUT > nombre", () => {
    expect(claveContraparte("MERCADOPAGO 12.345.678-5")).toMatchObject({ tipo: "canal", clave: "canal:MERCADOPAGO", etiqueta: "Mercado Pago" });
    expect(claveContraparte("TRANSF DE 12.345.678-5 JUAN PEREZ")).toMatchObject({ tipo: "rut", clave: "rut:12345678-5", etiqueta: "Juan Perez" });
    expect(claveContraparte("TRANSFERENCIA DE JUAN PEREZ")).toMatchObject({ tipo: "nombre", clave: "nombre:JUAN PEREZ", etiqueta: "Juan Perez", patron: "JUAN PEREZ" });
  });
  it("el RUT del receptor sirve si la glosa no lo trae", () => {
    expect(claveContraparte("TRANSF RECIBIDA", "11.111.111-1")).toMatchObject({ tipo: "rut", clave: "rut:11111111-1", etiqueta: "11111111-1" });
  });
  it("con y sin acento es la misma persona", () => {
    expect(claveContraparte("TRANSFERENCIA DE JOSÉ PÉREZ")?.clave).toBe(claveContraparte("TRANSF JOSE PEREZ")?.clave);
  });
  it("sin nadie reconocible → null", () => {
    expect(claveContraparte("TRANSFERENCIA 0012345")).toBeNull();
    expect(claveContraparte("")).toBeNull();
  });
});

describe("cuenta propia y empresas", () => {
  it("la glosa nombra a la propia empresa", () => {
    expect(pareceCuentaPropia("TRANSF DE COMERCIAL LOS ANDES", "Comercial Los Andes SpA")).toBe(true);
    expect(pareceCuentaPropia("TRASPASO CTA PROPIA", "Lo que sea SpA")).toBe(true);
    expect(pareceCuentaPropia("TRANSFERENCIA DE JUAN PEREZ", "Comercial Los Andes SpA")).toBe(false);
    // Solo palabras genéricas o muy cortas: no se puede saber → no se adivina.
    expect(pareceCuentaPropia("TRANSF INVERSIONES MV", "Inversiones MV SpA")).toBe(false);
    // Con 3+ palabras propias basta que falte una.
    expect(pareceCuentaPropia("TEF MARIA JOSE SOTO", "Maria Jose Soto Rojas EIRL")).toBe(true);
    expect(pareceCuentaPropia("TEF MARIA SOTO", "Maria Jose Soto Rojas EIRL")).toBe(false);
  });
  it("forma jurídica en la glosa", () => {
    expect(pareceEmpresa("TRANSF DE AGRICOLA SUR SPA")).toBe(true);
    expect(pareceEmpresa("TRANSF DE SERVICIOS X LTDA")).toBe(true);
    expect(pareceEmpresa("TRANSF DE FRUTOS S.A. 123")).toBe(true);
    expect(pareceEmpresa("TRANSF DE LISA SANCHEZ")).toBe(false);
  });
});
