import { describe, expect, it } from "vitest";
import { applyAdapter, esFechaCalendario, normalizeDate, parseFechaCartola } from "./apply";
import { calcularCuadre } from "@/lib/cartola/cuadre";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Fechas imposibles: "32/13/2026" (día 32, mes 13), "31/02/2026", "29/02/2025".
// Antes el lector las dejaba pasar como ISO con forma válida ("2026-13-32") y el
// movimiento nacía con una fecha falsa (o JS Date la corría al mes siguiente).
// Ahora NO inventa fecha: la fila va al censo con motivo y el cuadre la muestra
// como perdida.

const cfg: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean",
  layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 },
};

describe("esFechaCalendario — sin rollover", () => {
  it("rechaza día/mes imposibles y 29/02 en año no bisiesto", () => {
    expect(esFechaCalendario(2026, 13, 32)).toBe(false);
    expect(esFechaCalendario(2026, 2, 31)).toBe(false);
    expect(esFechaCalendario(2025, 2, 29)).toBe(false);
    expect(esFechaCalendario(2026, 4, 31)).toBe(false);
    expect(esFechaCalendario(2026, 1, 0)).toBe(false);
    expect(esFechaCalendario(2026, 0, 10)).toBe(false);
    expect(esFechaCalendario(1900, 2, 29)).toBe(false);
  });
  it("acepta fechas reales, incluido 29/02 bisiesto", () => {
    expect(esFechaCalendario(2024, 2, 29)).toBe(true);
    expect(esFechaCalendario(2000, 2, 29)).toBe(true);
    expect(esFechaCalendario(2026, 12, 31)).toBe(true);
  });
});

describe("normalizeDate / parseFechaCartola — no convierte fechas imposibles", () => {
  it("32/13/2026, 31/02/2026, 29/02/2025, 00/05/2026 → fecha_imposible, sin ISO", () => {
    for (const s of ["32/13/2026", "31/02/2026", "29/02/2025", "00/05/2026", "31-04-26"]) {
      expect(parseFechaCartola(s, "dd/mm/yyyy")).toEqual({ ok: false, motivo: "fecha_imposible" });
      expect(normalizeDate(s, "dd/mm/yyyy")).toBe("");
    }
    expect(normalizeDate("2026-02-30", "yyyy-mm-dd")).toBe("");
    expect(normalizeDate("32/13", "unknown", 2026)).toBe("");
    expect(normalizeDate("29/02", "unknown", 2025)).toBe("");
  });
  it("los formatos válidos siguen igual", () => {
    expect(normalizeDate("29/02/2024", "dd/mm/yyyy")).toBe("2024-02-29");
    expect(normalizeDate("14-06-26", "dd-mm-yyyy")).toBe("2026-06-14");
    expect(normalizeDate("2026-06-14", "yyyy-mm-dd")).toBe("2026-06-14");
    expect(normalizeDate("20260923", "unknown")).toBe("2026-09-23");
    expect(normalizeDate("02/09", "unknown", 2025)).toBe("2025-09-02");
    expect(parseFechaCartola("ayer", "dd/mm/yyyy")).toEqual({ ok: false, motivo: "fecha_ilegible" });
  });
});

describe("applyAdapter — una fecha imposible va al censo, no a la mesa", () => {
  const rows: Row[] = [
    ["Fecha", "Glosa", "Cargo", "Abono"],
    ["04/09/2026", "Transferencia buena", "", "170.000"],
    ["32/13/2026", "Día 32 mes 13", "", "5.000"],
    ["31/02/2026", "31 de febrero", "3.000", ""],
    ["29/02/2025", "29-feb no bisiesto", "", "2.000"],
    ["14/06/99", "Año 1999", "", "1.000"],
    [new Date(2091, 7, 25) as unknown as string, "Date de 2091", "", "900"],
    [new Date(2026, 5, 14) as unknown as string, "Date válido", "", "800"],
    [46245, "Serial Excel válido", "", "700"],
    ["20260923", "yyyymmdd válido", "", "600"],
  ];

  it("solo las fechas reales y creíbles se convierten en movimiento", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes);
    expect(lines.map((l) => [l.excel_row, l.fecha])).toEqual([
      [2, "2026-09-04"],
      [8, "2026-06-14"],
      [9, "2026-08-11"],
      [10, "2026-09-23"],
    ]);
    expect(lines.every((l) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(l.fecha))).toBe(true);
    expect(descartes.map((d) => [d.excel_row, d.motivo, d.legitimo, d.monto, d.fecha])).toEqual([
      [3, "fecha_imposible", false, 5000, null],
      [4, "fecha_imposible", false, 3000, null],
      [5, "fecha_imposible", false, 2000, null],
      [6, "fecha_fuera_de_rango", false, 1000, "1999-06-14"],
      [7, "fecha_fuera_de_rango", false, 900, "2091-08-25"],
    ]);
  });

  it("el cuadre muestra la fila con fecha imposible como perdida", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter([rows[0], rows[1], rows[2]], cfg, descartes);
    const cuadre = calcularCuadre({
      censo: { hoja: "Hoja1", filas_con_monto: 2, leidas: lines.length, descartes, otras_hojas_con_datos: [] },
      leidas: lines.map((l) => ({
        excel_row: l.excel_row, fecha: l.fecha, monto: l.monto,
        tipo_flujo: l.tipo === "ENTRADA" ? "entrada" : "salida",
      })),
      filasGuardadas: lines.map((l) => l.excel_row),
      filasDuplicadas: [],
      db: { movimientos: lines.length, propuestas: lines.length },
    });
    expect(cuadre.ok).toBe(false);
    expect(cuadre.perdidas).toEqual([expect.objectContaining({ excel_row: 3, motivo: "fecha_imposible", monto: 5000 })]);
    expect(cuadre.monto_perdido).toBe(5000);
  });
});
