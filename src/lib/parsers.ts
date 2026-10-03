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
  opts?: { documento_id?: string; empresa_id?: string }
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

/**
 * Cartola en PDF por el MISMO lector determinístico que el Excel (2026-10-02).
 * Las posiciones del texto arman la grilla (parsers/pdf-grilla.ts) y la grilla
 * pasa por el orquestador con juez y sello. null = no parece cartola (menos de
 * 2 movimientos con fecha y monto) o el lector no la pudo leer (capa 4): el
 * caller sigue como antes (comprobante si es corto, IA si es largo).
 */
export async function parsePdfCartola(
  pdf: Uint8Array,
  opts?: { documento_id?: string; empresa_id?: string; clave?: string }
): Promise<Awaited<ReturnType<typeof parseExcel>> | null> {
  const { itemsDePdf, grillaDesdeItems, libroDesdeGrilla } = await import("./parsers/pdf-grilla");
  const items = await itemsDePdf(pdf, opts?.clave);
  const rows = grillaDesdeItems(items);
  if (!rows.length) return null;
  const r = await parseExcel(libroDesdeGrilla(rows), { documento_id: opts?.documento_id, empresa_id: opts?.empresa_id });
  if (r.capa_usada >= 4 || !r.preExtracted?.length) return null;
  return r;
}
