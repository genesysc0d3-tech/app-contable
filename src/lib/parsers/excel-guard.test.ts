import { describe, expect, it } from "vitest";
import { hojaExcedeCeldas, MAX_CELDAS_HOJA } from "./excel-guard";

// Protege el techo anti zip-bomb: un .xlsx chico puede DECLARAR un rango
// gigante (!ref A1:XFD1048576) que sheet_to_json materializa a millones de
// strings. Si alguien relaja el guard (lo hace fail-open o sube el techo a
// lo loco), estos tests muerden.

describe("hojaExcedeCeldas — techo anti zip-bomb", () => {
  it("una cartola real pasa (500 filas × 12 columnas)", () => {
    expect(hojaExcedeCeldas({ "!ref": "A1:L500" })).toBe(false);
  });

  it("el rango máximo de Excel (17 mil millones de celdas) se rechaza", () => {
    expect(hojaExcedeCeldas({ "!ref": "A1:XFD1048576" })).toBe(true);
  });

  it("justo sobre el techo se rechaza", () => {
    // 100 columnas (A..CV) × filas suficientes para pasar el techo
    const filas = Math.ceil(MAX_CELDAS_HOJA / 100) + 1;
    expect(hojaExcedeCeldas({ "!ref": `A1:CV${filas}` })).toBe(true);
  });

  it("sin !ref no bloquea (hoja vacía legítima)", () => {
    expect(hojaExcedeCeldas({})).toBe(false);
    expect(hojaExcedeCeldas(undefined)).toBe(false);
  });

  it("FAIL-CLOSED: rango ilegible se rechaza", () => {
    expect(hojaExcedeCeldas({ "!ref": "no-es-un-rango" })).toBe(true);
  });
});
