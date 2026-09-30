import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// Puntos 5 y 6 (2026-09-30). El JUEZ EXTERNO es lo que el propio banco imprime:
// el bloque "Resumen del período" (saldo anterior, total cargos, total abonos,
// saldo final), la fila de totales o la fórmula =SUM(rango). Lo leído se
// compara con eso AL PESO. Y cada cartola sale con un SELLO explícito:
// verificacion = "saldo" | "total_banco" | "cliente" | "sin_comprobar". Nunca
// un "OK" implícito porque ningún chequeo protestó.

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
function libro(filas: Celda[][], formulas: Record<string, { v: number; f: string }> = {}): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(filas, { cellDates: true });
  for (const [ref, c] of Object.entries(formulas)) ws[ref] = { t: "n", v: c.v, f: c.f };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "emp-test", documento_id: "doc-test" })).result;
}
const f = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;

// 12 movimientos sin saldo: 8 abonos, 4 cargos.
const movs = Array.from({ length: 12 }, (_, i) => {
  const cargo = i % 3 === 1;
  const monto = 10_000 + ((i * 7919) % 50) * 1_000;
  return { dia: i + 1, cargo, monto, glosa: cargo ? `Pago proveedor ${i}` : `Transferencia recibida ${i}` };
});
const sumCargos = movs.filter((m) => m.cargo).reduce((s, m) => s + m.monto, 0);
const sumAbonos = movs.filter((m) => !m.cargo).reduce((s, m) => s + m.monto, 0);
const cuerpo = (invertir = false): Celda[][] => movs.map((m) => [f(m.dia), m.glosa,
  (m.cargo !== invertir) ? m.monto.toLocaleString("es-CL") : "", (m.cargo !== invertir) ? "" : m.monto.toLocaleString("es-CL")]);

describe("resumen impreso del banco (arriba de los movimientos)", () => {
  const resumen = (cargos: number, abonos: number): Celda[][] => [
    ["Banco Ficticio"],
    ["Resumen del Periodo"],
    ["Saldo Anterior", "Total Cargos y Cheques", "Total Abonos y Depósitos", "Saldo Contable Final del Periodo"],
    ["1.000.000", cargos.toLocaleString("es-CL"), abonos.toLocaleString("es-CL"), (1_000_000 - cargos + abonos).toLocaleString("es-CL")],
    [],
    ["Fecha", "Descripción", "Cargos", "Abonos"],
  ];

  it("si lo leído calza al peso con el resumen, el sello es total_banco", async () => {
    const r = await parsear(libro([...resumen(sumCargos, sumAbonos), ...cuerpo()]));
    expect(r.verificacion?.tipo).toBe("total_banco");
    expect(r.censo?.verificacion?.tipo).toBe("total_banco");
    expect(r.censo?.saldo_inicial).toBe(1_000_000);
    expect(r.censo?.saldo_final).toBe(1_000_000 - sumCargos + sumAbonos);
  });

  it("FIXTURE NEGATIVO: si el banco dice otra cosa, queda sin_comprobar con el detalle", async () => {
    const r = await parsear(libro([...resumen(sumCargos + 5_000, sumAbonos), ...cuerpo()]));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.detalle).toMatch(/cargos/i);
  });
});

describe("fila de totales y fórmula SUMA", () => {
  it("una fila 'Total' con la suma de cada columna prueba la lectura si los títulos dicen la dirección", async () => {
    const r = await parsear(libro([["Fecha", "Descripción", "Cargos", "Abonos"], ...cuerpo(), [], ["Total", "", sumCargos, sumAbonos]]));
    expect(r.verificacion?.tipo).toBe("total_banco");
  });

  it("FIXTURE NEGATIVO: con títulos genéricos la fila de totales calza pero NO dice la dirección → sin_comprobar", async () => {
    const r = await parsear(libro([["Fecha", "Descripción", "Columna 3", "Columna 4"], ...cuerpo(), [], ["Total", "", sumCargos, sumAbonos]]));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });

  it("=SUM(rango) del banco: la fila de la fórmula es de totales y su valor prueba la columna", async () => {
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos"], ...movs.map((m) => [f(m.dia), m.glosa, m.cargo ? m.monto : null, m.cargo ? null : m.monto])];
    const n = filas.length; // fila Excel de la fórmula = n + 1
    const r = await parsear(libro([...filas, ["", "", null, null]], {
      [`C${n + 1}`]: { v: sumCargos, f: `SUM(C2:C${n})` },
      [`D${n + 1}`]: { v: sumAbonos, f: `SUM(D2:D${n})` },
    }));
    expect(r.rows_extracted).toBe(12);
    expect(r.censo?.descartes.every((d) => d.legitimo)).toBe(true);
    expect(r.verificacion?.tipo).toBe("total_banco");
  });

  it("FIXTURE NEGATIVO: una fórmula que no calza con lo leído deja la cartola sin_comprobar", async () => {
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos"], ...movs.map((m) => [f(m.dia), m.glosa, m.cargo ? m.monto : null, m.cargo ? null : m.monto])];
    const n = filas.length;
    const r = await parsear(libro([...filas, ["", "", null, null]], {
      [`C${n + 1}`]: { v: sumCargos + 999_000, f: `SUM(C2:C${n})` },
    }));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.detalle).toMatch(/SUM|suma/i);
  });
});

describe("sello por cartola", () => {
  it("con saldo corrido que cuadra: saldo", async () => {
    let saldo = 500_000;
    const filas: Celda[][] = movs.map((m) => {
      saldo += m.cargo ? -m.monto : m.monto;
      return [f(m.dia), m.glosa, m.cargo ? m.monto : null, m.cargo ? null : m.monto, saldo];
    });
    const r = await parsear(libro([["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", null, null, 500_000], ...filas]));
    expect(r.verificacion?.tipo).toBe("saldo");
    expect(r.censo?.saldo_final).toBe(saldo);
    expect(r.censo?.saldo_inicial).toBe(500_000);
  });

  it("FIXTURE NEGATIVO: sin saldo ni totales la lectura queda sin_comprobar (nunca OK implícito)", async () => {
    const r = await parsear(libro([["Fecha", "Descripción", "Cargos", "Abonos"], ...cuerpo()]));
    expect(r.capa_usada).not.toBe(4);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.detalle).toBeTruthy();
    expect(r.censo?.muestra?.length).toBeGreaterThan(0);
    expect(r.censo?.muestra?.length).toBeLessThanOrEqual(3);
  });

  it("la cuenta del encabezado queda como huella + últimos 4 dígitos (para encadenar cartolas)", async () => {
    const r = await parsear(libro([["Cuenta Corriente: 00-123-45678-90"], [], ["Fecha", "Descripción", "Cargos", "Abonos"], ...cuerpo()]));
    expect(r.censo?.cuenta?.sufijo).toBe("7890");
    expect(r.censo?.cuenta?.huella).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("funciones puras del juez", () => {
  it("una GLOSA con 'TOTAL … CREDITO' en una fila con fecha no es el resumen del banco (regresión medida 2026-09-30)", async () => {
    const { detectarResumenImpreso } = await import("./juez-banco");
    expect(detectarResumenImpreso([
      ["Fecha", "Descripción", "Cargos", "Abonos"],
      ["02/09/2026", "PAGO TOTAL TARJETA CREDITO", "300.000", ""],
    ])).toBeNull();
  });

  it("detectarResumenImpreso lee etiqueta y valor en la celda de al lado", async () => {
    const { detectarResumenImpreso } = await import("./juez-banco");
    const r = detectarResumenImpreso([
      ["SALDO ANTERIOR", "$ 1.000"],
      ["TOTAL CARGOS", "$ 300"],
      ["TOTAL ABONOS", "$ 500"],
      ["SALDO FINAL", "$ 1.200"],
    ]);
    expect(r).toMatchObject({ saldoInicial: 1000, totalCargos: 300, totalAbonos: 500, saldoFinal: 1200 });
  });
});
