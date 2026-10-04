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
    // un número de operación con guion no es un RUT
    for (const g of ["OP 12345678-5", "OPERACION 12345678-5", "N° 12345678-5", "FOLIO 12345678-5", "NRO: 12345678-5"]) expect(rutEnGlosa(g), g).toBeNull();
  });
});

describe("plataformas de pago = canal", () => {
  it("reconoce las plataformas de la lista", () => {
    for (const [g, clave] of [
      ["ABONO MERCADOPAGO 76.123", "MERCADOPAGO"], ["TRANSF MERCADO PAGO SPA", "MERCADOPAGO"], ["PAGO FLOW", "FLOW"],
      ["KHIPU TRANSFER", "KHIPU"], ["WEBPAY PLUS", "WEBPAY"], ["GETNET LIQ", "GETNET"], ["SUMUP PAYOUT", "SUMUP"],
      ["BINANCE P2P", "BINANCE"], ["MERCADOLIBRE LIQ", "MERCADOLIBRE"], ["MERCADO LIBRE VENTA", "MERCADOLIBRE"], ["GLOBAL66 ENVIO", "GLOBAL66"], ["PAYPAL *VENTA", "PAYPAL"], ["MACH ABONO", "MACH"], ["TENPO ABONO", "TENPO"],
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
  it("glosas genéricas NO son personas (bancos, efectivo, parentescos, bonos…) → una por una", () => {
    const genericas = [
      "DEPOSITO EFECTIVO", "DEPOSITO EN EFECTIVO", "TRANSFERENCIA INTERBANCARIA", "TRASPASO DE FONDOS", "TRASPASO FONDOS CUENTA VISTA",
      "ABONO CUENTA VISTA", "TRANSF BANCO DE CHILE", "TRANSF BANCOESTADO", "TRANSFERENCIA BANCO ESTADO", "TRANSF SANTANDER",
      "TRANSF BCI", "TRANSF ITAU", "TRANSF SCOTIABANK", "TRANSF BICE", "TRANSF SECURITY", "TRANSF FALABELLA", "TRANSF RIPLEY",
      "TRANSF BANCO INTERNACIONAL", "TRANSF CONSORCIO", "BONO GOBIERNO", "PAGO IFE", "ABONO BONO", "TRANSFERENCIA DE MAMA",
      "TRANSF DE PAPA", "TRANSFERENCIA HIJO", "TRANSF HIJA", "TRANSF DE MAMÁ", "TRANSF A PAPÁ", "COMPRA DIVISAS",
      "ABONO DEPOSITO", "DEPOSITO CHEQUE", "TRANSFERENCIA FONDOS", "ABONO INTERBANCARIO", "COMPRA EFECTIVO", "DEPOSITO VISTA",
    ];
    expect(genericas).toHaveLength(35);
    for (const g of genericas) expect(claveContraparte(g), g).toBeNull();
    // ...pero la persona detrás de la palabra genérica sí se reconoce
    expect(claveContraparte("TRANSF BANCO ESTADO DE JUAN PEREZ")?.clave).toBe("nombre:JUAN PEREZ");
  });
  it("CENSO de glosas reales de bancos chilenos: ninguna es una persona (vuelta 2)", () => {
    const reales = [
      "ABONO TEF OTROS BANCOS", "TRANSF RECIBIDA OTROS BANCOS", "DEP.EFECTIVO CAJA VECINA", "TRANSF. DESDE CUENTARUT",
      "DEPOSITO CAJERO AUTOMATICO", "DEPOSITO DOCUMENTOS", "TEF ENTRANTE", "RECIBISTE DINERO", "DINERO RECIBIDO",
      "ABONO CUENTA CORRIENTE FALABELLA", "RENDIMIENTOS", "INTERESES GANADOS", "OTROS ABONOS", "MISMO BANCO",
      "TRANS RECIBIDA", "NOMINA", "PAGO NOMINA", "PENSION", "ANTICIPO", "BONO INVIERNO", "APORTE FAMILIAR",
      "TRANSFERENCIA RECIBIDA", "TRANSFERENCIA ELECTRONICA RECIBIDA", "TEF RECIBIDA BANCO ESTADO", "TEF DESDE BANCO DE CHILE",
      "ABONO TRANSFERENCIA SANTANDER", "TRASPASO DESDE CUENTA VISTA", "TRASPASO DE FONDOS MISMO BANCO", "DEPOSITO EN EFECTIVO",
      "DEP EFECTIVO SUCURSAL", "DEPOSITO CHEQUE OTROS BANCOS", "DEPOSITO DOCUMENTOS OTROS BANCOS", "ABONO DEPOSITO CAJA VECINA",
      "TRANSF ENTRANTE BCI", "TRANSF ENTRANTE ITAU", "TEF RECIBIDA SCOTIABANK", "ABONO BICE", "TRANSFERENCIA SECURITY",
      "ABONO RIPLEY", "TRANSF BANCO INTERNACIONAL", "TRANSF CONSORCIO", "PAGO BONO GOBIERNO", "BONO IFE", "PAGO PENSION",
      "ANTICIPO NOMINA", "APORTE FAMILIAR PERMANENTE", "BONO INVIERNO GOBIERNO", "INTERESES GANADOS CUENTA", "RENDIMIENTOS FONDOS MUTUOS",
      "ABONO INTERESES", "DINERO RECIBIDO OTROS BANCOS", "RECIBISTE DINERO DE OTRO BANCO", "TRANSFERENCIA DE MAMA",
      "TRANSF A PAPA", "TRANSF HIJO", "TRANSFERENCIA HIJA", "TRANSF DE MAMÁ", "COMPRA DIVISAS", "VENTA DIVISAS",
      "DEPOSITO CUENTARUT", "ABONO CUENTARUT", "TRANSF DESDE CUENTA CORRIENTE", "TRANSF MISMO TITULAR", "ABONO NACIONALES",
      "TEF OTRO BANCO", "TRANSFERENCIA INTERBANCARIA", "ABONO EN LINEA", "TRANSFERENCIA DE FONDOS", "ABONO AUTOMATICO",
      "DEPOSITO CAJERO", "TRANSFERENCIA DE CAMILA",
    ];
    expect(reales.length).toBeGreaterThanOrEqual(70);
    const personas = reales.filter((g) => { const c = claveContraparte(g); return c && c.tipo !== "canal"; });
    expect(personas).toEqual([]);
  });
  it("una persona necesita ≥2 palabras de nombre (una sola → una por una)", () => {
    expect(claveContraparte("TRANSFERENCIA DE CAMILA")).toBeNull();
    expect(claveContraparte("ABONO TEF OTROS BANCOS JUAN PEREZ")).toMatchObject({ clave: "nombre:JUAN PEREZ" });
    // RUT sin nombre: se agrupa por RUT pero no trae patrón (no acuña regla)
    expect(claveContraparte("TEF 12.345.678-5 CAMILA")).toMatchObject({ tipo: "rut", patron: null });
  });
  it("sin nadie reconocible → null", () => {
    expect(claveContraparte("TRANSFERENCIA 0012345")).toBeNull();
    expect(claveContraparte("")).toBeNull();
  });
});

describe("cuenta propia y empresas", () => {
  it("la glosa nombra a la propia empresa", () => {
    expect(pareceCuentaPropia("TRANSF DE AGRICOLA LOS ANDES", "Agricola Los Andes Sur SpA")).toBe(false);
    expect(pareceCuentaPropia("TRANSF DE AGRICOLA ANDES SUR", "Agricola Andes Sur SpA")).toBe(true);
    expect(pareceCuentaPropia("TRASPASO CTA PROPIA", "Lo que sea SpA")).toBe(true);
    expect(pareceCuentaPropia("TRANSFERENCIA DE JUAN PEREZ", "Comercial Los Andes SpA")).toBe(false);
    // Solo palabras genéricas o muy cortas: no se puede saber → no se adivina.
    expect(pareceCuentaPropia("TRANSF INVERSIONES MV", "Inversiones MV SpA")).toBe(false);
    // Nombre COMPLETO, nunca un apellido suelto ni "casi todo".
    expect(pareceCuentaPropia("TEF MARIA JOSE SOTO ROJAS", "Maria Jose Soto Rojas EIRL")).toBe(true);
    expect(pareceCuentaPropia("TEF MARIA JOSE SOTO", "Maria Jose Soto Rojas EIRL")).toBe(false);
    expect(pareceCuentaPropia("TRANSF DE PEDRO SOTO", "Soto SpA")).toBe(false); // un token suelto nunca
    expect(pareceCuentaPropia("TRANSF DE ANDES", "Comercial Los Andes SpA")).toBe(false);
    // Vuelta 2: una palabra distintiva JUNTO a una genérica de la razón social
    expect(pareceCuentaPropia("TRANSF COMERCIAL ROJAS", "Comercial Rojas SpA")).toBe(true);
    expect(pareceCuentaPropia("TRANSFERENCIA DE CAMILA ROJAS", "Comercial Rojas SpA")).toBe(false);
    expect(pareceCuentaPropia("TEF INVERSIONES LAGOS", "Inversiones Lagos Ltda")).toBe(true);
    expect(pareceCuentaPropia("TEF INV LAGOS", "Inversiones Lagos Ltda")).toBe(true);
    expect(pareceCuentaPropia("TEF PEDRO LAGOS", "Inversiones Lagos Ltda")).toBe(false);
    expect(pareceCuentaPropia("TRANSFERENCIA PROPIA", "X SpA")).toBe(true);
    expect(pareceCuentaPropia("TRASPASO PROPIO", "X SpA")).toBe(true);
    // el RUT de la empresa en la glosa
    const rut = `76123456-${dvRut("76123456")}`;
    expect(pareceCuentaPropia(`TEF DESDE 76.123.456-${dvRut("76123456")}`, "Lo que sea SpA", rut)).toBe(true);
    expect(pareceCuentaPropia("TEF DESDE 12.345.678-5", "Lo que sea SpA", rut)).toBe(false);
    // persona natural truncada por el banco
    expect(pareceCuentaPropia("TRANSF JUAN PEREZ S", "Juan Perez Soto")).toBe(true);
    expect(pareceCuentaPropia("TRANSF JUAN PEREZ", "Juan Perez Soto")).toBe(false);
    expect(pareceCuentaPropia("TRANSF JUAN PEREZ R", "Juan Perez Soto")).toBe(false);
  });
  it("forma jurídica en la glosa", () => {
    expect(pareceEmpresa("TRANSF DE AGRICOLA SUR SPA")).toBe(true);
    expect(pareceEmpresa("TRANSF DE SERVICIOS X LTDA")).toBe(true);
    expect(pareceEmpresa("TRANSF DE FRUTOS S.A. 123")).toBe(true);
    expect(pareceEmpresa("TRANSF DE LISA SANCHEZ")).toBe(false);
  });
});
