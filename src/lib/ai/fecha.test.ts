import { describe, expect, it } from "vitest";
import { parseFecha } from "./fecha";

// parseFecha cae a "hoy" (no determinista) cuando no puede parsear. Por eso
// sólo afirmamos valores concretos en casos con fecha explícita, y para los
// no parseables verificamos únicamente la FORMA (ISO YYYY-MM-DD).
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("parseFecha — normaliza fechas a YYYY-MM-DD", () => {
  it("ya viene en ISO YYYY-MM-DD (con padding)", () => {
    expect(parseFecha("2026-06-14")).toBe("2026-06-14");
    expect(parseFecha("2026-6-4")).toBe("2026-06-04");
  });

  it("ISO con / o : como separador", () => {
    expect(parseFecha("2026/06/14")).toBe("2026-06-14");
    expect(parseFecha("2026:06:14")).toBe("2026-06-14");
  });

  it("DD/MM/YYYY, DD-MM-YYYY y DD.MM.YYYY", () => {
    expect(parseFecha("14/06/2026")).toBe("2026-06-14");
    expect(parseFecha("14-06-2026")).toBe("2026-06-14");
    expect(parseFecha("14.06.2026")).toBe("2026-06-14");
  });

  it("toma el prefijo fecha aunque traiga hora detrás (timestamp de cartola)", () => {
    expect(parseFecha("14/06/2026 10:30:00")).toBe("2026-06-14");
  });

  it("año de 2 dígitos con pivote en 50 (>50 = 19xx, <=50 = 20xx)", () => {
    expect(parseFecha("14/06/26")).toBe("2026-06-14");
    expect(parseFecha("14/06/50")).toBe("2050-06-14");
    expect(parseFecha("14/06/51")).toBe("1951-06-14");
  });

  it("fechas en texto español (día mes año)", () => {
    expect(parseFecha("06 de noviembre 2025")).toBe("2025-11-06");
    expect(parseFecha("6 noviembre 2025")).toBe("2025-11-06");
    expect(parseFecha("6 nov. 2025")).toBe("2025-11-06");
  });

  it("fechas en texto español (mes día, año)", () => {
    expect(parseFecha("noviembre 06, 2025")).toBe("2025-11-06");
    expect(parseFecha("nov 6, 2025")).toBe("2025-11-06");
  });

  it("entrada inutilizable cae a 'hoy' pero SIEMPRE con forma ISO válida", () => {
    // No afirmamos el valor (es 'hoy', no determinista): sólo la forma.
    expect(parseFecha("")).toMatch(ISO_RE);
    expect(parseFecha("texto libre sin fecha")).toMatch(ISO_RE);
  });
});
