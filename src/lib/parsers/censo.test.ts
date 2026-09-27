import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter } from "./apply";
import { otrasHojasConDatos } from "./orchestrator";
import type { AdapterConfig, DescarteFila } from "./types";

// Censo del lector: toda fila con plata que NO termina en movimiento queda
// anotada con su motivo. Antes cada `continue` de applyAdapter la botaba en silencio.
const cfg: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean",
  layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 },
};

describe("censo de filas con plata", () => {
  const rows = [
    ["Fecha", "Glosa", "Cargo", "Abono"],
    ["04/09/2026", "Transferencia de P. R.", "", "170.000"],
    ["", "Transferencia sin fecha (fecha solo en la 1a fila del día)", "", "5.000"],
    ["ayer", "Fecha ilegible", "", "7.000"],
    ["05/09/2026", "Cargo y abono a la vez", "1.000", "2.000"],
    ["", "Total abonos", "", "184.000"],
    ["", "", "", ""],
  ];

  it("lo que no se lee queda anotado con su motivo; los totales son legítimos", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes);
    expect(lines).toHaveLength(1);
    expect(descartes.map((d) => [d.excel_row, d.motivo, d.legitimo, d.monto])).toEqual([
      [3, "sin_fecha", false, 5000],
      [4, "fecha_ilegible", false, 7000],
      [5, "cargo_y_abono", false, 3000],
      [6, "resumen", true, 184000],
    ]);
  });

  it("sin acumulador, applyAdapter se comporta igual que antes", () => {
    expect(applyAdapter(rows, cfg)).toHaveLength(1);
  });

  it("una fila vacía o sin plata no es un descarte", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter([["Fecha", "Glosa", "Cargo", "Abono"], ["", "Nota del banco", "", ""]], cfg, descartes);
    expect(descartes).toEqual([]);
  });
});

describe("filas de totales sin texto (BancoEstado, BICE)", () => {
  it("una fila sin fecha que es la suma de los abonos es de totales, no una pérdida", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "a", "", "100.000"],
      ["02/09/2026", "b", "", "50.000"],
      ["", "", "", "150.000"],
    ], cfg, descartes);
    expect(descartes).toEqual([expect.objectContaining({ excel_row: 4, legitimo: true, motivo: "resumen" })]);
  });

  it("todo lo que viene después de 'RESUMEN DEL PERIODO' es bloque de resumen", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "a", "", "100.000"],
      ["RESUMEN DEL PERIODO", "", "", ""],
      ["", "", "", "999"],
    ], cfg, descartes);
    expect(descartes[0]).toMatchObject({ legitimo: true, motivo: "resumen" });
  });

  it("el total del banco ignora un monto escrito como texto (SUMA de Excel) → sigue siendo fila de totales", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "a", "", 100000],
      ["02/09/2026", "b", "", "$100"],
      ["", "", "", 100000],
    ], cfg, descartes);
    expect(lines).toHaveLength(2);
    expect(descartes[0]).toMatchObject({ legitimo: true, motivo: "resumen" });
  });

  it("una fila sin fecha que NO es una suma sigue siendo pérdida", () => {
    const descartes: DescarteFila[] = [];
    applyAdapter([
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "a", "", "100.000"],
      ["", "Transferencia de otro pagador", "", "30.000"],
    ], cfg, descartes);
    expect(descartes[0]).toMatchObject({ legitimo: false, motivo: "sin_fecha" });
  });
});

describe("otras hojas del libro", () => {
  it("detecta una hoja con movimientos que el orquestador no leyó", () => {
    const wb = XLSX.utils.book_new();
    const mov = (d: number) => [new Date(2026, 8, d), `Transferencia ${d}`, 10000 * d];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fecha", "Glosa", "Monto"], mov(1), mov(2), mov(3)], { cellDates: true }), "Septiembre");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fecha", "Glosa", "Monto"], mov(4), mov(5), mov(6)], { cellDates: true }), "Agosto");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notas"], ["Cartola emitida por el banco"]]), "Info");
    // Ida y vuelta como un archivo real: el orquestador lo lee con cellDates.
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const leido = XLSX.read(buf, { type: "array", cellDates: true });
    expect(otrasHojasConDatos(leido, "Septiembre")).toEqual(["Agosto"]);
  });
});
