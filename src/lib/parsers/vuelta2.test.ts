import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter, parseFechaCartola } from "./apply";
import { sellarCartola } from "./juez-banco";
import { hayConsensoParaGlobal } from "./adapter-store";
import { leerLibroCartola } from "./libro";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// VUELTA 2 de las revisiones adversariales (docs/adversarial-1 y -2, "Vuelta 2").
// Cada bloque reproduce un hallazgo que el código de la vuelta 1 dejaba pasar.

let cacheado: unknown = null;
vi.mock("./adapter-store", async (orig) => {
  const real = await orig<typeof import("./adapter-store")>();
  return {
    hayConsensoParaGlobal: real.hayConsensoParaGlobal,
    getAdapterByFingerprint: async () => cacheado,
    getAdaptersConfirmadosEmpresa: async () => [],
    saveAdapter: async () => "adapter-test",
    promoverMapaGlobalSiHayConsenso: async () => false,
    incrementAdapterSuccess: async () => {},
    decrementAdapterConfianza: async () => {},
    confirmarAdapter: async () => {},
    logParserEvent: async () => {},
  };
});
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { delete process.env.LECTOR_ESTRUCTURA_IA; cacheado = null; });

const cl = (n: number) => n.toLocaleString("es-CL");
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
const cfg5: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
function sellar(rows: Row[], cfg: AdapterConfig = cfg5) {
  const descartes: DescarteFila[] = [];
  const lines = applyAdapter(rows, cfg, descartes);
  return { lines, descartes, sello: sellarCartola({ rows, cfg, lines, descartes, resumen: null, formulas: [] }) };
}
function libro(filas: (string | number | null)[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "C");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "victima" })).result;
}

describe("N1 (CRÍTICO): el consenso global solo cuenta pruebas objetivas de dueños y cuentas distintas", () => {
  const malo: AdapterConfig = { ...cfg5, columns: { ...cfg5.columns, cargo: 3, abono: 2 } };
  it("'cliente' y 'check' nunca cuentan", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "A", estado: "confirmado", confirmado_por: "cliente", cuenta_id: "c1", config: { ...malo, cuenta_huella: "h1" } },
      { creado_por_empresa_id: "B", estado: "confirmado", confirmado_por: "check", cuenta_id: "c2", config: { ...malo, cuenta_huella: "h2" } },
    ], malo)).toBe(false);
  });
  it("mismo dueño (2 empresas de la misma cuenta) no cuenta", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "A", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: { ...cfg5, cuenta_huella: "h1" } },
      { creado_por_empresa_id: "B", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: { ...cfg5, cuenta_huella: "h2" } },
    ], cfg5)).toBe(false);
  });
  it("misma cuenta bancaria (o sin saber cuál) no cuenta", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "A", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: { ...cfg5, cuenta_huella: "h1" } },
      { creado_por_empresa_id: "B", estado: "confirmado", confirmado_por: "total_banco", cuenta_id: "c2", config: { ...cfg5, cuenta_huella: "h1" } },
    ], cfg5)).toBe(false);
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "A", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: cfg5 },
      { creado_por_empresa_id: "B", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c2", config: cfg5 },
    ], cfg5)).toBe(false);
  });
  it("saldo/total_banco de 2 dueños y 2 cuentas bancarias distintas: sí", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "A", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: { ...cfg5, cuenta_huella: "h1" } },
      { creado_por_empresa_id: "B", estado: "confirmado", confirmado_por: "total_banco", cuenta_id: "c2", config: { ...cfg5, cuenta_huella: "h2" } },
    ], cfg5)).toBe(true);
  });
  it("víctima: un global cuyos títulos contradicen la hoja no se aplica en silencio", async () => {
    cacheado = { id: "global-malo", config: { ...malo, columns: { ...malo.columns, saldo: -1 } }, estado: "confirmado", creado_por_empresa_id: null, source: "heuristic", confianza: 1 };
    const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos"]];
    for (let i = 1; i <= 12; i++) { const c = i % 4 === 0; filas.push([fch(i), c ? `Pago ${i}` : `Venta ${i}`, c ? cl(5_000 + i) : "", c ? "" : cl(20_000 + i)]); }
    const r = await parsear(libro(filas));
    expect(r.preExtracted?.filter((p) => p.tipo_flujo === "entrada")).toHaveLength(9);
    expect(r.adapter_id).not.toBe("global-malo");
  });
  it("un global aplicado sin prueba en esta lectura pide confirmación", async () => {
    const { necesitaConfirmacion } = await import("../cartola/verificacion");
    cacheado = { id: "global", config: { ...cfg5, columns: { ...cfg5.columns, saldo: -1 } }, estado: "confirmado", creado_por_empresa_id: null, source: "heuristic", confianza: 1 };
    const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos"]];
    for (let i = 1; i <= 12; i++) { const c = i % 4 === 0; filas.push([fch(i), `Mov ${i}`, c ? cl(5_000 + i) : "", c ? "" : cl(20_000 + i)]); }
    const r = await parsear(libro(filas));
    expect(r.adapter_id).toBe("global");
    expect(necesitaConfirmacion({ verificacion: r.verificacion ?? undefined, mapa: r.censo?.mapa })).toBe(true);
  });
});

describe("N2 (ALTO): el subtotal por estructura no bota ventas reales", () => {
  it("banco que repite el saldo de CIERRE del día en cada fila: se leen las 9 ventas", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (const [d, ms] of [[1, [50_000, 50_000, 30_000]], [2, [20_000, 20_000]], [3, [70_000]], [4, [10_000, 10_000, 20_000]]] as [number, number[]][]) {
      s += ms.reduce((a, b) => a + b, 0);
      for (const m of ms) rows.push([fch(d), `Transferencia de cliente ${d}-${m}`, "", cl(m), cl(s)]);
    }
    const { lines, descartes } = sellar(rows);
    expect(lines).toHaveLength(9);
    expect(descartes.filter((d) => d.legitimo)).toEqual([]);
  });
  it("sin saldo, 'TOTAL CHILE SPA' en otra columna y monto = suma del día: es una venta", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Comercio"],
      ["01/09/2026", "Compra", "", cl(10_000), "Tienda A"],
      ["01/09/2026", "Compra", "", cl(15_000), "Tienda B"],
      ["01/09/2026", "Transferencia recibida", "", cl(25_000), "TOTAL CHILE SPA"]];
    const { lines, descartes } = sellar(rows, { ...cfg5, columns: { ...cfg5.columns, saldo: -1 } });
    expect(lines).toHaveLength(3);
    expect(descartes).toEqual([]);
  });
  it("'Total del día' (glosa que EMPIEZA con total) tras una sola venta: subtotal legítimo", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (let d = 1; d <= 12; d++) { const m = 10_000 + d; s += m; rows.push([fch(d), `Venta ${d}`, "", cl(m), cl(s)]); rows.push([fch(d), "Total del día", "", cl(m), cl(s)]); }
    const { lines, descartes } = sellar(rows);
    expect(lines).toHaveLength(12);
    expect(descartes.every((d) => d.legitimo && d.subtotal)).toBe(true);
  });
});

describe("P1 (BLOQUEANTE): la PRIMERA fila también se comprueba", () => {
  const movs = (s0: number) => {
    const out: Row[] = []; let s = s0;
    for (let i = 2; i <= 13; i++) { const c = i % 3 === 0; const m = 30_000 + i * 1_000; s += c ? -m : m; out.push([fch(i), c ? `Pago ${i}` : `Venta ${i}`, c ? cl(m) : "", c ? "" : cl(m), cl(s)]); }
    return out;
  };
  it("'SALDO ANT. CTA CTE' con el saldo en abonos es fila_de_saldo, no un abono, y no hay sello falso", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["01/09/2026", "SALDO ANT. CTA CTE", "", cl(4_000_000), cl(4_000_000)], ...movs(4_000_000)];
    const { lines, descartes, sello } = sellar(rows);
    expect(lines.map((l) => l.excel_row)).not.toContain(2);
    expect(descartes.find((d) => d.excel_row === 2)?.motivo).toMatch(/resumen|fila_de_saldo/);
    expect(sello.tipo).toBe("saldo");
    expect(sello.detalle).toMatch(/todas/);
  });
  it("una primera fila cuyo monto ES su saldo (glosa rara) no se sella", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["01/09/2026", "TRASPASO PERIODO", "", cl(4_000_000), cl(4_000_000)], ...movs(4_000_000)];
    expect(sellar(rows).sello.tipo).toBe("sin_comprobar");
  });
  it("con saldo inicial en la fila de arriba, la primera se comprueba ('todas las filas')", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["", "Saldo inicial", "", "", cl(1_000_000)], ...movs(1_000_000)];
    const { sello } = sellar(rows, { ...cfg5, skip_rows_before_data: 2 });
    expect(sello.tipo).toBe("saldo");
    expect(sello.detalle).toMatch(/todas/);
  });
  it("sin saldo inicial conocido, el sello NO dice 'todas las filas'", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ...movs(1_000_000)];
    const { sello } = sellar(rows);
    expect(sello.tipo).toBe("saldo");
    expect(sello.detalle).not.toMatch(/todas/);
    expect(sello.detalle).toMatch(/primera/);
  });
});

describe("P2/N6: glosa partida en 3+ filas y pies de página", () => {
  it("los 2 primeros movimientos con glosa en 3 filas se leen (26/26)", async () => {
    const filas: (string | number | null)[][] = [["Banco X"], [], ["Fecha", "Descripción", "N° Doc", "Cargos", "Abonos", "Saldo"]];
    let s = 2_000_000;
    for (let i = 0; i < 26; i++) {
      const e = i % 2 === 0; const m = 5_000 + i * 700; s += e ? m : -m;
      filas.push([fch(1 + i), e ? "TRANSF DE" : "PAGO A", String(i), e ? null : m, e ? m : null, s]);
      if (i < 2) { filas.push(["", `CONT. ${i}A`, "", null, null, null]); filas.push(["", `CONT. ${i}B`, "", null, null, null]); }
    }
    const r = await parsear(libro(filas));
    expect(r.censo?.leidas).toBe(26);
    expect(r.preExtracted?.[0].descripcion).toBe("TRANSF DE CONT. 0A CONT. 0B");
  });
  it("un pie de página tras el último movimiento no se pega a su glosa", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (let i = 1; i <= 12; i++) { const m = 10_000 + i * 100; s += m; rows.push([fch(i), `Transf de cliente ${i}`, "", cl(m), cl(s)]); }
    rows.push(["", "Este documento no constituye comprobante de pago de impuestos", "", "", ""]);
    const { lines } = sellar(rows);
    expect(lines[lines.length - 1].descripcion).toBe("Transf de cliente 12");
  });
});

describe("N4/P3: filtrada y orden dentro del día", () => {
  it("orden intradía invertido (lo más nuevo arriba dentro del día) cierra al peso, sin falsa alerta", () => {
    const porDia: Row[][] = [];
    let s = 5_000_000;
    for (let d = 1; d <= 5; d++) {
      const dia: Row[] = [];
      for (let k = 0; k < 4; k++) { const c = (d + k) % 3 === 0; const m = 10_000 + d * 100 + k * 7; s += c ? -m : m; dia.push([fch(d), `Mov ${d}-${k}`, c ? cl(m) : "", c ? "" : cl(m), cl(s)]); }
      porDia.push(dia.reverse());
    }
    const { sello } = sellar([["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"], ...porDia.flat()]);
    expect(sello.alerta).toBeFalsy();
    expect(sello.tipo).toBe("saldo");
  });
  it("cartola filtrada solo abonos: sin sello, pero marcada 'filtrada' para que el cliente la pueda confirmar", () => {
    let s = 1_000_000;
    const rows: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 20; i++) { const m = 50_000 + i * 1000; s += m; if (i % 5 === 0) s -= 30_000; rows.push([fch(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const { sello } = sellar(rows);
    expect(sello.tipo).toBe("sin_comprobar");
    expect(sello.filtrada).toBe("abonos");
    // santander.xlsx real: la fila de saldo de arriba (ancla) no calza con la
    // primera; los saltos DENTRO de la cartola siguen diciendo "faltan cargos".
    const conAncla: Row[] = [rows[0], ["", "Saldo", "", "", cl(500_000)], ...rows.slice(1)];
    expect(sellar(conAncla, { ...cfg5, skip_rows_before_data: 2 }).sello.filtrada).toBe("abonos");
  });
});

describe("P4: SUM parcial dice la verdad", () => {
  it("el detalle dice que la fórmula no cubre todas las filas (no 'no trae totales')", async () => {
    const filas: (string | number | null)[][] = [["Fecha", "Descripción", "Cargos", "Abonos"]];
    const m = (i: number) => 30_000 + i * 1_000;
    for (let i = 1; i <= 12; i++) { const c = i % 3 === 0; filas.push([fch(i), `Mov ${i}`, c ? m(i) : "", c ? "" : m(i)]); }
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws.C15 = { t: "n", v: m(3), f: "SUM(C2:C4)" }; ws.D15 = { t: "n", v: m(1) + m(2), f: "SUM(D2:D3)" }; ws["!ref"] = "A1:D15";
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "C");
    const r = await parsear(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.detalle).not.toMatch(/no trae saldo ni totales/);
    expect(r.verificacion?.detalle).toMatch(/fórmula/);
  });
});

describe("N5/P5: CSV UTF-16, monto con signo y meses en texto", () => {
  it("CSV UTF-16 (Excel 'Texto Unicode') se lee como texto chileno", () => {
    const csv = "Fecha;Glosa;Cargos;Abonos;Saldo\n05/09/2026;Venta 1;;1.500;101.500\n";
    const u16 = new Uint8Array(2 + csv.length * 2); u16[0] = 0xff; u16[1] = 0xfe;
    for (let i = 0; i < csv.length; i++) { const c = csv.charCodeAt(i); u16[2 + 2 * i] = c & 0xff; u16[3 + 2 * i] = c >> 8; }
    const wb = leerLibroCartola(u16.buffer as ArrayBuffer);
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    expect(rows[1]).toEqual(["05/09/2026", "Venta 1", "", "1.500", "101.500"]);
  });
  it("fechas '05-SEP-2026' / '05-Ago-2026' / '5 sep 2026'", () => {
    expect(parseFechaCartola("05-SEP-2026", "unknown")).toEqual({ ok: true, iso: "2026-09-05" });
    expect(parseFechaCartola("05-Ago-2026", "unknown")).toEqual({ ok: true, iso: "2026-08-05" });
    expect(parseFechaCartola("5 dic 2025", "unknown")).toEqual({ ok: true, iso: "2025-12-05" });
  });
  it("Falabella: UNA columna Monto con signo + Saldo se lee (negativo = cargo) y se sella", async () => {
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Monto", "Saldo"]];
    let s = 800_000;
    for (let i = 1; i <= 14; i++) { const c = i % 3 === 0; const m = 12_000 + i * 150; s += c ? -m : m; filas.push([fch(i), c ? `Compra ${i}` : `Abono ${i}`, c ? -m : m, s]); }
    const r = await parsear(libro(filas));
    expect(r.capa_usada).not.toBe(4);
    expect(r.preExtracted?.filter((p) => p.tipo_flujo === "salida")).toHaveLength(4);
    expect(r.verificacion?.tipo).toBe("saldo");
  });
});
