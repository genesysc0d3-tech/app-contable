import { createHash } from "crypto";
import type { Row } from "./types";

/**
 * Deterministic structural fingerprint of a spreadsheet.
 *
 * The goal: two files from the same bank / same template should produce the
 * SAME fingerprint even though their transactions (values) differ entirely.
 * Conversely, two files with different column layouts should produce DIFFERENT
 * fingerprints.
 *
 * Strategy: normalize each cell in the first N rows into a single character
 * representing its "kind" (date, number, long-text, short-text, empty), then
 * hash the resulting string.
 *
 * Never includes actual values — only structural signals. Safe to share across
 * tenants without leaking any transaction data.
 */
export function computeFingerprint(rows: Row[]): string {
  const SAMPLE_ROWS = 20;
  const sample = rows.slice(0, SAMPLE_ROWS);

  const signature = sample
    .map((r) => (r ?? []).map(classifyCell).join(""))
    .join("|");

  return createHash("sha256").update(signature).digest("hex").slice(0, 16);
}

function classifyCell(cell: unknown): string {
  if (cell == null || cell === "") return "_";
  const s = String(cell).trim();
  if (!s) return "_";

  // Date: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) return "D";
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)) return "D";

  // Numeric (including Chilean format with . or , as thousands)
  if (/^-?[\d.,]+$/.test(s) && /\d/.test(s)) return "N";

  // Long text
  if (s.length > 20) return "T";

  // Short text
  return "t";
}
