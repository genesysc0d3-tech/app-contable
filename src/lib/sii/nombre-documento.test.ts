import { describe, expect, it } from "vitest";
import { archivoPdf, esTipoExento, etiquetaTipo, nombreDocumento, tituloDocumento } from "./nombre-documento";

/**
 * Matías 2026-09-07: una factura descargada se llamaba "boleta-34-1234.pdf".
 * El nombre sale del TIPO, en un solo lugar.
 */
describe("nombre del documento por tipo", () => {
  it("33/34 son Factura; 39/41 Boleta; 61 Nota de crédito", () => {
    expect(nombreDocumento(33)).toBe("Factura");
    expect(nombreDocumento(34)).toBe("Factura");
    expect(nombreDocumento(39)).toBe("Boleta");
    expect(nombreDocumento(41)).toBe("Boleta");
    expect(nombreDocumento(61)).toBe("Nota de crédito");
    expect(nombreDocumento(52)).toBe("Documento");
  });

  it("el archivo se llama 'Factura N°1234.pdf', tal cual lo pidió Matías", () => {
    expect(archivoPdf(34, 1234)).toBe("Factura N°1234.pdf");
    expect(archivoPdf(33, 7)).toBe("Factura N°7.pdf");
    expect(archivoPdf(41, 960)).toBe("Boleta N°960.pdf");
    expect(archivoPdf(39, 12, "proveedor legado")).toBe("Boleta N°12 proveedor legado.pdf");
    expect(archivoPdf(34, 1234)).not.toMatch(/boleta/i);
  });

  it("título y sello no se cruzan entre mesas", () => {
    expect(tituloDocumento(33, 5)).toBe("Factura N°5");
    expect(etiquetaTipo(33)).toBe("AFECTA");
    expect(etiquetaTipo(34)).toBe("EXENTA");
    expect(etiquetaTipo(39)).toBe("AFECTA");
    expect(etiquetaTipo(41)).toBe("EXENTA");
    expect(etiquetaTipo(61)).toBe("NC");
    expect(etiquetaTipo(52)).toBe("DTE 52");
  });

  it("exento = 41 o 34, nada más", () => {
    expect([33, 34, 39, 41, 61].filter(esTipoExento)).toEqual([34, 41]);
  });
});
