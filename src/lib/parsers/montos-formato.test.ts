import { describe, expect, it } from "vitest";
import { applyAdapter, parseChileanNumber } from "./apply";
import { detectHeuristic } from "./heuristic";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Punto 1 (lector con juez, 2026-09-30): el formato del número se decide POR
// COLUMNA mirando todas sus celdas (estilo GnuCash qif-file.scm: intersección de
// formatos posibles). Antes "250,000" se leía como $250 (apply.ts:19 cortaba en la
// primera coma) y "$ -418.370" perdía el signo.

const cfg: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean",
  layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 },
};

describe("montos en formato inglés (coma de miles)", () => {
  it("una celda con grupos de 3 tras la coma es de miles, no decimal", () => {
    expect(parseChileanNumber("250,000")).toBe(250_000);
    expect(parseChileanNumber("1,234,567")).toBe(1_234_567);
    expect(parseChileanNumber("1,234,567.50")).toBe(1_234_567);
  });

  it("el formato chileno sigue igual (punto de miles, coma decimal)", () => {
    expect(parseChileanNumber("1.234.567")).toBe(1_234_567);
    expect(parseChileanNumber("53.000,00")).toBe(53_000);
    expect(parseChileanNumber("1.234,56")).toBe(1234);
  });

  it("applyAdapter lee una cartola exportada con configuración regional en inglés", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "Pago proveedor", "80,000", ""],
      ["02/09/2026", "Transferencia recibida", "", "1,234,567"],
      ["03/09/2026", "Otra venta", "", "250,000"],
    ];
    const lines = applyAdapter(rows, cfg);
    expect(lines.map((l) => [l.tipo, l.monto])).toEqual([
      ["SALIDA", 80_000],
      ["ENTRADA", 1_234_567],
      ["ENTRADA", 250_000],
    ]);
  });
});

describe("signo después del $ y paréntesis contables", () => {
  it("'$ -418.370' es negativo", () => {
    expect(parseChileanNumber("$ -418.370")).toBe(-418_370);
    expect(parseChileanNumber("-$ 418.370")).toBe(-418_370);
  });
  it("'(5.000)' y '5.000-' son negativos", () => {
    expect(parseChileanNumber("(5.000)")).toBe(-5000);
    expect(parseChileanNumber("5.000-")).toBe(-5000);
  });
});

describe("columna ambigua → no se adivina", () => {
  it("una columna que mezcla '1.234.567' y '250,000' deja la celda dudosa en el censo como monto_ambiguo", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "Venta A", "", "1.234.567"],
      ["02/09/2026", "Venta B", "", "250,000"],
      ["03/09/2026", "Venta C", "", "5000"],
    ];
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes);
    // "5000" vale lo mismo en cualquier formato: se lee.
    expect(lines.map((l) => l.monto)).toContain(5000);
    // Las otras dos no calzan con un mismo formato: ninguna se adivina.
    expect(lines.map((l) => l.monto)).not.toContain(250);
    const ambiguos = descartes.filter((d) => d.motivo === ("monto_ambiguo" as DescarteFila["motivo"]));
    expect(ambiguos.map((d) => d.excel_row).sort()).toEqual([2, 3]);
    expect(ambiguos.every((d) => d.legitimo === false)).toBe(true);
  });
});

describe("number_format derivado del contenido", () => {
  it("la heurística marca generic cuando la plata viene con coma de miles", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"]];
    let saldo = 1_000_000;
    for (let i = 1; i <= 12; i++) {
      const entrada = i % 3 !== 0;
      const monto = 10_000 * i + 1_000;
      saldo += entrada ? monto : -monto;
      rows.push([`${String(i).padStart(2, "0")}/09/2026`, entrada ? "Transferencia recibida cliente" : "Pago proveedor servicios",
        entrada ? "" : monto.toLocaleString("en-US"), entrada ? monto.toLocaleString("en-US") : "", saldo.toLocaleString("en-US")]);
    }
    const h = detectHeuristic(rows);
    expect(h?.number_format).toBe("generic");
    expect(h?.columns.cargo).toBe(2);
    expect(h?.columns.abono).toBe(3);
    expect(h?.columns.saldo).toBe(4);
  });
});
