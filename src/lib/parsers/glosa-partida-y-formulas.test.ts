import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter } from "./apply";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Revisiones adversariales 2026-09-30:
//  - adversarial-1 falla 3 (regresión glosa_partida_2_filas): la heurística partía
//    el bloque DESPUÉS de la primera continuación de glosa y el primer movimiento
//    se perdía sin que el censo lo viera (contaba desde el inicio del bloque).
//  - adversarial-2 M1: una fórmula SUM de un rango parcial o vacío "probaba" la
//    columna entera → sello total_banco falso.

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
function libro(filas: Celda[][], formulas: Record<string, { v: number; f: string }> = {}, ref?: string): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(filas, { cellDates: true });
  for (const [r, c] of Object.entries(formulas)) ws[r] = { t: "n", v: c.v, f: c.f };
  if (ref) ws["!ref"] = ref;
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "emp-test" })).result;
}
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;

describe("glosa partida en 2 filas", () => {
  function cartola(conDoc: boolean): { filas: Celda[][]; n: number } {
    const filas: Celda[][] = [["Banco Genérico"], [], ["Fecha", "Descripción", "N° Documento", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", null, null, 2_000_000]];
    let s = 2_000_000;
    for (let i = 0; i < 26; i++) {
      const entrada = i % 2 === 0; const m = 5_000 + i * 1_000; s += entrada ? m : -m;
      filas.push([fch(1 + i), entrada ? "TRANSF DE COMERCI" : "PAGO PROVEEDOR D", conDoc ? "" : String(900 + i), entrada ? null : m, entrada ? m : null, s]);
      if (i % 3 === 0) filas.push(["", conDoc ? `RUT 76.543.210-${i % 9}` : "AL OMEGA LTDA", conDoc ? String(123400 + i) : "", null, null, null]);
    }
    return { filas, n: 26 };
  }

  it("no pierde el PRIMER movimiento (antes: 25/26 sellado 'saldo')", async () => {
    const { filas, n } = cartola(false);
    const r = await parsear(libro(filas));
    expect(r.censo?.leidas).toBe(n);
    expect(r.preExtracted?.[0]).toMatchObject({ fecha: "2026-09-01", monto: 5_000, tipo_flujo: "entrada" });
    // La continuación se pega a la glosa anterior (y queda anotada en la línea).
    expect(r.preExtracted?.[0].descripcion).toBe("TRANSF DE COMERCI AL OMEGA LTDA");
    expect(r.verificacion?.tipo).toBe("saldo");
  });

  it("con RUT y N° de operación en la fila de continuación tampoco se pierde el primero", async () => {
    const { filas, n } = cartola(true);
    const r = await parsear(libro(filas));
    expect(r.censo?.leidas).toBe(n);
    expect(r.preExtracted?.[0]).toMatchObject({ fecha: "2026-09-01", monto: 5_000 });
  });

  it("el censo mira también ARRIBA del bloque: fecha + plata sobre él queda como sospecha", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"],
      ["01/09/2026", "Venta suelta", "", "9.000", "1.009.000"],
      ["Nota del banco"],
      ["02/09/2026", "Venta", "", "1.000", "1.010.000"],
      ["03/09/2026", "Venta", "", "1.000", "1.011.000"],
      ["04/09/2026", "Venta", "", "1.000", "1.012.000"],
    ];
    const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 3, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
      columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
    const d: DescarteFila[] = [];
    applyAdapter(rows, cfg, d);
    expect(d.find((x) => x.excel_row === 2)).toMatchObject({ motivo: "sin_leer", legitimo: false, monto: 9_000 });
  });
});

describe("fórmula SUM: el rango tiene que cubrir exactamente lo leído", () => {
  const m = (i: number) => 30_000 + i * 1_000;
  const base = (): Celda[][] => {
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos"]];
    for (let i = 1; i <= 12; i++) { const c = i % 3 === 0; filas.push([fch(i), `Mov ${i}`, c ? m(i) : "", c ? "" : m(i)]); }
    return filas;
  };
  const sumas = () => {
    let sc = 0; let sa = 0;
    for (let i = 1; i <= 12; i++) { if (i % 3 === 0) sc += m(i); else sa += m(i); }
    return { sc, sa };
  };

  it("SUM de un rango parcial (solo las primeras filas) NO sella total_banco", async () => {
    const r = await parsear(libro(base(), { C15: { v: m(3), f: "SUM(C2:C4)" }, D15: { v: m(1) + m(2), f: "SUM(D2:D3)" } }, "A1:D15"));
    expect(r.verificacion?.tipo).not.toBe("total_banco");
  });

  it("SUM de un rango vacío (valor 0) NO sella total_banco", async () => {
    const filas = base(); filas.push([]); filas.push(["", "", "", ""]); filas.push(["", "", 0, 0]);
    const r = await parsear(libro(filas, { C16: { v: 0, f: "SUM(C20:C21)" }, D16: { v: 0, f: "SUM(D20:D21)" } }));
    expect(r.verificacion?.tipo).not.toBe("total_banco");
  });

  it("SUM que cubre todas las filas leídas: calza, pero NO sella (se calcula de las mismas celdas leídas)", async () => {
    // Batería de sellos falsos 2026-09-30 (un solo rol por celda): la =SUM es
    // función de las MISMAS celdas que se leyeron → no es un testigo
    // independiente. Una celda combinada que corría un cargo a la columna de
    // abonos salía sellada total_banco porque la SUM se recalculaba igual.
    const { sc, sa } = sumas();
    const r = await parsear(libro(base(), { C15: { v: sc, f: "SUM(C2:C13)" }, D15: { v: sa, f: "SUM(D2:D13)" } }, "A1:D15"));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBeFalsy();
  });
});
