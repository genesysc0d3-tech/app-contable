import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { AdapterConfig } from "./types";

// RESUMEN EN VIVO del popup "Revisa las columnas" (2026-09-30): con el mapa que
// el cliente está eligiendo, el server lee el archivo COMPLETO (applyAdapter +
// el juez) y dice cuántas entradas y salidas quedan, por cuánto, de qué fecha a
// qué fecha, y si con ese mapa la cartola queda comprobada o qué alerta queda.
// Si el banco (saldo o totales) CONTRADICE el mapa, no se puede guardar.

let cacheado: Record<string, unknown> | null = null;
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => cacheado,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => "adapter-test",
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { cacheado = null; delete process.env.LECTOR_ESTRUCTURA_IA; });

const cl = (n: number) => n.toLocaleString("es-CL");
const f = (d: number) => `${String(((d - 1) % 28) + 1).padStart(2, "0")}/09/2026`;
const libro = (filas: (string | number)[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
const cfg: AdapterConfig = {
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 },
};
const sinSaldo: AdapterConfig = { ...cfg, columns: { ...cfg.columns, saldo: -1 } };

/** 40 movimientos (más que las 30 filas de la vista previa), con saldo corrido que cierra. */
function cartolaConSaldo() {
  const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", "", cl(1_000_000)]];
  let s = 1_000_000;
  for (let i = 1; i <= 40; i++) {
    const cargo = i % 4 === 0;
    const m = 10_000 + i * 137;
    s += cargo ? -m : m;
    filas.push([f(i), cargo ? `Pago ${i}` : `Venta ${i}`, cargo ? cl(m) : "", cargo ? "" : cl(m), cl(s)]);
  }
  return filas;
}

describe("resumenDeMapa: el archivo completo con el mapa elegido", () => {
  it("cuenta entradas y salidas de TODO el archivo (no solo la vista previa) con su rango de fechas", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const filas = cartolaConSaldo().map((r) => [r[0], r[1], r[2], r[3]]); // sin saldo: no hay con qué comprobar
    const r = resumenDeMapa(libro(filas), sinSaldo);
    expect(r.valido).toBe(true);
    expect(r.entradas.n + r.salidas.n).toBe(40);
    expect(r.salidas.n).toBe(10);
    const esperadoSalidas = Array.from({ length: 40 }, (_, k) => k + 1).filter((i) => i % 4 === 0).reduce((a, i) => a + 10_000 + i * 137, 0);
    expect(r.salidas.monto).toBe(esperadoSalidas);
    expect(r.desde).toBe("2026-09-01");
    expect(r.hasta).toBe("2026-09-28");
    expect(r.estado).toBe("sin_comprobar");
    expect(r.contradice).toBe(false);
    expect(r.guardable).toBe(true);
  });

  it("con el saldo corrido que cierra al peso: comprobada y guardable", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const r = resumenDeMapa(libro(cartolaConSaldo()), { ...cfg, skip_rows_before_data: 2 });
    expect(r.estado).toBe("comprobada");
    expect(r.guardable).toBe(true);
  });

  it("MAPA CONTRADICHO: cargos y abonos al revés → el saldo del banco lo contradice y NO se puede guardar", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const alReves: AdapterConfig = { ...cfg, skip_rows_before_data: 2, columns: { ...cfg.columns, cargo: 3, abono: 2 } };
    const r = resumenDeMapa(libro(cartolaConSaldo()), alReves);
    expect(r.valido).toBe(true);
    expect(r.contradice).toBe(true);
    expect(r.guardable).toBe(false);
    expect(r.estado).toBe("alerta");
    expect(r.motivo).toBeTruthy();
  });

  it("MAPA CONTRADICHO por el TOTAL impreso del banco (sin saldo): no guardable", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos"]];
    let tc = 0, ta = 0;
    for (let i = 1; i <= 12; i++) { const c = i % 3 === 0; const m = 20_000 + i * 11; if (c) tc += m; else ta += m; filas.push([f(i), `Mov ${i}`, c ? cl(m) : "", c ? "" : cl(m)]); }
    filas.push(["", "Total cargos", cl(tc), ""], ["", "Total abonos", "", cl(ta)]);
    const alReves: AdapterConfig = { ...sinSaldo, columns: { ...sinSaldo.columns, cargo: 3, abono: 2 } };
    const bien = resumenDeMapa(libro(filas), sinSaldo);
    expect(bien.contradice).toBe(false);
    const mal = resumenDeMapa(libro(filas), alReves);
    expect(mal.contradice).toBe(true);
    expect(mal.guardable).toBe(false);
  });

  it("cartola que trae solo abonos (filtrada): ofrece 'solo abonos' y no deja guardarla como completa", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    let s = 1_000_000;
    const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 20; i++) { const m = 50_000 + i * 1000; s += m; if (i % 5 === 0) s -= 30_000; filas.push([f(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const r = resumenDeMapa(libro(filas), cfg);
    expect(r.soloAbonos).toBe(true);
    expect(r.guardable).toBe(false);
  });

  it("un mapa que no se puede leer (sin fecha) responde por qué, sin romper", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const r = resumenDeMapa(libro(cartolaConSaldo()), { ...cfg, columns: { ...cfg.columns, fecha: 1, descripcion: 0 } });
    expect(r.valido).toBe(false);
    expect(r.guardable).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("tras 'Listo', el reproceso de ESA cartola queda confirmada por el cliente", () => {
  it("con el mapa del cliente y su revisión de este documento (misma lectura) → sello cliente", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const filas = cartolaConSaldo().map((r) => [r[0], r[1], r[2], r[3]]);
    const buf = libro(filas);
    const { firma } = resumenDeMapa(buf, sinSaldo);
    cacheado = { id: "mio", config: { ...sinSaldo, revision_cliente: { documento_id: "doc-1", firma } }, estado: "confirmado", confirmado_por: "cliente", creado_por_empresa_id: "emp", source: "manual", confianza: 1 };
    const r = (await parseExcelWithOrchestrator(buf, { empresa_id: "emp", documento_id: "doc-1" })).result;
    expect(r.verificacion?.tipo).toBe("cliente");
    expect(r.censo?.mapa).toMatchObject({ estado: "confirmado", confirmado_por: "cliente", nuevo: false });
  });

  it("OTRA cartola del mismo formato no hereda el sello: queda sin comprobar pero NO pide revisar (formato ya confirmado)", async () => {
    const { resumenDeMapa } = await import("./resumen-mapa");
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const { revisarColumnas } = await import("../cartola/verificacion");
    const filas = cartolaConSaldo().map((r) => [r[0], r[1], r[2], r[3]]);
    const buf = libro(filas);
    const { firma } = resumenDeMapa(buf, sinSaldo);
    cacheado = { id: "mio", config: { ...sinSaldo, revision_cliente: { documento_id: "doc-1", firma } }, estado: "confirmado", confirmado_por: "cliente", creado_por_empresa_id: "emp", source: "manual", confianza: 1 };
    const r = (await parseExcelWithOrchestrator(buf, { empresa_id: "emp", documento_id: "doc-2" })).result;
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(revisarColumnas({ verificacion: r.verificacion ?? undefined, mapa: r.censo?.mapa }).abrir).toBe(false);
  });

  it("si la lectura cambió (otra firma), la revisión vieja no sella", async () => {
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const buf = libro(cartolaConSaldo().map((r) => [r[0], r[1], r[2], r[3]]));
    cacheado = { id: "mio", config: { ...sinSaldo, revision_cliente: { documento_id: "doc-1", firma: "0|0|0" } }, estado: "confirmado", confirmado_por: "cliente", creado_por_empresa_id: "emp", source: "manual", confianza: 1 };
    const r = (await parseExcelWithOrchestrator(buf, { empresa_id: "emp", documento_id: "doc-1" })).result;
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
});
