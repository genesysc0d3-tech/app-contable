import { describe, expect, it } from "vitest";
import { applyAdapter, esFechaCalendario, inferirRangoFechas, parseFechaCartola } from "./apply";
import { validate } from "./validator";
import { calcularCuadre } from "@/lib/cartola/cuadre";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Fechas imposibles: "32/13/2026" (día 32, mes 13), "31/02/2026", "29/02/2025".
// Antes el lector las dejaba pasar como ISO con forma válida ("2026-13-32") y el
// movimiento nacía con una fecha falsa (o JS Date la corría al mes siguiente).
// Ahora NO inventa fecha: la fila va al censo con motivo y el cuadre la muestra
// como perdida.

/** "Hoy" fijo para que los tests no dependan del reloj. */
const AHORA = new Date(2026, 8, 28, 12);
const iso = (v: unknown, f: AdapterConfig["date_format"], opts?: Parameters<typeof parseFechaCartola>[2]) => {
  const r = parseFechaCartola(v, f, { ahora: AHORA, ...opts });
  return r.ok ? r.iso : r.motivo;
};

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

describe("parseFechaCartola — no convierte fechas imposibles", () => {
  it("32/13/2026, 31/02/2026, 29/02/2025, 00/05/2026 → fecha_imposible, sin ISO", () => {
    for (const s of ["32/13/2026", "31/02/2026", "29/02/2025", "00/05/2026", "31-04-26"]) {
      expect(parseFechaCartola(s, "dd/mm/yyyy")).toEqual({ ok: false, motivo: "fecha_imposible" });
    }
    expect(iso("2026-02-30", "yyyy-mm-dd")).toBe("fecha_imposible");
    expect(iso("32/13", "unknown")).toBe("fecha_imposible");
    expect(iso("29/02", "unknown", { rango: { min: "2025-02-01", max: "2025-03-31", explicito: true } })).toBe("fecha_imposible");
  });
  it("los formatos válidos siguen igual", () => {
    expect(iso("29/02/2024", "dd/mm/yyyy")).toBe("2024-02-29");
    expect(iso("14-06-26", "dd-mm-yyyy")).toBe("2026-06-14");
    expect(iso("2026-06-14", "yyyy-mm-dd")).toBe("2026-06-14");
    expect(iso("20260923", "unknown")).toBe("2026-09-23");
    expect(iso("02/09", "unknown", { rango: { min: "2025-09-01", max: "2025-09-30", explicito: true } })).toBe("2025-09-02");
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
    const lines = applyAdapter(rows, cfg, descartes, AHORA);
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
    const lines = applyAdapter([rows[0], rows[1], rows[2]], cfg, descartes, AHORA);
    expect(descartes[0].fecha_cruda).toBe("32/13/2026");
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

// Revisión adversarial B1: sacar las filas de fecha absurda antes de validar
// NO puede anular el check 2b (incidente M&E: columna de montos mapeada como
// fecha → seriales de Excel que caen en 2042, 2067, 2099).
describe("check 2b sigue viendo la columna mal mapeada (M&E)", () => {
  const rowsME: Row[] = [
    ["Fecha", "Glosa", "Cargo", "Abono"],
    [46242, "a", "", "10.000"],
    [52000, "b", "", "11.000"],
    [61000, "c", "", "12.000"],
    [73000, "d", "", "13.000"],
    [45000, "e", "", "14.000"],
    [46243, "f", "", "15.000"],
    [46244, "g", "", "16.000"],
    [46245, "h", "", "17.000"],
    [46246, "i", "", "18.000"],
    [46247, "j", "", "19.000"],
  ];
  it("los descartes por fecha fuera de rango cuentan para rechazar la capa", () => {
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rowsME, cfg, descartes, AHORA);
    expect(lines).toHaveLength(7);
    expect(descartes.filter((d) => d.motivo === "fecha_fuera_de_rango")).toHaveLength(3);
    const v = validate(lines, rowsME, cfg, descartes);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/check_2b_fechas_absurdas: 3\/10/);
  });
  it("un dedazo suelto en una cartola normal no tumba la capa", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargo", "Abono"]];
    for (let d = 1; d <= 9; d++) rows.push([`0${d}/09/2026`, `m${d}`, "", `${d}0.000`]);
    rows.push(["32/09/2026", "dedazo", "", "5.000"]);
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes);
    const v = validate(lines, rows, cfg, descartes);
    expect(v.errors.filter((e) => e.startsWith("check_2b"))).toEqual([]);
  });
});

// Revisión adversarial B2: "dd/mm" sin año en una cartola que cruza el año.
// El año sale del rango DESDE–HASTA de la hoja, no de un único año pista.
describe("dd/mm sin año en cartola dic–ene", () => {
  const cfgSinAnio: AdapterConfig = { ...cfg, skip_rows_before_data: 2, date_format: "unknown" };
  const fechas = (cabecera: Row) => applyAdapter([
    cabecera,
    ["Fecha", "Glosa", "Cargo", "Abono"],
    ["20/12", "diciembre", "", "1.000"],
    ["05/01", "enero", "", "2.000"],
  ], cfgSinAnio, undefined, AHORA).map((l) => l.fecha);

  it("DESDE 15/12/2024 HASTA 14/01/2025 → 2024-12-20 y 2025-01-05", () => {
    expect(fechas(["FECHA DESDE", "15/12/2024", "HASTA", "14/01/2025"])).toEqual(["2024-12-20", "2025-01-05"]);
    expect(fechas(["FECHA DESDE 15/12/2025 HASTA 14/01/2026", "", "", ""])).toEqual(["2025-12-20", "2026-01-05"]);
  });
  it("solo HASTA 14/01/2026 → 20/12 es del año anterior, no del futuro", () => {
    expect(fechas(["HASTA", "14/01/2026", "", ""])).toEqual(["2025-12-20", "2026-01-05"]);
  });
  it("inferirRangoFechas: DESDE/HASTA explícitos mandan", () => {
    expect(inferirRangoFechas([["FECHA DESDE: 15/12/2025", "HASTA", "14/01/2026"], ["02/09", "x"]], cfgSinAnio))
      .toEqual({ min: "2025-12-15", max: "2026-01-14", explicito: true });
    expect(inferirRangoFechas([["02/09", "x", 1000]], cfgSinAnio)).toBeNull();
  });
});

// Re-revisión adversarial: el rango SOLO sale de DESDE/HASTA o de la columna
// fecha; una fecha de impresión o una glosa no deciden el año, y ningún año
// candidato puede dejar la fecha a más de 7 días en el futuro.
describe("dd/mm sin año: fuentes del rango y tope al futuro", () => {
  const cfgD: AdapterConfig = { ...cfg, skip_rows_before_data: 2, date_format: "unknown" };
  const leer = (rows: Row[]) => applyAdapter(rows, cfgD, undefined, AHORA).map((l) => l.fecha);

  it("fecha de impresión '28/09/2026 10:30' no corre enero a 2027", () => {
    expect(leer([
      ["28/09/2026 10:30", "Cartola de movimientos", "", ""],
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["05/01", "a", "", "1.000"],
      ["20/01", "b", "", "2.000"],
    ])).toEqual(["2026-01-05", "2026-01-20"]);
    // ...ni tampoco si la fecha suelta está en la columna fecha (un solo punto).
    expect(leer([
      ["Cartola", "", "", ""],
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["05/01", "a", "", "1.000"],
      ["20/01", "b", "", "2.000"],
      ["28/09/2026 10:30", "Emitido", "", ""],
    ])).toEqual(["2026-01-05", "2026-01-20"]);
  });

  it("una glosa '01/03/2019 cuota' no manda septiembre a 2018", () => {
    expect(leer([
      ["Cartola", "", "", ""],
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["02/09", "01/03/2019 cuota", "1.000", ""],
      ["03/09", "otra", "", "2.000"],
    ])).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("tope: ningún año candidato deja la fecha a más de 7 días en el futuro", () => {
    expect(leer([
      ["Cartola", "", "", ""],
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["15/09/2026", "a", "", "1.000"],
      ["25/09/2026", "b", "", "2.000"],
      ["05/01", "c", "", "3.000"],
    ])).toEqual(["2026-09-15", "2026-09-25", "2026-01-05"]);
  });

  it("rango ancho (DESDE 01/01/2025 HASTA 30/09/2026): el empate va al año más reciente", () => {
    expect(leer([
      ["DESDE", "01/01/2025", "HASTA", "30/09/2026"],
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["15/06", "a", "", "1.000"],
    ])).toEqual(["2026-06-15"]);
  });
});

// Re-revisión: una fecha IMPOSIBLE es un dedazo, no una columna mal mapeada.
describe("check 2b no cuenta las fechas imposibles", () => {
  it("3 buenas + '32/09/2026' (25%) no tumba la capa", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["01/09/2026", "a", "", "10.000"],
      ["02/09/2026", "b", "", "11.000"],
      ["03/09/2026", "c", "", "12.000"],
      ["32/09/2026", "dedazo", "", "5.000"],
    ];
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes, AHORA);
    expect(descartes.map((d) => d.motivo)).toEqual(["fecha_imposible"]);
    const v = validate(lines, rows, cfg, descartes);
    expect(v.errors.filter((e) => e.startsWith("check_2b"))).toEqual([]);
  });
});
