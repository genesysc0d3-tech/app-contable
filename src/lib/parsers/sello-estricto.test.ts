import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { sellarCartola } from "./juez-banco";
import { applyAdapter } from "./apply";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// Revisiones adversariales 2026-09-30 (docs/adversarial-1 §falla 1-2-4 y
// docs/adversarial-2 C1/A1): el sello "saldo" usaba la tolerancia de ORIENTAR
// (1% del saldo, hasta 20% de filas malas) para CERTIFICAR. Una pyme con saldo
// alto y movimientos chicos salía "probada" con cargo↔abono invertidos. Ahora el
// sello exige la ecuación AL PESO (±$1) en el 100% de las filas leídas y ninguna
// fila perdida no legítima. "Aceptar solo con PRUEBA A FAVOR".

const guardados: { empresaId?: string | null; confirmadoPor?: string | null; config?: AdapterConfig }[] = [];
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async (a: { empresaId?: string | null; confirmadoPor?: string | null; config?: AdapterConfig }) => { guardados.push(a); return "adapter-test"; },
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { delete process.env.LECTOR_ESTRUCTURA_IA; guardados.length = 0; });

type Celda = string | number | Date | null;
function libro(hojas: { nombre: string; filas: Celda[][] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const h of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h.filas, { cellDates: true }), h.nombre);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "emp-test", documento_id: "doc-test" })).result;
}
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
const cl = (n: number) => n.toLocaleString("es-CL");

/** Pyme con saldo alto ($50 M) y 20 movimientos chicos: invertir cada fila mueve 2×monto, <1% del saldo. */
function cuentaGrande(saldo0 = 50_000_000) {
  let s = saldo0;
  return Array.from({ length: 20 }, (_, i) => {
    const esCargo = i % 4 === 0;
    const m = 20_000 + ((i * 7919) % 30) * 1_000;
    s += esCargo ? -m : m;
    return { dia: i + 1, esCargo, m, saldo: s };
  });
}
const mapa = (cargo: number, abono: number, saldo = 4): AdapterConfig => ({
  header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo, abono, saldo },
});
function sellar(rows: Row[], cfg: AdapterConfig) {
  const descartes: DescarteFila[] = [];
  const lines = applyAdapter(rows, cfg, descartes);
  return { sello: sellarCartola({ rows, cfg, lines, descartes, resumen: null, formulas: [] }), lines, descartes };
}

describe("sello 'saldo' estricto (al peso, 100% de las filas)", () => {
  const movs = cuentaGrande();
  const rows: Row[] = [["Fecha", "Glosa", "Monto A", "Monto B", "Saldo"],
    ...movs.map((x) => [fch(x.dia), `Mov ${x.dia}`, x.esCargo ? cl(x.m) : "", x.esCargo ? "" : cl(x.m), cl(x.saldo)] as Row)];

  it("ADV2-1: cargo↔abono INVERTIDOS con saldo alto jamás se sellan", () => {
    const { sello } = sellar(rows, mapa(3, 2));
    expect(sello.tipo).toBe("sin_comprobar");
    expect(sello.alerta).toBe(true);
  });

  it("el mapa correcto sí se sella 'saldo'", () => {
    expect(sellar(rows, mapa(2, 3)).sello.tipo).toBe("saldo");
  });

  it("ADV2-1b: vía orquestador con títulos neutros elige la orientación que cierra AL PESO y no nace global", async () => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto 1", "Monto 2", "Saldo"],
      ...movs.map((x) => [fch(x.dia), x.esCargo ? `Pago prov ${x.dia}` : `Transf recibida ${x.dia}`,
        x.esCargo ? "" : cl(x.m), x.esCargo ? cl(x.m) : "", cl(x.saldo)])];
    const r = await parsear(libro([{ nombre: "Cartola", filas }]));
    const entradas = r.preExtracted?.filter((p) => p.tipo_flujo === "entrada").length;
    expect(entradas).toBe(movs.filter((x) => !x.esCargo).length);
    expect(r.verificacion?.tipo).toBe("saldo");
    // Un sello de saldo confirma el mapa PARA ESTA EMPRESA; volverlo global exige más.
    expect(guardados.at(-1)?.empresaId).toBe("emp-test");
    expect(guardados.at(-1)?.confirmadoPor).toBe("saldo");
  });

  it("ADV2-2: 2 de 12 montos mal leídos no se sellan (antes pasaban por el 20% de tolerancia)", () => {
    let s = 1_000_000;
    const rs: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 12; i++) {
      const m = 100_000 + i * 1000; s += m;
      rs.push([fch(i), `Venta ${i}`, "", i === 5 || i === 9 ? `${cl(m).replace(/\./g, "")}0` : cl(m), cl(s)]);
    }
    const { sello } = sellar(rs, mapa(2, 3));
    expect(sello.tipo).toBe("sin_comprobar");
    expect(sello.detalle).toMatch(/de 11 filas no cuadran \(¿cartola filtrada o incompleta\?\)/);
  });

  it("cartola FILTRADA (faltan movimientos: el saldo salta) → sin_comprobar con el aviso, no 'saldo' (caso santander.xlsx)", () => {
    let s = 1_000_000;
    const rs: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 24; i++) {
      const m = 50_000 + i * 1000; s += m;
      if (i % 8 === 0) continue; // el export filtró 3 abonos: el saldo los delata
      rs.push([fch(i), `Venta ${i}`, "", cl(m), cl(s)]);
    }
    const { sello } = sellar(rs, mapa(2, 3));
    expect(sello.tipo).toBe("sin_comprobar");
    expect(sello.alerta).toBe(true);
    expect(sello.detalle).toMatch(/^El saldo corrido no cierra: 2 de 20 filas no cuadran \(¿cartola filtrada o incompleta\?\)/);
  });

  it("A1: una fila perdida por fecha imposible o por cargo y abono a la vez impide el sello", () => {
    let s = 1_000_000;
    const rs: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 14; i++) { const m = 50_000 + i * 1000; s += m; rs.push([i === 7 ? "31/09/2026" : fch(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    const conFechaImposible = sellar(rs, mapa(2, 3));
    expect(conFechaImposible.descartes.some((d) => d.motivo === "fecha_imposible" && !d.legitimo)).toBe(true);
    expect(conFechaImposible.sello.tipo).toBe("sin_comprobar");
    expect(conFechaImposible.sello.alerta).toBe(true);

    const rs2 = rs.map((r) => [...r]);
    rs2[7][0] = fch(7);
    rs2[10][2] = "1.000"; // cargo y abono en la misma fila
    const conAmbos = sellar(rs2, mapa(2, 3));
    expect(conAmbos.descartes.some((d) => d.motivo === "cargo_y_abono")).toBe(true);
    expect(conAmbos.sello.tipo).toBe("sin_comprobar");
  });

  it("filas sin fecha con plata (2000 de 4990) no se sellan", () => {
    let s = 10_000_000;
    const rs: Row[] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 0; i < 40; i++) { const m = 1_000 + i; s += m; rs.push([i < 15 ? "" : fch(1 + (i % 28)), `Mov ${i}`, "", cl(m), cl(s)]); }
    expect(sellar(rs, mapa(2, 3)).sello.tipo).toBe("sin_comprobar");
  });

  it("otra hoja con movimientos sin leer impide el sello (plata que no se leyó gana a cualquier prueba)", async () => {
    const hoja = (base: number): Celda[][] => {
      let s = base;
      return [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"],
        ...Array.from({ length: 14 }, (_, i) => { const m = 10_000 + i * 100; const c = i % 4 === 1; s += c ? -m : m; return [fch(i + 1), `Mov ${i}`, c ? m : "", c ? "" : m, s]; })];
    };
    const r = await parsear(libro([{ nombre: "Agosto", filas: hoja(1_000_000) }, { nombre: "Septiembre", filas: hoja(2_000_000) }]));
    expect(r.censo?.otras_hojas_con_datos).toEqual(["Septiembre"]);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
  });
});

// adversarial-2 M5: una cartola de UN día en orden descendente tomaba la fila
// equivocada como "primera" y el saldo inicial salía mal (el cliente con el
// saldo correcto recibía "No cuadra"). El orden lo decide la ecuación.
describe("saldo inicial y final con el orden decidido por la ecuación", () => {
  it("un solo día, de lo más nuevo a lo más viejo", async () => {
    const { saldosDeLaCartola } = await import("./juez-banco");
    const asc = [
      { tipo: "ENTRADA" as const, fecha: "2026-09-05", monto: 1_000, descripcion: "a", n_documento: "", saldo: 101_000 },
      { tipo: "SALIDA" as const, fecha: "2026-09-05", monto: 500, descripcion: "b", n_documento: "", saldo: 100_500 },
      { tipo: "ENTRADA" as const, fecha: "2026-09-05", monto: 2_000, descripcion: "c", n_documento: "", saldo: 102_500 },
    ];
    expect(saldosDeLaCartola(asc, null)).toEqual({ inicial: 100_000, final: 102_500 });
    expect(saldosDeLaCartola([...asc].reverse(), null)).toEqual({ inicial: 100_000, final: 102_500 });
  });
});

// adversarial-1 falla 7: con dos opiniones distintas y ninguna con prueba, queda
// la que deja MENOS filas con plata sin explicar (la disputa sigue visible).
describe("dos opiniones: desempate por cobertura del censo", () => {
  it("sin prueba en ninguna, gana la que pierde menos filas", async () => {
    const { decidirDosOpiniones } = await import("./estructura-ia");
    const d = decidirDosOpiniones(
      { valido: true, firma: "a", sello: "sin_comprobar", perdidas: 1 },
      { valido: true, firma: "b", sello: "sin_comprobar", perdidas: 0 },
    );
    expect(d.elegido).toBe("ia");
    expect(d.disputa).toBeTruthy();
  });
});
