import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter } from "./apply";
import { sellarCartola } from "./juez-banco";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Revisiones adversariales 2026-09-30 (adversarial-2 C2, adversarial-1 falla 8):
//  - Una fila con FECHA VÁLIDA nunca es "resumen" por una palabra: un pago a
//    "TOTAL CHILE SPA" o un "TRASPASO SALDO DISPONIBLE" son movimientos.
//  - Un "Total del día" con fecha se reconoce por ESTRUCTURA (sus montos son la
//    suma de las filas del día y el saldo no se mueve) y es descarte legítimo:
//    ni "Faltan N" falsos ni un movimiento inventado.

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

type Celda = string | number | Date | null;
function libro(filas: Celda[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas, { cellDates: true }), "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "emp-test" })).result;
}
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
const cl = (n: number) => n.toLocaleString("es-CL");

describe("con fecha válida, nunca resumen por palabras", () => {
  it("un pago a 'TOTAL CHILE SPA' (otra columna de texto) se lee como movimiento", async () => {
    let s = 5_000_000;
    const filas: Celda[][] = [["Fecha", "Descripción", "Destinatario", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", "", "", cl(5_000_000)]];
    for (let i = 1; i <= 14; i++) {
      const cargo = i % 3 === 0; const m = 30_000 + i * 1_000;
      s += cargo ? -m : m;
      filas.push([fch(i), cargo ? `TRANSFERENCIA A TERCEROS NRO ${1000 + i}` : `TRANSFERENCIA DE TERCEROS NRO ${1000 + i}`,
        i === 6 ? "TOTAL CHILE SPA" : `Cliente ${i}`, cargo ? cl(m) : "", cargo ? "" : cl(m), cl(s)]);
    }
    const r = await parsear(libro(filas));
    expect(r.censo?.leidas).toBe(14);
    expect(r.censo?.descartes ?? []).toEqual([]);
    expect(r.verificacion?.tipo).toBe("saldo");
  });

  it("una glosa 'TRASPASO SALDO DISPONIBLE LINEA CREDITO' con fecha se lee", async () => {
    let s = 5_000_000;
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", "", cl(5_000_000)]];
    for (let i = 1; i <= 14; i++) {
      const m = 30_000 + i * 1_000; s += m;
      filas.push([fch(i), i === 4 ? "TRASPASO SALDO DISPONIBLE LINEA CREDITO" : `TRANSFERENCIA DE TERCEROS ${i}`, "", cl(m), cl(s)]);
    }
    const r = await parsear(libro(filas));
    expect(r.censo?.leidas).toBe(14);
    expect(r.verificacion?.tipo).toBe("saldo");
  });

  it("una fila 'SALDO INICIAL' con fecha y el saldo repetido como abono NO es una venta", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"], ["01/09/2026", "SALDO INICIAL", "", "5.000.000", "5.000.000"]];
    let s = 5_000_000;
    for (let i = 2; i <= 13; i++) { const m = 10_000 * i; s += m; rows.push([fch(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
      columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
    const d: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, d);
    expect(lines.map((l) => l.excel_row)).not.toContain(2);
    expect(d.find((x) => x.excel_row === 2)).toMatchObject({ motivo: "resumen", legitimo: true });
  });
});

describe("subtotales 'Total del día' con fecha: por estructura", () => {
  function cartolaConSubtotales(): { rows: Row[]; movs: number } {
    const rows: Row[] = [["Fecha", "Descripción", "N° Documento", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", "", "", 5_000_000]];
    let s = 5_000_000; let n = 0;
    for (let dia = 1; dia <= 4; dia++) {
      let te = 0; let ts = 0;
      for (let k = 0; k < 9; k++) {
        const esCargo = (dia + k) % 3 === 0; const m = 10_000 + dia * 1_000 + k * 137;
        s += esCargo ? -m : m; if (esCargo) ts += m; else te += m; n++;
        rows.push([fch(dia), esCargo ? "PAGO PROVEEDOR" : "TRANSF DE CLIENTE", String(700100 + n), esCargo ? m : "", esCargo ? "" : m, s]);
      }
      rows.push([fch(dia), "Total del día", "", ts, te, s]);
    }
    return { rows, movs: n };
  }

  it("se descartan como resumen legítimo, sin 'Faltan N' falsos, y la cartola se sella", () => {
    const { rows, movs } = cartolaConSubtotales();
    const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
      columns: { fecha: 0, descripcion: 1, n_documento: 2, cargo: 3, abono: 4, saldo: 5 } };
    const d: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, d);
    expect(lines).toHaveLength(movs);
    expect(d.filter((x) => !x.legitimo)).toEqual([]);
    expect(d.filter((x) => x.motivo === "resumen")).toHaveLength(4);
    expect(sellarCartola({ rows, cfg, lines, descartes: d, resumen: null, formulas: [] }).tipo).toBe("saldo");
  });

  it("dos ventas iguales el mismo día NO se confunden con un subtotal (el saldo sí se mueve)", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (const m of [20_000, 20_000, 40_000]) { s += m; rows.push([fch(3), "Venta", "", m, s]); }
    const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
      columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
    const d: DescarteFila[] = [];
    expect(applyAdapter(rows, cfg, d)).toHaveLength(3);
    expect(d).toEqual([]);
  });
});
