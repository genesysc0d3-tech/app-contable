import { parseExcelWithOrchestrator } from "./parsers/orchestrator";
import type { PreExtractedMovimiento } from "./parsers/types";

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
}> {
  const { content, result } = await parseExcelWithOrchestrator(buffer, opts);
  return {
    content,
    preExtracted: result.preExtracted,
    capa_usada: result.capa_usada,
    plantilla: result.plantilla,
  };
}
