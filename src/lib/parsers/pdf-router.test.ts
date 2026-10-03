import { describe, expect, it, vi } from "vitest";
import { parsePdfCartola, type DiagnosticoPdf } from "../parsers";
import { clasificarPdf } from "./pdf-router";
import { itemsDePdf, type ItemPdf } from "./pdf-grilla";
import {
  cartolaPdfSintetica, ESPERADO_NEGATIVO, negativoPdfSintetico, TIPOS_NEGATIVOS, type OpcionesPdf,
} from "./testing/cartola-pdf-sintetica";

/** Router de PDF (2026-10-02): solo "cartola" entra al lector; la duda, nunca. */

describe("negativos: PDFs con tablas de fecha+monto que NO son cartola", () => {
  for (const tipo of TIPOS_NEGATIVOS) {
    it(`${tipo} → ${ESPERADO_NEGATIVO[tipo]}, nunca al lector`, async () => {
      for (const seed of [1, 2, 3]) {
        const pdf = await negativoPdfSintetico(tipo, seed, 6 + seed * 3);
        const ruta = clasificarPdf(await itemsDePdf(pdf));
        expect({ tipo, seed, r: ruta.tipo }).toEqual({ tipo, seed, r: ESPERADO_NEGATIVO[tipo] });
        let d: DiagnosticoPdf | null = null;
        expect(await parsePdfCartola(pdf, { diagnostico: (x) => { d = x; } })).toBeNull();
        expect(d!.tipo).not.toBe("cartola");
      }
    });
  }
});

describe("cartolas sintéticas → todas al lector", () => {
  const casos: OpcionesPdf[] = [
    { formato: "itau", filas: 12, seed: 3 }, { formato: "itau", filas: 3, seed: 9, sinResumen: true },
    { formato: "estado", filas: 60, seed: 4 }, { formato: "estado", filas: 2, seed: 7 },
    // Títulos cruzados: no es formato conocido, pero sí cartola (y el juez no la sella).
    { formato: "itau", filas: 20, seed: 37, titulosCruzados: true }, { formato: "estado", filas: 20, seed: 37, titulosCruzados: true },
  ];
  for (const o of casos) {
    it(`${o.formato} ${o.filas} filas${o.titulosCruzados ? " títulos cruzados" : ""} → cartola`, async () => {
      const ruta = clasificarPdf(await itemsDePdf((await cartolaPdfSintetica(o)).pdf));
      expect(ruta.tipo).toBe("cartola");
      expect(ruta.motivo).toBe(o.titulosCruzados ? "senales_cartola" : "formato_conocido");
    });
  }
});

describe("reglas del router (unidad)", () => {
  const linea = (y: number, ...celdas: [string, number][]): ItemPdf[] => celdas.map(([str, x]) => ({ str, x, y, w: str.length * 4, pagina: 1 }));
  const tablaBancaria = [
    ...linea(700, ["Fecha", 40], ["Descripción", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]),
    ...linea(688, ["01/09/2026", 40], ["Pago", 100], ["$ 1.000", 300], ["$ 9.000", 460]),
    ...linea(676, ["02/09/2026", 40], ["Abono", 100], ["$ 500", 380], ["$ 9.500", 460]),
  ];
  it("tabla bancaria sin ninguna otra marca de cartola → otro (no se adivina)", () => {
    expect(clasificarPdf(tablaBancaria)).toMatchObject({ tipo: "otro", motivo: "sin_marcas_de_cartola" });
  });
  it("+ «Saldo anterior» en el encabezado → cartola", () => {
    expect(clasificarPdf([...linea(740, ["Saldo anterior", 40], ["$ 10.000", 140]), ...tablaBancaria]).tipo).toBe("cartola");
  });
  it("+ marca de cartola Y de tarjeta → prioriza la no-cartola", () => {
    expect(clasificarPdf([...linea(750, ["Pago mínimo $ 5.000", 40]), ...linea(740, ["Saldo anterior", 40]), ...tablaBancaria]).tipo).toBe("tarjeta");
  });
  it("señales de dos tipos no-cartola → otro", () => {
    expect(clasificarPdf([...linea(750, ["Factura electrónica", 40]), ...linea(740, ["Pago mínimo", 40]), ...tablaBancaria]))
      .toMatchObject({ tipo: "otro", motivo: "senales_de_varios_tipos" });
  });
  it("una glosa «PAGO FACTURA» o «TRANSFERENCIA A» dentro de la tabla NO es señal de factura/comprobante", () => {
    const t = [...linea(740, ["Cartola", 40], ["Saldo anterior", 140]), ...tablaBancaria,
      ...linea(664, ["03/09/2026", 40], ["Pago factura electrónica 123 monto transferido", 100], ["$ 100", 300], ["$ 9.400", 460])];
    expect(clasificarPdf(t).tipo).toBe("cartola");
  });
});

describe("hallazgos de la revisión", () => {
  it("PDF con más páginas que MAX_PAGINAS → null (no se sella con páginas sin leer)", async () => {
    vi.resetModules();
    vi.doMock("./pdf-grilla", async (orig) => ({ ...(await orig<typeof import("./pdf-grilla")>()), MAX_PAGINAS: 1, leerItemsPdf: async () => ({ items: [], paginas: 2, truncado: true }) }));
    const { parsePdfCartola: p } = await import("../parsers");
    let d: DiagnosticoPdf | null = null;
    expect(await p(new Uint8Array([1]), { diagnostico: (x) => { d = x; } })).toBeNull();
    expect(d).toMatchObject({ tipo: "otro", motivo: "demasiadas_paginas" });
    vi.doUnmock("./pdf-grilla");
    vi.resetModules();
  });
});
