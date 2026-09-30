import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { LectorMontos, decidirFormatoColumna } from "./numeros";

// Revisiones adversariales 2026-09-30 (adversarial-2 C3/M2, adversarial-1 falla 5):
//  - La ambigüedad de formato es POR CELDA: una celda rara ("107,000" en una
//    columna chilena, un pie "Tasa 1.50") se resuelve por la mayoría clara de la
//    columna o va SOLA al censo como monto_ambiguo. Jamás tumba la cartola a capa 4.
//  - Texto sucio ("USD 1,500.00", "1,5E+06") nunca se lee como 1 en silencio.
//  - CSV chileno: "1.500" = mil quinientos y "05/09/2026" = 5 de septiembre.

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

async function parsear(buf: ArrayBuffer | Uint8Array) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  const ab = buf instanceof Uint8Array ? (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) : buf;
  return (await parseExcelWithOrchestrator(ab, { empresa_id: "emp-test" })).result;
}
function libro(filas: (string | number)[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "C");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;

describe("formato por mayoría: la duda es de la celda, no de la columna", () => {
  it("14 celdas chilenas y una '107,000': la columna es chilena y solo esa celda queda dudosa", () => {
    const col = [...Array.from({ length: 14 }, (_, i) => `1${String(i).padStart(2, "0")}.000`), "107,000"];
    expect(decidirFormatoColumna(col).formato).toBe("chilean");
    const rows = col.map((v) => [v]);
    const lec = new LectorMontos(rows, 0);
    expect(lec.leer(rows[0], 0)).toMatchObject({ valor: 100_000, ambiguo: false });
    expect(lec.leer(rows[14], 0)).toMatchObject({ ambiguo: true, referencia: 107_000 });
  });

  it("C3: una celda '107,000' deja la cartola en capa 2 (14 leídas + 1 al censo), no en capa 4", async () => {
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (let i = 1; i <= 15; i++) { const m = 100_000 + i * 1_000; s += m; filas.push([fch(i), `Venta ${i}`, "", i === 7 ? "107,000" : m.toLocaleString("es-CL"), s.toLocaleString("es-CL")]); }
    const r = await parsear(libro(filas));
    expect(r.capa_usada).not.toBe(4);
    expect(r.censo?.leidas).toBe(14);
    expect(r.censo?.descartes.map((d) => [d.excel_row, d.motivo, d.legitimo])).toEqual([[8, "monto_ambiguo", false]]);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });

  it("C3: un pie 'Tasa de interés mensual 1.50' en la columna de abonos no tumba la cartola", async () => {
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"]];
    let s = 1_000_000;
    for (let i = 1; i <= 15; i++) { const m = 100_000 + i * 1_000; s += m; filas.push([fch(i), `Venta ${i}`, "", m.toLocaleString("es-CL"), s.toLocaleString("es-CL")]); }
    filas.push([]); filas.push(["", "Tasa de interés mensual", "", "1.50", ""]);
    const r = await parsear(libro(filas));
    expect(r.capa_usada).not.toBe(4);
    expect(r.censo?.leidas).toBe(15);
  });
});

describe("texto sucio: leer bien o al censo, nunca 1 en silencio", () => {
  const leer = (v: string, columna: string[] = ["1.500", "25.000", "300.000"]) => {
    const rows = [...columna, v].map((x) => [x]);
    return new LectorMontos(rows, 0).leer(rows[rows.length - 1], 0);
  };
  it("'USD 1,500.00' (moneda extranjera) va al censo", () => {
    expect(leer("USD 1,500.00")).toMatchObject({ ambiguo: true });
  });
  it("'1,5E+06' y '1.5E+06' (notación científica) van al censo", () => {
    expect(leer("1,5E+06")).toMatchObject({ ambiguo: true });
    expect(leer("1.5E+06")).toMatchObject({ ambiguo: true });
  });
  it("'1.500 CR' y '1.500 DB' se leen con su signo", () => {
    expect(leer("1.500 CR")).toMatchObject({ valor: 1_500, ambiguo: false });
    expect(leer("1.500 DB")).toMatchObject({ valor: -1_500, ambiguo: false });
  });
  it("negativo con '-' al final", () => {
    expect(leer("418.370-")).toMatchObject({ valor: -418_370, ambiguo: false });
  });
  it("'1,500 CR' en columna chilena: dudosa, no 1", () => {
    const m = leer("1,500 CR");
    expect(m.valor === 1).toBe(false);
    expect(m.ambiguo || m.valor === 1_500).toBe(true);
  });
});

describe("CSV chileno", () => {
  it("';' con '1.500' = mil quinientos y '05/09/2026' = 5 de septiembre", async () => {
    const lin = ["Fecha;Descripcion;Cargo;Abono;Saldo"];
    let s = 100_000;
    for (let d = 1; d <= 14; d++) {
      const m = 1_500 + d * 100; const cargo = d % 4 === 0; s += cargo ? -m : m;
      lin.push([`${String(d).padStart(2, "0")}/09/2026`, cargo ? "Pago" : "Deposito", cargo ? m.toLocaleString("es-CL") : "", cargo ? "" : m.toLocaleString("es-CL"), s.toLocaleString("es-CL")].join(";"));
    }
    const r = await parsear(new TextEncoder().encode(lin.join("\n")));
    expect(r.capa_usada).toBe(2);
    const pe = r.preExtracted ?? [];
    expect(pe).toHaveLength(14);
    expect(pe[0]).toMatchObject({ fecha: "2026-09-01", monto: 1_600, tipo_flujo: "entrada" });
    expect(pe[4]).toMatchObject({ fecha: "2026-09-05", monto: 2_000 });
    expect(r.verificacion?.tipo).toBe("saldo");
  });

  it("',' con montos planos y fechas dd/mm (día ≤ 12): nunca 9 de mayo", async () => {
    const lin = ["Fecha,Descripcion,Cargo,Abono,Saldo"];
    let s = 6_000_000;
    for (let d = 1; d <= 20; d++) { const m = 10_000 + d * 10; const cargo = d % 3 === 0; s += cargo ? -m : m; lin.push([`${String(d).padStart(2, "0")}/09/2026`, "Mov", cargo ? m : "", cargo ? "" : m, s].join(",")); }
    const r = await parsear(new TextEncoder().encode(lin.join("\n")));
    const fechas = (r.preExtracted ?? []).map((p) => p.fecha);
    expect(fechas).toHaveLength(20);
    expect(fechas.every((f) => f.startsWith("2026-09-"))).toBe(true);
  });

  it("columna mm/dd inequívoca (un '09/13/2026') se lee como mes/día", async () => {
    const lin = ["Date,Description,Debit,Credit,Balance"];
    let s = 6_000_000;
    for (let d = 1; d <= 14; d++) { const m = 10_000 + d * 10; const deb = d % 4 === 0; s += deb ? -m : m; lin.push([`09/${String(d).padStart(2, "0")}/2026`, "Mov", deb ? m : "", deb ? "" : m, s].join(",")); }
    const r = await parsear(new TextEncoder().encode(lin.join("\n")));
    const fechas = (r.preExtracted ?? []).map((p) => p.fecha);
    expect(fechas[12]).toBe("2026-09-13");
    expect(fechas[4]).toBe("2026-09-05");
  });
});
