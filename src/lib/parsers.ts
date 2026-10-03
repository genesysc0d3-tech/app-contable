import { parseExcelWithOrchestrator } from "./parsers/orchestrator";
import type { CensoCartola, PreExtractedMovimiento } from "./parsers/types";

/**
 * Public entry point for Excel parsing.
 *
 * Delegates to the layered orchestrator (adapter cache → heuristic → named
 * → legacy fallback). Always returns a content string plus, when a
 * deterministic layer succeeded, a list of pre-extracted movimientos the
 * processor can use to bypass OpenCode extraction entirely.
 *
 * Optional `documento_id` enables parser_logs auditing for that document.
 * `empresa_id` aísla el cache de adapters por tenant (no aplicar el mapeo manual
 * de otra empresa al mismo formato de banco).
 */
export async function parseExcel(
  buffer: ArrayBuffer,
  opts?: { documento_id?: string; empresa_id?: string; origen?: "pdf" }
): Promise<{
  content: string;
  preExtracted: PreExtractedMovimiento[] | null;
  capa_usada: number;
  /** Firma de la plantilla massDTE (ver AdapterConfig.plantilla). */
  plantilla: boolean;
  /** Censo de filas con plata de la hoja leída (null en capa 4). */
  censo: CensoCartola | null;
}> {
  const { content, result } = await parseExcelWithOrchestrator(buffer, opts);
  return {
    content,
    preExtracted: result.preExtracted,
    capa_usada: result.capa_usada,
    plantilla: result.plantilla,
    censo: result.censo ?? null,
  };
}

/** Lo que se decidió con un PDF (para el evento de ops; sin datos del documento). */
export interface DiagnosticoPdf {
  tipo: import("./parsers/pdf-router").TipoPdf;
  motivo: string;
  senales: string[];
  paginas: number;
  ms: number;
  /** Solo si entró al lector. */
  filas?: number;
  sello?: string;
  capa?: number;
}

/**
 * Cartola en PDF por el MISMO lector determinístico que el Excel (2026-10-02).
 * El ROUTER (parsers/pdf-router.ts) decide antes de leer, por evidencia
 * positiva: solo "cartola" entra; factura/DTE, comprobante, tarjeta u "otro" →
 * null y el caller sigue el flujo de antes (comprobante si es corto, IA si es
 * largo). También null si el PDF pasa de MAX_PAGINAS (no se sella con páginas
 * sin leer), si el lector no la pudo leer (capa 4) o si la "cartola" resulta ser
 * una plantilla de facturas.
 */
export async function parsePdfCartola(
  pdf: Uint8Array,
  opts?: {
    documento_id?: string; empresa_id?: string; clave?: string; diagnostico?: (d: DiagnosticoPdf) => void;
    /** Posiciones ya leídas en la MISMA apertura que el texto (leerPdf): no se vuelve a abrir el PDF. */
    leido?: { items: import("./parsers/pdf-grilla").ItemPdf[]; paginas: number; truncado: boolean };
  }
): Promise<Awaited<ReturnType<typeof parseExcel>> | null> {
  const t0 = Date.now();
  const { leerItemsPdf, libroDesdeGrilla } = await import("./parsers/pdf-grilla");
  const { clasificarPdf } = await import("./parsers/pdf-router");
  const { items, paginas, truncado } = opts?.leido ?? await leerItemsPdf(pdf, opts?.clave);
  const avisar = (d: Omit<DiagnosticoPdf, "paginas" | "ms">) => opts?.diagnostico?.({ ...d, paginas, ms: Date.now() - t0 });
  if (truncado) {
    avisar({ tipo: "otro", motivo: "demasiadas_paginas", senales: [] });
    return null;
  }
  const ruta = clasificarPdf(items);
  if (ruta.tipo !== "cartola" || !ruta.rows.length) {
    avisar({ tipo: ruta.tipo, motivo: ruta.motivo, senales: ruta.senales });
    return null;
  }
  let r: Awaited<ReturnType<typeof parseExcel>>;
  try {
    r = await parseExcel(libroDesdeGrilla(ruta.rows), { documento_id: opts?.documento_id, empresa_id: opts?.empresa_id, origen: "pdf" });
  } catch (error) {
    const { PlantillaFacturasEnCartolaError } = await import("./parsers/orchestrator");
    if (!(error instanceof PlantillaFacturasEnCartolaError)) throw error;
    avisar({ tipo: "otro", motivo: "plantilla_facturas", senales: ruta.senales });
    return null;
  }
  const leida = r.capa_usada < 4 && !!r.preExtracted?.length;
  avisar({
    tipo: "cartola", motivo: leida ? ruta.motivo : "lector_no_la_leyo", senales: ruta.senales,
    filas: r.preExtracted?.length ?? 0, sello: r.censo?.verificacion?.tipo ?? "sin_comprobar", capa: r.capa_usada,
  });
  return leida ? r : null;
}
