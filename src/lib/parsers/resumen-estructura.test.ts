import { describe, expect, it } from "vitest";
import { applyAdapter } from "./apply";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Punto 2: la fila de resumen se decide por ESTRUCTURA (sin fecha válida en la
// columna fecha, palabra fuera de la glosa, fórmula SUM), nunca por un bloque
// pegajoso que se prende con una palabra dentro de una glosa. Hallazgo 0.1-1 de
// docs/investigacion-lector-cartolas-2026-09-30.md (apply.ts:294 viejo).

const cfg: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean",
  layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 },
};

describe("'TOTAL' en una glosa no apaga el censo", () => {
  const rows: Row[] = [
    ["Fecha", "Glosa", "Cargo", "Abono"],
    ["01/09/2026", "Venta mostrador", "", "10.000"],
    ["02/09/2026", "PAGO TOTAL TARJETA CREDITO", "300.000", ""],
    ["31/09/2026", "Abono con fecha imposible", "", "250.000"],
    ["", "Abono sin fecha", "", "80.000"],
    ["05/09/2026", "Venta tarde", "", "20.000"],
  ];

  it("el movimiento con 'TOTAL' en la glosa se lee como movimiento", () => {
    const lines = applyAdapter(rows, cfg, []);
    expect(lines.map((l) => l.excel_row)).toEqual([2, 3, 6]);
  });

  it("las filas perdidas después NO quedan como 'resumen legítimo'", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter(rows, cfg, descartes);
    expect(descartes.map((d) => [d.excel_row, d.motivo, d.legitimo])).toEqual([
      [4, "fecha_imposible", false],
      [5, "sin_fecha", false],
    ]);
  });
});

describe("el resumen real del banco sigue siendo legítimo", () => {
  it("bloque 'RESUMEN DEL PERIODO' al pie: sus filas sin fecha son legítimas", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "Venta", "", "10.000"],
      ["02/09/2026", "Compra", "4.000", ""],
      ["RESUMEN DEL PERIODO", "", "", ""],
      ["", "Cantidad de giros", "3", ""],
      ["TOTAL ABONOS", "", "", "10.000"],
    ], cfg, descartes);
    expect(lines).toHaveLength(2);
    expect(descartes.every((d) => d.legitimo && d.motivo === "resumen")).toBe(true);
    expect(descartes).toHaveLength(2);
  });

  it("el bloque de resumen se cierra en cuanto vuelve una fila con fecha válida", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "Venta", "", "10.000"],
      ["", "Subtotal página 1", "", "10.000"],
      ["02/09/2026", "Venta página 2", "", "7.000"],
      ["", "Abono perdido sin fecha", "", "3.000"],
    ], cfg, descartes);
    expect(lines.map((l) => l.excel_row)).toEqual([2, 4]);
    expect(descartes.map((d) => [d.excel_row, d.legitimo])).toEqual([[3, true], [5, false]]);
  });

  it("una fila marcada por fórmula SUM del banco es de totales aunque no diga 'total'", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "Venta", "", "10.000"],
      ["02/09/2026", "Venta", "", "5.000"],
      ["", "", "", "99.999"],
    ], cfg, descartes, undefined, { filasFormula: new Set([3]) });
    expect(descartes).toEqual([expect.objectContaining({ excel_row: 4, legitimo: true, motivo: "resumen" })]);
  });
});
