import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { grillaEnmascarada } from "./estructura-ia";
import type { Row } from "./types";

// Revisiones adversariales 2026-09-30 (adversarial-1 falla 9, adversarial-2 A5/M4):
//  - DeepSeek (OpenCode Go) se llama SOLO si el lector no tiene prueba: con sello
//    de saldo o total del banco la segunda opinión no aporta y cuesta ~4,5 s.
//  - La "fila de títulos" que viaja en texto puede ser metadata o un movimiento:
//    solo viaja en claro si es claramente un encabezado (palabras del diccionario
//    de roles bancarios, sin dígitos); si no, se enmascara como el resto.

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

const fetchOriginal = globalThis.fetch;
let llamadas = 0;
beforeEach(() => {
  llamadas = 0;
  process.env.LECTOR_ESTRUCTURA_IA = "1";
  process.env.OPENCODE_GO_API_KEY = "test-key";
  globalThis.fetch = (async () => { llamadas++; return new Response("{}", { status: 500 }); }) as typeof fetch;
});
afterEach(() => {
  delete process.env.LECTOR_ESTRUCTURA_IA;
  delete process.env.OPENCODE_GO_API_KEY;
  globalThis.fetch = fetchOriginal;
});

function libro(filas: (string | number)[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "C");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, { empresa_id: "emp-test" })).result;
}
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;

describe("paso IA solo sin prueba", () => {
  it("con sello de saldo NO llama a DeepSeek", async () => {
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ["", "Saldo inicial", "", "", 1_000_000]];
    let s = 1_000_000;
    for (let i = 1; i <= 14; i++) { const m = 10_000 + i; const c = i % 3 === 0; s += c ? -m : m; filas.push([fch(i), `Mov ${i}`, c ? m : "", c ? "" : m, s]); }
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("saldo");
    expect(llamadas).toBe(0);
  });

  it("sin prueba (sin saldo ni totales) sí la consulta", async () => {
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Cargos", "Abonos"]];
    for (let i = 1; i <= 14; i++) { const m = 10_000 + i; const c = i % 3 === 0; filas.push([fch(i), `Mov ${i}`, c ? m : "", c ? "" : m]); }
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(llamadas).toBe(1);
  });
});

describe("la fila de títulos solo viaja en claro si es claramente un encabezado", () => {
  it("P1: metadata (titular, RUT, cuenta) justo encima de los datos va enmascarada", () => {
    const rows: Row[] = [
      ["Titular: JUAN PEREZ SOTO", "RUT 12.345.678-9", "Cta 00-123-45678-09"],
      ["01/09/2026", "Transf de MARIA GONZALEZ 11.111.111-1", "15.000", "", "1.015.000"],
      ["02/09/2026", "Transf de PEDRO ROJAS 22.222.222-2", "", "5.000", "1.010.000"],
      ["03/09/2026", "Pago CAROLINA DIAZ", "7.000", "", "1.017.000"],
    ];
    const g = grillaEnmascarada(rows);
    for (const secreto of ["JUAN", "PEREZ", "12.345.678-9", "45678", "Titular"]) expect(g).not.toContain(secreto);
  });

  it("P2: un movimiento sin fecha (continuación) no sube como 'títulos' en claro", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Abono", "Cargo", "Saldo"],
      ["01/09/2026", "Transf de MARIA GONZALEZ 11.111.111-1", "15.000", "", "1.015.000"],
      ["", "Transf de JUAN PEREZ 12.345.678-9", "20.000", "", "1.035.000"],
      ["03/09/2026", "Pago CAROLINA DIAZ", "", "7.000", "1.028.000"],
      ["04/09/2026", "Pago LUIS SOTO", "", "1.000", "1.027.000"],
      ["05/09/2026", "Pago ANA ROJAS", "", "1.000", "1.026.000"],
    ];
    const g = grillaEnmascarada(rows);
    for (const secreto of ["JUAN", "PEREZ", "12.345.678-9", "20.000", "MARIA", "CAROLINA"]) expect(g).not.toContain(secreto);
  });

  it("un encabezado de verdad sí viaja (es el formato del banco, no datos)", () => {
    const rows: Row[] = [
      ["Fecha Mov.", "Descripción", "N° Documento", "Cargos (-)", "Abonos (+)", "Saldo Disponible"],
      ["01/09/2026", "Transf de MARIA", "", "15.000", "", "1.015.000"],
      ["02/09/2026", "Transf de PEDRO", "", "", "5.000", "1.020.000"],
      ["03/09/2026", "Pago CAROLINA", "", "7.000", "", "1.013.000"],
    ];
    expect(grillaEnmascarada(rows)).toContain("fila 0: [0] Fecha Mov. | [1] Descripción | [2] N° Documento | [3] Cargos (-) | [4] Abonos (+) | [5] Saldo Disponible");
  });
});
