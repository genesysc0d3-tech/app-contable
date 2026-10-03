import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parsePdfCartola } from "../parsers";
import { applyAdapter, inferirRangoFechas } from "./apply";
import { esPlanillaMapeable } from "./documento-cartola";
import { grillaDesdeItems, itemsDePdf, type ItemPdf } from "./pdf-grilla";
import { cartolaPdfSintetica, type MovPdf, type OpcionesPdf } from "./testing/cartola-pdf-sintetica";
import type { AdapterConfig, Row } from "./types";

/**
 * Cartolas en PDF por el lector determinístico (2026-10-02). Fixtures 100%
 * sintéticos que imitan el FORMATO de dos familias reales (testing/
 * cartola-pdf-sintetica.ts). Antes de este cambio un PDF iba a la IA como texto
 * plano (sin columnas, sin juez, sin sello) y uno corto se probaba como
 * comprobante; parsePdfCartola no existía.
 */

// El año de "dd/mm" sin año se decide contra HOY: fijar hoy en oct-2026 hace
// visible el bug (cartola de mar-2025 leída como mar-2026).
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-02T12:00:00-03:00")); });
afterAll(() => { vi.useRealTimers(); });

type Pre = { fecha: string; monto: number; tipo_flujo: string; descripcion: string };

async function leer(o: OpcionesPdf) {
  const c = await cartolaPdfSintetica(o);
  const r = await parsePdfCartola(c.pdf);
  return { c, r };
}

function exacta(pre: Pre[] | null | undefined, verdad: MovPdf[]) {
  expect(pre?.length).toBe(verdad.length);
  pre!.forEach((m, i) => {
    const v = verdad[i];
    expect({ i, fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA" })
      .toEqual({ i, fecha: v.fecha, monto: v.monto, tipo: v.tipo });
    expect(m.descripcion).toContain(v.glosa);
  });
}

const PROBADO = ["saldo", "total_banco"];

describe("cartola PDF formato 'itau' (Letter, dd/mm sin año, resumen abajo)", () => {
  it("12 filas: lee exacta, año del PERÍODO (no el actual) y sella por saldo", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 12, seed: 3 });
    expect(r).not.toBeNull();
    expect(r!.capa_usada).toBeLessThan(4);
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.preExtracted!.every((m) => m.fecha.startsWith("2025-03"))).toBe(true);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });

  it("8 filas (bajo el mínimo del sello por saldo): sella con el resumen del banco plegado (Total cargos / Total Abono)", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 8, seed: 5 });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("total_banco");
  });

  it("8 filas SIN resumen: la lectura es correcta pero no hay prueba → sin sello (popup)", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 8, seed: 5, sinResumen: true });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("sin_comprobar");
  });

  it("multipágina (40 filas): el título repetido no es movimiento, no se pierden ni duplican filas", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 40, seed: 11 });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });

  it("glosa partida en 2 líneas: se pega entera a su movimiento", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 14, seed: 13, glosaMultilinea: true });
    expect(c.verdad.some((m) => m.glosa.split(" ").length > 4)).toBe(true);
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });

  it("cruce dic→ene: período de diciembre deja las fechas en ese año", async () => {
    const { c, r } = await leer({ formato: "itau", filas: 10, seed: 17, anio: 2025, mes: 12 });
    exacta(r!.preExtracted as Pre[], c.verdad);
  });
});

describe("cartola PDF formato 'estado' (A4, dd-mm-aaaa, cargos con signo en su columna)", () => {
  it("120 filas en 3 páginas: exacta y sellada por saldo", async () => {
    const { c, r } = await leer({ formato: "estado", filas: 120, seed: 21, anio: 2022 });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });

  it("saldo negativo (sobregiro): exacta y sellada", async () => {
    const { c, r } = await leer({ formato: "estado", filas: 30, seed: 23, saldoInicial: -1_200_000 });
    expect(c.saldoInicial).toBeLessThan(0);
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });

  it("glosa partida en 2 líneas", async () => {
    const { c, r } = await leer({ formato: "estado", filas: 24, seed: 29, glosaMultilinea: true });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
  });
});

describe("pocas filas (hallazgos del corpus PDF en la mini)", () => {
  it("'estado' con 3 movimientos: los títulos ganan a la heurística que tomaba «Saldo» como abono, y sella con el encabezado del banco (Cargos / Giros, Depositos / Abonos, Saldo Actual)", async () => {
    const { c, r } = await leer({ formato: "estado", filas: 3, seed: 886, anio: 2023, mes: 3 });
    exacta(r!.preExtracted as Pre[], c.verdad);
    expect(r!.censo?.verificacion?.tipo).toBe("total_banco");
  });
  for (const unSentido of ["cargos", "abonos"] as const) {
    it(`'estado' con un mes de solo ${unSentido}: la columna vacía con título se respeta (antes: "Cargos Abonos" en una celda y la hoja no se leía)`, async () => {
      const { c, r } = await leer({ formato: "estado", filas: 12, seed: 1856, unSentido });
      exacta(r!.preExtracted as Pre[], c.verdad);
      expect(PROBADO).toContain(r!.censo?.verificacion?.tipo);
    });
  }
  it("'itau' con 4 movimientos y un monto alterado: la columna «Saldo diario» que el mapa no usó contradice → sin sello (antes: total_banco)", async () => {
    const { r } = await leer({ formato: "itau", filas: 4, seed: 4960, montoAlterado: true });
    expect(r!.censo?.verificacion).toMatchObject({ tipo: "sin_comprobar", contradice: "saldo" });
  });
});

describe("sabotajes: nunca un sello sobre una lectura que no calza", () => {
  for (const formato of ["itau", "estado"] as const) {
    it(`${formato}: un monto impreso no calza con su saldo → sin sello`, async () => {
      const { r } = await leer({ formato, filas: 20, seed: 31, montoAlterado: true });
      expect(PROBADO).not.toContain(r?.censo?.verificacion?.tipo ?? "sin_comprobar");
    });
    it(`${formato}: títulos cargo↔abono cruzados → sin sello`, async () => {
      const { r } = await leer({ formato, filas: 20, seed: 37, titulosCruzados: true });
      expect(PROBADO).not.toContain(r?.censo?.verificacion?.tipo ?? "sin_comprobar");
    });
  }
});

describe("PDF que no es cartola (ver también pdf-router.test.ts)", () => {
  it("un comprobante de transferencia (1 fecha, 1 monto) → null: sigue el flujo de comprobante", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.text("Comprobante de transferencia", 40, 60);
    doc.text("Fecha: 02/10/2026", 40, 90);
    doc.text("Monto transferido: $ 150.000", 40, 110);
    doc.text("Destinatario: Persona Ficticia", 40, 130);
    const r = await parsePdfCartola(new Uint8Array(doc.output("arraybuffer")));
    expect(r).toBeNull();
  });
});

describe("grilla por posiciones (unidad)", () => {
  const it_ = (str: string, x: number, y: number, w: number, pagina = 1): ItemPdf => ({ str, x, y, w, pagina });
  it("los montos alineados a la derecha caen en SU columna aunque cambie el ancho", () => {
    const items = [
      it_("Fecha", 42, 700, 20), it_("Glosa", 94, 700, 30), it_("Cargos", 403, 700, 25), it_("Abonos", 454, 700, 28), it_("Saldo", 505, 700, 22),
      it_("01-03-2022", 42, 688, 36), it_("Glosa uno", 94, 688, 60), it_("$ -9.999", 420, 688, 29), it_("$ 90.001", 512, 688, 41),
      it_("02-03-2022", 42, 676, 36), it_("Glosa dos", 94, 676, 60), it_("$ 1.000.000", 456, 676, 45), it_("$ 1.090.001", 508, 676, 45),
    ];
    const rows = grillaDesdeItems(items);
    expect(rows).toEqual([
      ["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"],
      ["01-03-2022", "Glosa uno", "$ -9.999", "", "$ 90.001"],
      ["02-03-2022", "Glosa dos", "", "$ 1.000.000", "$ 1.090.001"],
    ]);
  });
  it("menos de 2 movimientos → grilla vacía (no es cartola)", () => {
    expect(grillaDesdeItems([it_("Fecha: 02/10/2026", 40, 700, 80), it_("$ 150.000", 200, 700, 40)])).toEqual([]);
  });
});

describe("año de 'dd/mm' desde «Período: dd/mm/aaaa - dd/mm/aaaa»", () => {
  const cfg = { header_row: 2, skip_rows_before_data: 3, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
    columns: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4 } } as unknown as AdapterConfig;
  const filas = (encabezado: Row): Row[] => [
    encabezado, [], ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"],
    ["03/03", "Pago", "$1.000", "$0", "$9.000"], ["28/03", "Abono", "$0", "$500", "$9.500"],
  ];
  it("misma celda", () => {
    const rows = filas(["Cartola Histórica", "Período: 01/03/2025 - 31/03/2025"]);
    expect(inferirRangoFechas(rows, cfg)).toMatchObject({ min: "2025-03-01", max: "2025-03-31", explicito: true });
    expect(applyAdapter(rows, cfg).map((l) => l.fecha)).toEqual(["2025-03-03", "2025-03-28"]);
  });
  it("etiqueta y fechas en celdas vecinas", () => {
    const rows = filas(["Período", ": 01/03/2025 - 31/03/2025"]);
    expect(applyAdapter(rows, cfg).map((l) => l.fecha)).toEqual(["2025-03-03", "2025-03-28"]);
  });
});

describe("itemsDePdf", () => {
  it("lee posiciones de un PDF sintético (todas las páginas)", async () => {
    const { pdf } = await cartolaPdfSintetica({ formato: "estado", filas: 60, seed: 1 });
    const items = await itemsDePdf(pdf);
    expect(new Set(items.map((i) => i.pagina)).size).toBeGreaterThan(1);
    expect(items.every((i) => Number.isFinite(i.x) && Number.isFinite(i.y))).toBe(true);
  });
});

describe("popup «Revisa las columnas»", () => {
  it("un PDF es mapeable (ve la misma grilla que leyó la cola); una imagen no", () => {
    expect(esPlanillaMapeable("pdf")).toBe(true);
    expect(esPlanillaMapeable("imagen")).toBe(false);
  });
});
