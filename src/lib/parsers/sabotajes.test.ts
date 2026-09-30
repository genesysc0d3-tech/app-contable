import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { Row } from "./types";
import { exacto, todasLasCartolas, type Cartola } from "./testing/sabotajes";

// Punto 10 (2026-09-30): BANCO DE SABOTAJES en CI, determinístico y SIN red.
// 5 formatos de banco × 10 sabotajes (títulos en inglés/genéricos/ausentes,
// columna insertada, columnas movidas, basura arriba, glosa con TOTAL, montos
// "1,234,567", sin saldo). Generador portado de
// scripts/experimento-estructura-deepseek.ts. Las pruebas con DeepSeek real
// viven en scripts/comparar-lector-deepseek.ts (fuera de CI).
//
// La regla que se exige a TODAS: nunca un error silencioso. Si lo leído no es
// exactamente la verdad, el sello NO puede decir "saldo" ni "total_banco".

vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => "adapter-test",
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => true,
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));

function libro(rows: Row[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as unknown[][], { cellDates: true }), "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

type Veredicto = "OK_PROBADO" | "OK_SIN_COMPROBAR" | "MAL_SIN_COMPROBAR" | "SILENCIOSO" | "CAPA4";

async function correr(c: Cartola): Promise<{ v: Veredicto; sello: string; detalle: string }> {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  const { result } = await parseExcelWithOrchestrator(libro(c.rows), { empresa_id: "emp-test" });
  if (result.capa_usada === 4 || !result.preExtracted) return { v: "CAPA4", sello: "-", detalle: "" };
  const lines = result.preExtracted.map((m) => ({ fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" as const : "SALIDA" as const }));
  const ex = exacto(lines, c.verdad);
  const sello = result.verificacion?.tipo ?? "sin_comprobar";
  const probado = sello === "saldo" || sello === "total_banco";
  const v: Veredicto = ex.ok ? (probado ? "OK_PROBADO" : "OK_SIN_COMPROBAR") : (probado ? "SILENCIOSO" : "MAL_SIN_COMPROBAR");
  return { v, sello, detalle: ex.detalle || result.verificacion?.detalle || "" };
}

const CARTOLAS = todasLasCartolas();

describe("banco de sabotajes (5 bancos × 10 sabotajes, sin red)", () => {
  it("son 50 cartolas", () => expect(CARTOLAS).toHaveLength(50));

  it.each(CARTOLAS.map((c) => [c.nombre, c] as const))("%s: jamás un error silencioso", async (_n, c) => {
    const r = await correr(c);
    expect(r.v, `${c.nombre}: ${r.detalle}`).not.toBe("SILENCIOSO");
  });

  it("resumen: todas se leen exacto y ninguna mala queda sellada como probada", async () => {
    const res = await Promise.all(CARTOLAS.map(async (c) => ({ c, ...(await correr(c)) })));
    const cuenta = res.reduce<Record<string, number>>((a, r) => ((a[r.v] = (a[r.v] ?? 0) + 1), a), {});
    // Línea base del experimento 2026-09-30 (lector de entonces): 38 OK · 5 silenciosos · 3 atrapados · 4 rechazos falsos.
    expect(cuenta.SILENCIOSO ?? 0).toBe(0);
    expect(cuenta.CAPA4 ?? 0).toBe(0);
    expect((cuenta.OK_PROBADO ?? 0) + (cuenta.OK_SIN_COMPROBAR ?? 0)).toBe(50);
    // Sin saldo y sin totales impresos NO hay prueba: se piden al cliente.
    for (const r of res.filter((x) => x.c.sabotaje === "sin_saldo" && !["chile", "santander"].includes(x.c.banco))) {
      expect(r.sello, r.c.nombre).toBe("sin_comprobar");
    }
    // Con saldo (y títulos con dirección o no) la ecuación prueba la lectura.
    for (const r of res.filter((x) => x.c.sabotaje === "base")) expect(r.sello, r.c.nombre).toBe("saldo");
  });
});

describe("fixtures NEGATIVOS (deben quedar sin_comprobar, nunca probados)", () => {
  const base = CARTOLAS.find((c) => c.nombre === "itau/sin_saldo")!;

  it("cargo y abono INVERTIDOS sin saldo ni totales: la lectura sale mal pero honesta (sin_comprobar)", async () => {
    // Se intercambian los títulos "Cargos"/"Abonos" y los datos: sin saldo nadie puede saberlo.
    const rows = base.rows.map((r) => {
      const x = Array.from({ length: 6 }, (_, i) => (r as unknown[])[i] ?? "");
      [x[4], x[5]] = [x[5], x[4]];
      return x;
    }) as Row[];
    const titulos = rows.findIndex((r) => (r as unknown[]).includes("Descripción"));
    (rows[titulos] as unknown[])[4] = "Columna A";
    (rows[titulos] as unknown[])[5] = "Columna B";
    const r = await correr({ ...base, rows });
    expect(["MAL_SIN_COMPROBAR", "OK_SIN_COMPROBAR"]).toContain(r.v);
    expect(r.sello).toBe("sin_comprobar");
  });

  it("el banco imprime un total que NO calza con lo leído → sin_comprobar con el detalle", async () => {
    const c = CARTOLAS.find((x) => x.nombre === "chile/base")!;
    const rows = c.rows.map((r) => [...(r as unknown[])]) as Row[];
    const total = rows[rows.length - 1] as unknown[];
    total[3] = Number(total[3]) + 12_345; // el total de cargos no calza
    // Sin saldo para que el total sea el único juez.
    const sinSaldo = rows.map((r) => (r as unknown[]).slice(0, 5)) as Row[];
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const { result } = await parseExcelWithOrchestrator(libro(sinSaldo), { empresa_id: "emp-test" });
    expect(result.verificacion?.tipo).toBe("sin_comprobar");
    expect(result.verificacion?.alerta).toBe(true);
  });

  it("una columna de plata que el mapa no lee (sin_leer) nunca se sella", async () => {
    const { applyAdapter } = await import("./apply");
    const { sellarCartola } = await import("./juez-banco");
    const cfg = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy" as const, number_format: "chilean" as const, layout: "two_cols" as const,
      columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 } };
    const rows: Row[] = [["Fecha", "Glosa", "Nombre", "Cargo", "Abono"],
      ["01/09/2026", "Pago", "x", "5.000", ""], ["02/09/2026", "Venta", "y", "", "150.000"], ["03/09/2026", "Venta", "z", "", "80.000"]];
    const descartes: never[] = [];
    const lines = applyAdapter(rows, cfg, descartes);
    const s = sellarCartola({ rows, cfg, lines, descartes, resumen: null, formulas: [] });
    expect(s.tipo).toBe("sin_comprobar");
    expect(s.detalle).toMatch(/no leyó/);
  });
});
