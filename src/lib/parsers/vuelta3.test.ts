import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter, parseFechaCartola } from "./apply";
import { sellarCartola } from "./juez-banco";
import { filtradaPermitida, revisarColumnas } from "../cartola/verificacion";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// VUELTA 3 de las revisiones adversariales (docs/adversarial-1 y -2, "Vuelta 3").

vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => "adapter-test",
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { delete process.env.LECTOR_ESTRUCTURA_IA; });

const cl = (n: number) => n.toLocaleString("es-CL");
const f = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
const base: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
function sellar(rows: Row[], cfg: AdapterConfig) {
  const d: DescarteFila[] = []; const lines = applyAdapter(rows, cfg, d);
  return { v: sellarCartola({ rows, cfg, lines, descartes: d, resumen: null, formulas: [] }), lines };
}
const sinPerdidas = (v: ReturnType<typeof sellar>["v"]) => ({ verificacion: v, perdidas: [], otras_hojas_con_datos: [] });

describe("V3-1: 'filtrada' nunca tapa un mapa invertido ni banderas ambiguas", () => {
  it("cuenta que solo recibe leída con el mapa INVERTIDO: sin botón 'solo cargos'", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Monto A", "Monto B", "Saldo"]];
    let s = 500_000;
    for (let i = 1; i <= 14; i++) { const m = 30_000 + i * 1_000; s += m; rows.push([f(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const { v } = sellar(rows, { ...base, columns: { ...base.columns, cargo: 3, abono: 2 } });
    expect(v.tipo).toBe("sin_comprobar");
    expect(v.filtrada).toBeUndefined();
    expect(filtradaPermitida(sinPerdidas(v))).toBe(false);
    expect(v.detalle).toMatch(/al revés/);
  });
  it("single_col con banderas C/D ambiguas (C=Crédito en inglés): sin botón", () => {
    const cfg: AdapterConfig = { ...base, layout: "single_col", columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 2, saldo: 4, monto: 2, tipo_flujo_col: 3 } };
    const rows: Row[] = [["Fecha", "Glosa", "Monto", "C/D", "Saldo"]];
    let s = 500_000;
    for (let i = 1; i <= 14; i++) { const cr = i % 4 !== 0; const m = 30_000 + i * 1_000; s += cr ? m : -m; rows.push([f(i), cr ? `Venta ${i}` : `Pago ${i}`, cl(m), cr ? "C" : "D", cl(s)]); }
    const { v } = sellar(rows, cfg);
    expect(v.tipo).toBe("sin_comprobar");
    expect(filtradaPermitida(sinPerdidas(v))).toBe(false);
  });
  it("el server tampoco acepta 'filtrada' de cargos (solo el caso massDTE: solo abonos)", () => {
    expect(filtradaPermitida({ verificacion: { tipo: "sin_comprobar", alerta: true, filtrada: "cargos", detalle: "x" }, perdidas: [], otras_hojas_con_datos: [] })).toBe(false);
  });
});

describe("V3-3: monto con signo sin título que diga la dirección no sella", () => {
  it("estado de cuenta de tarjeta (compras +, pagos −, saldo = deuda): sin sello pleno y pide mirar", async () => {
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Monto", "Saldo"]];
    let deuda = 200_000;
    for (let i = 1; i <= 14; i++) { const pago = i % 5 === 0; const m = pago ? -100_000 : 12_000 + i * 500; deuda += m; filas.push([f(i), pago ? "PAGO TARJETA" : `COMPRA COMERCIO ${i}`, cl(m), cl(deuda)]); }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "C");
    const r = (await parseExcelWithOrchestrator(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, { empresa_id: "e" })).result;
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(revisarColumnas({ verificacion: r.verificacion ?? undefined, mapa: r.censo?.mapa }).abrir).toBe(true);
  });
});

describe("primera fila sin comprobar: nunca sello pleno", () => {
  it("1ª fila informativa (cargo que no mueve el saldo) sin saldo inicial: pide mirar", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"], [f(1), "RETENCION DEP. 24H (INFORMATIVO)", cl(50_000), "", cl(1_000_000)]];
    let s = 1_000_000;
    for (let i = 2; i <= 14; i++) { const m = 20_000 + i; s += m; rows.push([f(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const { v } = sellar(rows, base);
    expect(v.tipo).toBe("sin_comprobar");
    expect(revisarColumnas({ verificacion: v, mapa: { adapter_id: "a", estado: "confirmado", nuevo: false } }).abrir).toBe(true);
  });
});

describe("V3-5: mes en texto solo con nombres de mes", () => {
  it("'5 MARCA 2026' y '1 junta 2026' no son fechas; los meses reales sí", () => {
    expect(parseFechaCartola("5 MARCA 2026", "dd/mm/yyyy").ok).toBe(false);
    expect(parseFechaCartola("1 junta 2026", "dd/mm/yyyy").ok).toBe(false);
    expect(parseFechaCartola("05-Mayores-2026", "dd/mm/yyyy").ok).toBe(false);
    expect(parseFechaCartola("05/sept./2026", "dd/mm/yyyy")).toEqual({ ok: true, iso: "2026-09-05" });
    expect(parseFechaCartola("5 marzo 2026", "dd/mm/yyyy")).toEqual({ ok: true, iso: "2026-03-05" });
    expect(parseFechaCartola("28-Dec-2025", "dd/mm/yyyy")).toEqual({ ok: true, iso: "2025-12-28" });
  });
});

describe("V3-1 sin romper la filtrada real", () => {
  it("un cargo faltante que por azar vale el doble de su fila no convierte la filtrada en 'al revés'", () => {
    let s = 1_000_000;
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 20; i++) { const m = 50_000 + i * 1000; s += m; if (i % 5 === 0) s -= i === 5 ? 2 * m : 30_000; rows.push([f(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const { v } = sellar(rows, base);
    expect(v.filtrada).toBe("abonos");
  });
});
