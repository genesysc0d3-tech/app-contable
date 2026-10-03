import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { cartolaPdfSintetica, negativoPdfSintetico, TIPOS_NEGATIVOS } from "@/lib/parsers/testing/cartola-pdf-sintetica";

/**
 * UNA SOLA APERTURA por PDF en la cola (2026-10-03). Antes cada PDF se abría y
 * parseaba DOS veces con pdf.js: texto (leerTextoPdf) y posiciones (leerItemsPdf
 * dentro de parsePdfCartola). Datos 100% sintéticos.
 */

vi.mock("server-only", () => ({}));
let archivo: Buffer = Buffer.from("");
vi.mock("@/lib/storage", () => ({ descargarDocumento: async () => archivo }));
vi.mock("@/lib/ops/events", () => ({ recordOpsEvent: async () => {}, recordOpsError: async () => {} }));
vi.mock("@/lib/parsers/adapter-store", () => ({
  getAdapterByFingerprint: async () => null, saveAdapter: async () => "a", promoverMapaGlobalSiHayConsenso: async () => false,
  getAdaptersConfirmadosEmpresa: async () => [], confirmarAdapter: async () => true,
  incrementAdapterSuccess: async () => {}, decrementAdapterConfianza: async () => {}, logParserEvent: async () => {},
}));

// Espía del loader: cuenta cada vez que pdf.js ABRE un documento (load() sin doc en caché).
const conteo = { aperturas: 0 };
vi.mock("pdf-parse", async (importOriginal) => {
  const real = await importOriginal<typeof import("pdf-parse")>();
  // load() es privado en los tipos de pdf-parse: se ve la clase como lo que es en JS.
  const Base = real.PDFParse as unknown as new (o: unknown) => { doc?: unknown; load(): Promise<unknown> };
  class PDFParseEspia extends Base {
    async load() {
      if (this.doc === undefined) conteo.aperturas++;
      return super.load();
    }
  }
  return { ...real, PDFParse: PDFParseEspia as unknown as typeof real.PDFParse };
});

const RUT = "76.123.456-7";
function sbFalso() {
  const tabla = (t: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q;
    q.maybeSingle = async () => ({
      data: t === "empresas" ? { razon_social: "Comercial Andes SpA", rut: RUT } : { storage_provider: "r2" },
      error: null,
    });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return { from: tabla } as never;
}
const job = { id: "j", documento_id: "d", empresa_id: "e", usuario_id: "u", tipo: "pdf", storage_path: "e/d/archivo.pdf", metadata: {}, created_at: "2026-09-27T12:00:00Z" } as never;

/** El texto de ANTES: getText de pdf-parse, tal cual lo hacía leerTextoPdf. */
async function textoDeAntes(pdf: Uint8Array, password?: string) {
  const { PDFParse } = await import("pdf-parse");
  const data = new Uint8Array(pdf);
  const p = new PDFParse(password ? { data, password } : { data });
  try { return (await p.getText()).text; } finally { await p.destroy().catch(() => {}); }
}

async function extraer(pdf: Uint8Array) {
  archivo = Buffer.from(pdf);
  conteo.aperturas = 0;
  const { extractContentFromJob } = await import("./queue");
  const r = await extractContentFromJob(sbFalso(), job);
  return { r, aperturas: conteo.aperturas };
}

beforeEach(() => { conteo.aperturas = 0; });

describe("cola: un PDF se abre UNA vez con pdf.js", () => {
  it("cartola sintética: 1 apertura, y sale por el lector (posiciones reusadas)", async () => {
    const { pdf, verdad } = await cartolaPdfSintetica({ formato: "itau", filas: 12, seed: 3 });
    const { r, aperturas } = await extraer(pdf);
    expect(aperturas).toBe(1);
    expect(r.preExtracted?.length).toBe(verdad.length);
  });
  it("negativo (no cartola): 1 apertura y el texto es el de antes", async () => {
    const pdf = await negativoPdfSintetico(TIPOS_NEGATIVOS[0], 1, 9);
    const { r, aperturas } = await extraer(pdf);
    expect(aperturas).toBe(1);
    expect(r.contenido).toBe(await textoDeAntes(pdf));
  });
  it("PDF con clave = RUT: solo los intentos de clave (sin clave + 1ª variante), sin reabrir para posiciones", async () => {
    const doc = new jsPDF({ encryption: { userPassword: "761234567", ownerPassword: "x761234567", userPermissions: ["print"] } });
    doc.text("CARTOLA SINTETICA", 10, 10);
    doc.text("01/08/2026 TRANSFER DE CLIENTE UNO 150000", 10, 20);
    const pdf = new Uint8Array(doc.output("arraybuffer"));
    const { r, aperturas } = await extraer(pdf);
    expect(aperturas).toBe(2); // antes: 3 (2 de texto + 1 de posiciones con la clave)
    expect(r.contenido).toBe(await textoDeAntes(pdf, "761234567"));
  });
  it(`PDF de más de 80 páginas: 1 apertura, texto completo igual al de antes, sin posiciones`, async () => {
    const { MAX_PAGINAS, leerPdf } = await import("@/lib/parsers/pdf-grilla");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    for (let p = 0; p <= MAX_PAGINAS; p++) { if (p) doc.addPage(); doc.text(`Página ${p + 1}`, 40, 40); }
    const pdf = new Uint8Array(doc.output("arraybuffer"));
    const { r, aperturas } = await extraer(pdf);
    expect(aperturas).toBe(1);
    expect(r.contenido).toBe(await textoDeAntes(pdf));
    expect(r.contenido).toContain(`Página ${MAX_PAGINAS + 1}`);
    const l = await leerPdf(pdf);
    expect(l).toMatchObject({ items: [], paginas: MAX_PAGINAS + 1, truncado: true });
  });
  it("PDF basura: falla igual que antes (mismo error del flujo de texto)", async () => {
    const basura = new Uint8Array([1, 2, 3, 4, 5]);
    const antes = await textoDeAntes(basura).then(() => null, (e: Error) => e);
    expect(antes).toBeTruthy();
    archivo = Buffer.from(basura);
    const { extractContentFromJob } = await import("./queue");
    await expect(extractContentFromJob(sbFalso(), job)).rejects.toMatchObject({ name: antes!.name, message: antes!.message });
  });
});

describe("leerPdf = texto de antes + posiciones de antes (corpus sintético)", () => {
  it("cartolas y negativos: texto byte a byte y items idénticos a leerItemsPdf", async () => {
    const { leerPdf, leerItemsPdf } = await import("@/lib/parsers/pdf-grilla");
    const pdfs: Uint8Array[] = [];
    for (const [i, formato] of (["itau", "estado"] as const).entries()) {
      for (const filas of [1, 3, 12, 60, 140]) pdfs.push((await cartolaPdfSintetica({ formato, filas, seed: filas + i, glosaMultilinea: filas > 50 })).pdf);
    }
    for (const t of TIPOS_NEGATIVOS) pdfs.push(await negativoPdfSintetico(t, 2, 12));
    for (const pdf of pdfs) {
      const l = await leerPdf(pdf);
      expect(l.texto).toBe(await textoDeAntes(pdf));
      const antes = await leerItemsPdf(pdf);
      expect(l.items).toEqual(antes.items);
      expect({ paginas: l.paginas, truncado: l.truncado }).toEqual({ paginas: antes.paginas, truncado: antes.truncado });
    }
  });
});

describe("fail-safe: si la apertura única se rompe, el PDF sigue el flujo de antes", () => {
  it("leerPdf lanza (no por clave) → texto por pdf-parse como antes y el paso cartola abre por su cuenta", async () => {
    vi.resetModules();
    vi.doMock("@/lib/parsers/pdf-grilla", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/parsers/pdf-grilla")>();
      return { ...real, leerPdf: async () => { throw new Error("apertura única rota"); } };
    });
    try {
      const { pdf, verdad } = await cartolaPdfSintetica({ formato: "estado", filas: 8, seed: 5 });
      archivo = Buffer.from(pdf);
      const { extractContentFromJob } = await import("./queue");
      const r = await extractContentFromJob(sbFalso(), job);
      expect(r.preExtracted?.length).toBe(verdad.length);
      const neg = await negativoPdfSintetico(TIPOS_NEGATIVOS[1], 3, 7);
      archivo = Buffer.from(neg);
      expect((await extractContentFromJob(sbFalso(), job)).contenido).toBe(await textoDeAntes(neg));
    } finally {
      vi.doUnmock("@/lib/parsers/pdf-grilla");
      vi.resetModules();
    }
  });
});
