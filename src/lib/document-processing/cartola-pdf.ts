import type { DiagnosticoPdf } from "@/lib/parsers";

type Lectura = Awaited<ReturnType<typeof import("@/lib/parsers").parsePdfCartola>>;

export interface EventoRutaPdf {
  summary: string;
  metadata: Record<string, string | number | boolean | string[] | null>;
}

/**
 * Paso "cartola PDF" de la cola (2026-10-02). Corre el router + lector
 * (parsePdfCartola) y devuelve la lectura SOLO si el router dijo cartola y el
 * lector la leyó. FAIL-SAFE: cualquier error del lector (PDF roto, versión de
 * pdf.js, lo que sea) devuelve null y el job sigue su flujo de texto de siempre
 * (comprobante si es corto, IA si es largo); nunca corta la subida. Una
 * plantilla de facturas dentro de un PDF tampoco es error: parsePdfCartola ya
 * devuelve null. Siempre deja UN evento "pdf_ruta" con el camino elegido (tipo,
 * motivo, sello, filas, capa, páginas, ms), sin datos del documento.
 */
export async function leerCartolaPdf(args: {
  pdf: Uint8Array;
  documento_id: string;
  empresa_id: string;
  clave?: string;
  parse: (pdf: Uint8Array, opts: { documento_id: string; empresa_id: string; clave?: string; diagnostico: (d: DiagnosticoPdf) => void }) => Promise<Lectura>;
  registrar: (e: EventoRutaPdf) => Promise<unknown>;
}): Promise<Lectura> {
  let diag: DiagnosticoPdf | null = null;
  let r: Lectura = null;
  let error: string | null = null;
  try {
    r = await args.parse(args.pdf, {
      documento_id: args.documento_id, empresa_id: args.empresa_id, clave: args.clave, diagnostico: (d) => { diag = d; },
    });
  } catch (e) {
    error = (e as Error)?.name ?? "Error";
    r = null;
  }
  const d = diag as DiagnosticoPdf | null;
  const evento: EventoRutaPdf = error || !d
    ? { summary: "PDF → error del lector, sigue el flujo de texto", metadata: { tipo: "error", error: error ?? "sin_diagnostico", al_lector: false } }
    : {
      summary: `PDF → ${d.tipo}${d.sello ? ` (${d.sello})` : ""}`,
      metadata: { tipo: d.tipo, motivo: d.motivo, senales: d.senales.slice(0, 12), sello: d.sello ?? null, filas: d.filas ?? null, capa: d.capa ?? null, paginas: d.paginas, ms: d.ms, al_lector: !!r },
    };
  await args.registrar(evento).catch(() => {});
  return r;
}
