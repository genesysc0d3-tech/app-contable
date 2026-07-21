import { describe, expect, it } from "vitest";
import { extraerPatronContraparte, regexContraparte } from "./aprender-regla";

// Extracción de la clave de contraparte: la pieza que decide QUÉ se aprende.
// Debe extraer nombres específicos y RECHAZAR (null) glosas genéricas, para no
// crear reglas que sobre-matcheen y auto-clasifiquen movimientos ajenos.
describe("extraerPatronContraparte", () => {
  it("extrae el nombre tras el verbo bancario (caso P2P real)", () => {
    expect(extraerPatronContraparte("TRANSFERENCIA DE JUAN PEREZ")).toEqual({
      patron: "JUAN PEREZ",
    });
    expect(extraerPatronContraparte("TEF DE MARIA SOTO 09:23")?.patron).toBe("MARIA SOTO");
  });

  it("bota los sufijos jurídicos (SPA, LTDA) del patrón", () => {
    expect(extraerPatronContraparte("TRANSFERENCIA DE JUAN PEREZ SPA")?.patron).toBe("JUAN PEREZ");
    expect(extraerPatronContraparte("TEF DE COMERCIAL SOTO LTDA")?.patron).toBe("COMERCIAL SOTO");
  });

  it("funciona sin verbo, con el puro nombre", () => {
    expect(extraerPatronContraparte("JUAN PEREZ")?.patron).toBe("JUAN PEREZ");
  });

  it("conserva acentos (para matchear la glosa cruda, que también los trae)", () => {
    // Ñ se normaliza a N (NFD quita el diacrítico), pero las vocales acentuadas
    // se mantienen porque la glosa futura las trae igual.
    const r = extraerPatronContraparte("TRANSFERENCIA DE JOSÉ TAPIA");
    expect(r?.patron).toBe("JOSÉ TAPIA");
  });

  it("descarta dígitos, horas y referencias del patrón", () => {
    expect(extraerPatronContraparte("TEF DE PEDRO GONZALEZ REF 88213 12/07")?.patron).toBe(
      "PEDRO GONZALEZ",
    );
  });

  it("RECHAZA glosas genéricas (null → no se aprende)", () => {
    expect(extraerPatronContraparte("TRANSFERENCIA ELECTRONICA INTERNET")).toBeNull();
    expect(extraerPatronContraparte("PAGO PROVEEDORES")).toBeNull();
    expect(extraerPatronContraparte("ABONO")).toBeNull();
    expect(extraerPatronContraparte("TEF 123456")).toBeNull();
    expect(extraerPatronContraparte("TRANSF")).toBeNull();
    expect(extraerPatronContraparte("")).toBeNull();
    expect(extraerPatronContraparte(null)).toBeNull();
  });

  it("RECHAZA un solo token corto (evita sobre-match tipo 'ANA'/'LUZ')", () => {
    expect(extraerPatronContraparte("PAGO A ANA")).toBeNull(); // ANA = 3 letras
    expect(extraerPatronContraparte("TEF UBER")).toBeNull(); // UBER = 4 letras, un token
    // Un solo nombre de ≥5 letras sí pasa.
    expect(extraerPatronContraparte("TRANSFERENCIA DE PEDRO")?.patron).toBe("PEDRO");
  });

  it("cae al receptor confirmado si la glosa no da nada", () => {
    expect(extraerPatronContraparte("ABONO INTERNET", "CAROLINA REYES")?.patron).toBe(
      "CAROLINA REYES",
    );
  });

  it("el patrón resultante realmente re-matchea la glosa que lo originó", () => {
    // Invariante de correctitud: si aprendemos de una glosa, la regla creada debe
    // volver a matchear esa misma glosa (via el regex con límites de palabra).
    const glosa = "TRANSFERENCIA DE JOSÉ TAPIA 14:05";
    const r = extraerPatronContraparte(glosa);
    expect(r).not.toBeNull();
    const re = new RegExp(regexContraparte(r!.patron), "i");
    expect(re.test(glosa)).toBe(true);
  });
});

describe("regexContraparte (límite de palabra, no substring)", () => {
  it("MARIA no se lleva MARIANA; JUAN no se lleva JUANA", () => {
    const reMaria = new RegExp(regexContraparte("MARIA"), "i");
    expect(reMaria.test("TRANSFERENCIA DE MARIA SOTO")).toBe(true);
    expect(reMaria.test("TRANSFERENCIA DE MARIANA REYES")).toBe(false);
    const reJuan = new RegExp(regexContraparte("JUAN"), "i");
    expect(reJuan.test("ABONO JUAN")).toBe(true);
    expect(reJuan.test("ABONO JUANA")).toBe(false);
  });

  it("respeta acentos y separadores no-letra (coma, dígitos)", () => {
    const re = new RegExp(regexContraparte("JOSÉ TAPIA"), "i");
    expect(re.test("TRANSFERENCIA DE JOSÉ TAPIA, REF 5")).toBe(true);
    expect(re.test("PAGO A JOSÉ TAPIALES")).toBe(false); // no es sub-palabra
  });

  it("matchea al inicio y al fin de la glosa", () => {
    const re = new RegExp(regexContraparte("JUAN PEREZ"), "i");
    expect(re.test("JUAN PEREZ")).toBe(true);
    expect(re.test("abono juan perez")).toBe(true);
  });
});
