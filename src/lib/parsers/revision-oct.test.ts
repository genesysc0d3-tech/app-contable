import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

/** Revisión adversarial 2026-10-02 (juez y formatos conocidos). */
let cache: Record<string, unknown> | null = null;
const guardados: unknown[] = [];
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => cache,
  getAdaptersConfirmadosEmpresa: async () => [],
  confirmarAdapter: async () => true,
  saveAdapter: async (a: unknown) => { guardados.push(a); return "adapter-nuevo"; },
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { cache = null; guardados.length = 0; });

import { parseExcelWithOrchestrator } from "./orchestrator";
import { inferirRangoFechas } from "./apply";
import { detectarResumenImpreso, sellarCartola } from "./juez-banco";
import type { AdapterConfig, Row } from "./types";

const libro = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Movimientos");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
/** Cartola con saldo corrido que cuadra, n filas; fechas `fmt(i)`. */
function cartola(n: number, fmt: (i: number) => string, arriba: unknown[][] = [], glosa = (i: number) => `Movimiento ${i}`) {
  let s = 500_000;
  const filas: unknown[][] = [];
  for (let i = 0; i < n; i++) {
    const m = 1_000 + i * 113; const c = i % 3 === 0; s += c ? -m : m;
    filas.push([fmt(i), glosa(i), c ? m : "", c ? "" : m, s]);
  }
  return [...arriba, ["Saldo anterior", 500_000], [], ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ...filas];
}

describe("1. fechas sin año sin período explícito → nunca sellada", () => {
  it("dd/mm sin período: el saldo cuadra pero NO hay sello (revisar)", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03`)), {});
    expect(result.preExtracted?.length).toBe(14);
    expect(result.verificacion).toMatchObject({ tipo: "sin_comprobar", revisar: true });
  });
  it("con «Período: 01/03/2025 - 31/03/2025» arriba sí se sella", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03`, [["Período: 01/03/2025 - 31/03/2025"]])), {});
    expect(result.verificacion?.tipo).toBe("saldo");
    expect(result.preExtracted?.[0].fecha).toBe("2025-03-01");
  });
  it("dd/mm/aaaa (con año) sigue sellando sin período", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03/2026`)), {});
    expect(result.verificacion?.tipo).toBe("saldo");
  });
});

describe("2. el período se busca solo en el encabezado", () => {
  it("una glosa «PERIODO 01/03/2024 AL 31/03/2024» entre los movimientos no fija el año", () => {
    const rows = cartola(5, (i) => `0${1 + i}/03`, [], (i) => (i === 2 ? "PERIODO 01/03/2024 AL 31/03/2024" : `Mov ${i}`)) as Row[];
    const cfg = { header_row: 3, skip_rows_before_data: 4, columns: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, n_documento: -1 } } as AdapterConfig;
    expect(inferirRangoFechas(rows, cfg)?.explicito ?? false).toBe(false);
  });
});

describe("4. «Saldo Actual» / «Cargos / Giros» solo valen junto a Desde/Hasta", () => {
  it("planilla con «Saldo Actual $ x» suelto: no es el saldo final del resumen", () => {
    expect(detectarResumenImpreso([["Saldo Actual", "$ 1.234.567"], ["Fecha", "Glosa"]] as Row[])?.saldoFinal).toBeUndefined();
  });
  it("en el bloque Desde/Hasta de un estado de cuenta sí", () => {
    const r = detectarResumenImpreso([["Desde", "01-03-2022", "Hasta", "31-03-2022"], ["Saldo Anterior", "$ 100", "Saldo Actual", "$ 250"]] as Row[]);
    expect(r).toMatchObject({ saldoInicial: 100, saldoFinal: 250 });
  });
});

describe("5. el testigo «Saldo» respeta «solo abonos»", () => {
  // Saldo corrido real: cada abono suma 1.000 y cada 4ª fila hubo un cargo de 700 que el export filtró.
  let saldo = 100_000;
  const rows: Row[] = [["Fecha", "Descripción", "Abonos", "Saldo"],
    ...Array.from({ length: 12 }, (_, i) => { saldo += 1000 - (i % 4 === 3 ? 700 : 0); return [`${String(1 + i).padStart(2, "0")}/03/2026`, `Abono ${i}`, 1000, saldo]; })];
  const lines = rows.slice(1).map((r, i) => ({ tipo: "ENTRADA" as const, fecha: `2026-03-${String(1 + i).padStart(2, "0")}`, monto: 1000, descripcion: String(r[1]), n_documento: "", excel_row: i + 2 }));
  const cfg = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "transactions_log", default_tipo_flujo: "entrada",
    columns: { fecha: 0, descripcion: 1, monto: 2, cargo: 2, abono: 2, saldo: -1, n_documento: -1 } } as AdapterConfig;
  it("export filtrado a abonos: el testigo deja la salida «filtrada»", () => {
    expect(sellarCartola({ rows, cfg, lines, descartes: [], resumen: null, formulas: [] })).toMatchObject({ filtrada: "abonos" });
  });
  it("el cliente ya dijo «solo abonos»: el testigo no la vuelve a contradecir", () => {
    const v = sellarCartola({ rows, cfg: { ...cfg, revision_cliente: { documento_id: "d", firma: "f", solo_abonos: true } }, lines, descartes: [], resumen: null, formulas: [] });
    expect(v.contradice).toBeUndefined();
  });
});

describe("3. un mapa PROPIO confirmado le gana al formato conocido", () => {
  const misMov = (n: number) => [["Mis Movimientos"], ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)"],
    ...Array.from({ length: n }, (_, i) => [`${String(1 + i).padStart(2, "0")}/03/2026`, `${String(1 + i).padStart(2, "0")}/03/2026`, `Transferencia ${i}`, "", 10_000 + i])];
  it("caché propia confirmada (por Check/saldo) → sigue por la caché, con su adapter_id", async () => {
    cache = { id: "propio-1", creado_por_empresa_id: "emp", estado: "confirmado", confirmado_por: "check", source: "heuristic",
      config: { header_row: 1, skip_rows_before_data: 2, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 2, n_documento: -1, cargo: 3, abono: 4, saldo: -1 } } };
    const { result } = await parseExcelWithOrchestrator(libro(misMov(12)), { empresa_id: "emp" });
    expect(result.capa_usada).toBe(0);
    expect(result.adapter_id).toBe("propio-1");
  });
  it("sin caché: entra por conocido y queda guardado como mapa de la empresa (adapter_id para Check)", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(misMov(12)), { empresa_id: "emp" });
    expect(result.capa_usada).toBe(1);
    expect(result.adapter_id).toBe("adapter-nuevo");
    expect(guardados).toHaveLength(1);
  });
});

describe("6. formatos editados por la clienta no son conocidos", () => {
  it("bci-mes-actual-xls queda fuera", async () => {
    const { FORMATOS_DE_SPECS, SPECS_EXCLUIDAS } = await import("./formatos-conocidos.specs");
    expect(FORMATOS_DE_SPECS.map((f) => f.id)).not.toContain("bci-mes-actual-xls");
    expect(SPECS_EXCLUIDAS["bci-mes-actual-xls"]).toBeTruthy();
  });
});
