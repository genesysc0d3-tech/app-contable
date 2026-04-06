import { parseExcelWithOrchestrator } from "./parsers/orchestrator";

/**
 * Public entry point for Excel parsing.
 *
 * Delegates to the layered orchestrator (adapter cache → heuristic → named
 * → legacy fallback). Always returns a string of newline-separated text
 * ready for the downstream AI processor. Never throws — the legacy fallback
 * guarantees a string is always produced.
 *
 * Optional `documento_id` enables parser_logs auditing for that document.
 */
export async function parseExcel(
  buffer: ArrayBuffer,
  opts?: { documento_id?: string }
): Promise<string> {
  const { content } = await parseExcelWithOrchestrator(buffer, opts);
  return content;
}
