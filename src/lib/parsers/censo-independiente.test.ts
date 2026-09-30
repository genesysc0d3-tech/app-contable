import { describe, expect, it } from "vitest";
import { applyAdapter } from "./apply";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Punto 3: el censo cuenta con OTROS ojos que el mapeo. Toda fila de la región de
// datos con alguna fecha y alguna plata (en CUALQUIER columna) termina en
// movimiento o en descarte explicado; si el mapeo la dejó afuera → sospecha
// visible ("sin_leer"), nunca silencio. Hallazgo 0.1-3 de
// docs/investigacion-lector-cartolas-2026-09-30.md: el banco inserta "Nombre" en
// la columna 2, el mapa viejo cargo=2/abono=3 lee 1 de 3 filas y el censo decía
// filas_con_monto=1, leidas=1, descartes=0 → cuadre OK.

const mapaViejo: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean",
  layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 },
};

describe("censo independiente del mapeo", () => {
  const rowsConColumnaNueva: Row[] = [
    ["Fecha", "Glosa", "Nombre", "Cargo", "Abono"],
    ["01/09/2026", "Pago proveedor", "Proveedor Uno", "5.000", ""],
    ["02/09/2026", "Transferencia recibida", "Cliente Dos", "", "150.000"],
    ["03/09/2026", "Venta", "Cliente Tres", "", "80.000"],
  ];

  it("las filas con plata en una columna que el mapa no mira quedan como sospecha 'sin_leer'", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rowsConColumnaNueva, mapaViejo, descartes);
    const sinLeer = descartes.filter((d) => d.motivo === "sin_leer");
    // Toda fila con fecha + plata termina en movimiento o en descarte explicado.
    const filas = new Set([...lines.map((l) => l.excel_row), ...descartes.map((d) => d.excel_row)]);
    expect([...filas].sort()).toEqual([2, 3, 4]);
    expect(sinLeer.length).toBeGreaterThanOrEqual(2);
    expect(sinLeer.every((d) => !d.legitimo)).toBe(true);
    expect(sinLeer.map((d) => d.monto).sort((a, b) => a - b)).toEqual([80_000, 150_000]);
  });

  it("una cartola bien mapeada no inventa sospechas (saldo, N° de operación y fecha no son plata suelta)", () => {
    const cfg: AdapterConfig = {
      ...mapaViejo,
      columns: { fecha: 0, descripcion: 2, n_documento: 1, cargo: 3, abono: 4, saldo: 5 },
    };
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([
      ["Fecha", "N° Operación", "Glosa", "Cargo", "Abono", "Saldo"],
      ["01/09/2026", "0900013", "Pago", "5.000", "", "95.000"],
      ["02/09/2026", "0900026", "Venta", "", "10.000", "105.000"],
      ["03/09/2026", "0900039", "Saldo del día", "", "", "105.000"],
    ], cfg, descartes);
    expect(lines).toHaveLength(2);
    expect(descartes).toEqual([]);
  });

  it("una fila con fecha y 'SALDO INICIAL' con plata es un descarte legítimo, no una sospecha", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([
      ["Fecha", "Glosa", "Nombre", "Cargo", "Abono"],
      ["01/09/2026", "SALDO INICIAL", "", "", "1.000.000"],
      ["02/09/2026", "Venta", "x", "", "5.000"],
    ], { ...mapaViejo, columns: { ...mapaViejo.columns, cargo: 3, abono: 4 } }, descartes);
    expect(lines.map((l) => l.excel_row)).toEqual([3]);
    expect(descartes).toEqual([expect.objectContaining({ excel_row: 2, legitimo: true, motivo: "resumen" })]);
  });
});
