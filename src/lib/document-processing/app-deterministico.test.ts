import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan del flujo OCR → determinístico → IA, PR 5/8: lo que se sube por la APP
// (CSV, imagen suelta, PDF comprobante) pasa primero por el determinístico.
// Antes: todo iba directo a la IA. Datos sintéticos.
vi.mock("server-only", () => ({}));
let ocrTexto = "";
let archivo: Buffer = Buffer.from("");
let pdfTexto = "";
vi.mock("@/lib/ai/ocr", () => ({
  ocrAndGroupImages: async () => ({ groupedText: ocrTexto, totalTokensInput: 0, totalTokensOutput: 0 }),
}));
vi.mock("@/lib/storage", () => ({ descargarDocumento: async () => archivo }));
vi.mock("pdf-parse", () => ({
  PDFParse: class { async getText() { return { text: pdfTexto }; } async destroy() {} },
}));
vi.mock("@/lib/parsers/adapter-store", () => ({
  getAdapterByFingerprint: async () => null, saveAdapter: async () => "a",
  incrementAdapterSuccess: async () => {}, decrementAdapterConfianza: async () => {}, logParserEvent: async () => {},
}));

function sbFalso() {
  const tabla = (t: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q;
    q.maybeSingle = async () => ({
      data: t === "empresas" ? { razon_social: "Comercial Andes SpA", rut: "76.123.456-7" } : { storage_provider: "r2" },
      error: null,
    });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return { from: tabla } as never;
}
const job = (tipo: string) => ({ id: "j", documento_id: "d", empresa_id: "e", tipo, storage_path: "e/d/archivo", metadata: {}, created_at: "2026-09-27T12:00:00Z" }) as never;
const COMPROBANTE = ["Comprobante de transferencia", "Monto: $53.000", "Fecha: 14/09/2026", "De: Juan Perez Soto", "Para: Comercial Andes SpA"].join("\n");

beforeEach(() => { ocrTexto = ""; pdfTexto = ""; archivo = Buffer.from(""); });

describe("carriles de la app por el determinístico", () => {
  it("imagen suelta con comprobante legible → movimiento pre-extraído (no IA de lectura)", async () => {
    ocrTexto = COMPROBANTE;
    const { extractContentFromJob } = await import("./queue");
    const r = await extractContentFromJob(sbFalso(), job("imagen"));
    expect(r.preExtracted).toEqual([expect.objectContaining({ monto: 53000, tipo_flujo: "entrada", fecha: "2026-09-14" })]);
  });

  it("imagen que no es comprobante → sin pre-extraído (sigue la IA)", async () => {
    ocrTexto = "hola, mañana te pago";
    const { extractContentFromJob } = await import("./queue");
    const r = await extractContentFromJob(sbFalso(), job("imagen"));
    expect(r.preExtracted).toBeNull();
  });

  it("PDF corto (comprobante) → determinístico", async () => {
    pdfTexto = COMPROBANTE;
    const { extractContentFromJob } = await import("./queue");
    const r = await extractContentFromJob(sbFalso(), job("pdf"));
    expect(r.preExtracted?.[0]?.monto).toBe(53000);
  });

  it("CSV de cartola → lector de cartolas (antes: texto a la IA)", async () => {
    const filas = ["Fecha;Descripción;Cargo;Abono;Saldo"];
    let saldo = 100000;
    for (let i = 1; i <= 12; i++) { const a = 1000 * i; saldo += a; filas.push(`${String(i).padStart(2, "0")}/09/2026;Transferencia recibida de Cliente ${i};;${a};${saldo}`); }
    archivo = Buffer.from(filas.join("\n"));
    const { extractContentFromJob } = await import("./queue");
    const r = await extractContentFromJob(sbFalso(), job("csv"));
    expect(r.preExtracted?.length).toBe(12);
  });
});
