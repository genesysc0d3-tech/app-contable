import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// Fixtures por BANCO con la ESTRUCTURA real de cartolas de clientas (títulos,
// filas de metadatos arriba, hojas, orden, tipos de celda, filas de total) y
// DATOS 100% sintéticos. Estructuras relevadas el 2026-09-26 desde prod (solo
// encabezados y forma de columnas). Cada banco nuevo que llegue se suma acá.
// Faltan (sin cartola real todavía): Banco de Chile, Itaú, Scotiabank,
// Security, Falabella.

const logs: Array<Record<string, unknown>> = [];
const guardados: Array<Record<string, unknown>> = [];
const ops: Array<Record<string, unknown>> = [];
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  confirmarAdapter: async () => true,
  saveAdapter: async (a: Record<string, unknown>) => { guardados.push(a); return "adapter-test"; },
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  logParserEvent: async (e: Record<string, unknown>) => { logs.push(e); },
}));
vi.mock("../ops/events", () => ({
  recordOpsEvent: async (e: Record<string, unknown>) => { ops.push(e); },
}));

beforeEach(() => { logs.length = 0; ops.length = 0; guardados.length = 0; });

type Celda = string | number | Date | null;
function libro(hojas: Record<string, Celda[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [n, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas, { cellDates: true }), n);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}
async function parsear(hojas: Record<string, Celda[][]>) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(libro(hojas), { empresa_id: "emp-test", documento_id: "doc-test" })).result;
}
const meta = (n: number): Celda[][] => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? [`Dato de cabecera ${i}`, "", "valor ficticio"] : [""]));
const dia = (d: number) => new Date(Date.UTC(2026, 8, d, 12));
const ddmmyyyy = (d: number, sep = "/") => `${String(d).padStart(2, "0")}${sep}09${sep}2026`;

describe("cartolas por banco (estructura real, datos sintéticos)", () => {
  it("Santander: MONTO + columna CARGO/ABONO (C/A) + SALDO, 11 filas de metadatos", async () => {
    const filas: Celda[][] = [];
    let saldo = 1_000_000;
    for (let i = 0; i < 20; i++) {
      const cargo = i % 4 === 1;
      const m = 5_000 + i * 1_000;
      saldo += cargo ? -m : m;
      filas.push([m, `${1000000000 + i} Transf. Cliente Ficticio ${i}`, ddmmyyyy(1 + i), saldo, `${900000 + i}`, "Sucursal", cargo ? "C" : "A", `${800000 + i}`]);
    }
    const r = await parsear({ "Movimientos CtaCte": [...meta(11), ["MONTO", "DESCRIPCIÓN MOVIMIENTO", "FECHA", "SALDO", "N° DOCUMENTO", "SUCURSAL", "CARGO/ABONO", "N° MOVIMIENTO"], ...filas.reverse()] });
    expect(r.capa_usada).not.toBe(4);
    const pe = r.preExtracted!;
    expect(pe).toHaveLength(20);
    expect(pe.filter((m) => m.tipo_flujo === "salida")).toHaveLength(5);
    expect(pe.every((m) => /Cliente Ficticio/.test(m.descripcion))).toBe(true);
  });

  it("BCI Mes Actual (.xls editada): solo 'Abono EXENTAS', fecha dd-mm-yyyy en texto, 12 filas de metadatos", async () => {
    const filas: Celda[][] = Array.from({ length: 15 }, (_, i) => ["", ddmmyyyy(1 + i, "-"), "Oficina Ficticia", `Transf de Cliente ${i}`, `${i}`, 10_000 + i * 500, ""]);
    const r = await parsear({ cartola: [...meta(12), ["", "Fecha", "Oficina", "Movimiento", "N° Documento", "Abono EXENTAS", ""], ...filas] });
    expect(r.capa_usada).not.toBe(4);
    expect(r.preExtracted!.every((m) => m.tipo_flujo === "entrada")).toBe(true);
    expect(r.preExtracted!.every((m) => /Transf de Cliente/.test(m.descripcion))).toBe(true);
  });

  it("BICE provisoria (editada): FECHA yyyymmdd, solo ABONOS, fila final de texto", async () => {
    const filas: Celda[][] = Array.from({ length: 15 }, (_, i) => [`202609${String(1 + i).padStart(2, "0")}`, `${100000000 + i}`, "", `Transferencia de Cliente ${i}`, 20_000 + i, "", "", "", ""]);
    const r = await parsear({ cartola: [...meta(11), ["FECHA", "DOCUMENTO", "CODIGO", "DESCRIPCION", "ABONOS", "", "", "", ""], ...filas, ["", "", "", "Movimientos al cierre del dia", "", "", "", "", ""]] });
    expect(r.capa_usada).not.toBe(4);
    expect(r.preExtracted).toHaveLength(15);
    expect(r.preExtracted!.every((m) => m.tipo_flujo === "entrada")).toBe(true);
  });

  it("BancoEstado Chequera: hoja Resumen + hoja Movimientos, fecha dd/mm sin año, fila de TOTAL al final", async () => {
    const resumen: Celda[][] = [["Nombre Empresa", "", "", "", "EMPRESA FICTICIA SPA"], ...meta(9), ["Alias", "", "", "", "CHEQUERA ELECTRONICA"], ["Saldo", "", "", "", "$1.234.567"]];
    const movs: Celda[][] = Array.from({ length: 12 }, (_, i) => [`${String(1 + i).padStart(2, "0")}/09`, "Sucursal", "12345678901", "Cuenta ficticia", 7, `${5000000 + i}`, `TEF DE Cliente Ficticio ${i}`, 15_000 + i * 100]);
    const total = movs.reduce((s, f) => s + Number(f[7]), 0);
    const r = await parsear({ Resumen: resumen, Movimientos: [["Fecha", "Sucursal", "N° Cuenta", "Alias", "N° Cartola", "N° Operación", "Descripción", "Depósitos / Abonos"], ...movs, ["", "", "", "", "", "", "", total]] });
    expect(r.capa_usada).not.toBe(4);
    expect(r.preExtracted).toHaveLength(12); // la fila de TOTAL no es un movimiento
    expect(r.preExtracted!.every((m) => /Cliente Ficticio/.test(m.descripcion))).toBe(true);
  });

  it("'Mis Movimientos' (BIT): Egreso (-) ANTES de Ingreso (+), sin saldo, fechas Date → glosa = Descripción", async () => {
    const filas: Celda[][] = Array.from({ length: 15 }, (_, i) => [dia(1 + i), dia(1 + i), `Transferencia recibida de Cliente ${i}`, i % 5 === 2 ? 30_000 : null, i % 5 === 2 ? null : 12_000 + i]);
    const r = await parsear({ "Hoja 1": [["Mis Movimientos"], ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)"], ...filas] });
    expect(r.capa_usada).not.toBe(4);
    const pe = r.preExtracted!;
    expect(pe.every((m) => /Cliente/.test(m.descripcion))).toBe(true); // antes tomaba "Fecha Contable"
    expect(pe.filter((m) => m.tipo_flujo === "salida")).toHaveLength(3);
  });
});

describe("guardas de la revisión adversarial (2026-09-26)", () => {
  it("la huella es la misma para dos cartolas del mismo banco con glosas y metadatos distintos", async () => {
    const { computeFingerprint } = await import("./fingerprint");
    const hdr = ["Fecha de transacción", "Glosa detalle", "Ingreso (+)", "Egreso (-)", "Saldo contable"];
    const a = [["Titular: Persona A"], hdr, ...Array.from({ length: 5 }, (_, i) => [dia(1 + i), "Corta", 1000, null, 5000 + i])];
    const b = [["Titular: Otra Persona Con Nombre Largo"], ["Período: septiembre"], hdr, ...Array.from({ length: 5 }, (_, i) => [dia(1 + i), "Una glosa bastante más larga que veinte caracteres", null, 700, 9000 - i])];
    expect(computeFingerprint(a as never)).toBe(computeFingerprint(b as never));
  });

  it("Fecha|Glosa|Monto|Saldo de un banco NO se toma como plantilla (todo entrada)", async () => {
    let saldo = 500_000;
    const filas: Celda[][] = Array.from({ length: 12 }, (_, i) => { const m = i % 3 === 0 ? -20_000 : 15_000; saldo += m; return [ddmmyyyy(1 + i), `Movimiento ${i}`, m, saldo]; });
    const r = await parsear({ Hoja1: [["Fecha", "Glosa", "Monto", "Saldo"], ...filas] });
    expect(r.plantilla).toBe(false);
    if (r.preExtracted) expect(r.preExtracted.some((m) => m.tipo_flujo === "salida") || r.capa_usada === 4).toBe(true);
  });

  it("cartola con Egreso/Ingreso/Saldo filtrada a mano: jamás 'todo entrada' con el SALDO como monto", async () => {
    // Caso real (BOLETAS BIT EM, 2026-09-11): el adaptador viejo leía monto = columna Saldo.
    const filas: Celda[][] = Array.from({ length: 12 }, (_, i) => [dia(1 + i), dia(1 + i), `Transferencia recibida de Cliente ${i}`, null, 10_000 + i, 3_000_000 + i * 97_000]);
    const r = await parsear({ "Hoja 1": [["Mis Movimientos"], ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)", "Saldo"], ...filas] });
    const montos = (r.preExtracted ?? []).map((m) => m.monto);
    expect(montos.some((m) => m >= 3_000_000)).toBe(false);
  });

  it("una planilla que ninguna capa entiende deja alarma y el POR QUÉ en el log", async () => {
    const r = await parsear({ Hoja1: [["Fecha", "Glosa", "Monto", "Saldo"], ...Array.from({ length: 12 }, (_, i) => [ddmmyyyy(1 + i), `Mov ${i}`, i % 2 ? -1000 : 2000, 50_000])] });
    expect(r.capa_usada).toBe(4);
    const log4 = logs.find((l) => l.capa_usada === 4)!;
    expect((log4.validator_failed_checks as string[]).length).toBeGreaterThan(0);
    expect(ops.some((o) => o.eventName === "parser_cayo_a_ia" && o.empresaId === "emp-test")).toBe(true);
  });
});

// Los formatos REGISTRADOS (formatos-conocidos.ts: "Mis Movimientos", BCI
// Detallado…) ya no son "nuevos": entran por capa 1 sin guardar adaptador. Estos
// tests usan títulos que NO están registrados para seguir probando el formato nuevo.
describe("formato nuevo = provisorio", () => {
  it("sin saldo que lo confirme, el formato queda PRIVADO de la empresa y deja aviso", async () => {
    const filas: Celda[][] = Array.from({ length: 15 }, (_, i) => [dia(1 + i), dia(1 + i), `Transferencia recibida de Cliente ${i}`, null, 12_000 + i]);
    await parsear({ "Hoja 1": [["Movimientos de la cuenta"], ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)"], ...filas] });
    expect(guardados).toHaveLength(1);
    expect(guardados[0].empresaId).toBe("emp-test");
    expect(ops.some((o) => o.eventName === "parser_formato_nuevo")).toBe(true);
  });

  // Revisión adversarial 2026-09-30: el sello de saldo confirma el mapa para ESA
  // empresa; volverlo global exige consenso de 2+ empresas.
  it("con el saldo cuadrando al peso en ≥10 filas, el formato queda CONFIRMADO para la empresa (no global)", async () => {
    let saldo = 1_000_000;
    const asc: Celda[][] = Array.from({ length: 20 }, (_, i) => {
      const egreso = i % 6 === 2; const m = 10_000 + i * 700;
      saldo += egreso ? -m : m;
      return [dia(1 + (i % 25)), `D5D76EB61DB98F697D346006F73B22F26229444E|${9010716960000 + i}`, `Transferencia recibida de Cliente ${i}`, egreso ? null : m, egreso ? m : null, saldo];
    });
    await parsear({ "Hoja 1": [["Fecha de transacción", "Código", "Glosa detalle", "Ingreso (+)", "Egreso (-)", "Saldo contable"], ...asc.reverse(), ["", "", "Saldo inicial", null, null, 1_000_000]] });
    expect(guardados).toHaveLength(1);
    expect(guardados[0].empresaId).toBe("emp-test");
    expect(guardados[0].confirmadoPor).toBe("saldo");
  });
});

describe("vocabulario único de títulos", () => {
  it("'CARGO/ABONO' (columna de tipo de Santander) no calza como cargo Y abono a la vez", async () => {
    const { detectByNames } = await import("./named");
    const rows = [["Fecha", "Descripción", "CARGO/ABONO", "Monto", "Saldo"], ["01/09/2026", "Pago", "C", 1000, 5000]];
    const cfg = detectByNames(rows as never);
    if (cfg) expect(cfg.columns.cargo).not.toBe(cfg.columns.abono);
  });
});
