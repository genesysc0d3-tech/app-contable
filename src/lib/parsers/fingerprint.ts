import { createHash } from "crypto";
import type { Row } from "./types";
import { findTransactionBlockStart } from "./heuristic";

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
  // Huella por ENCABEZADO (2026-09-26): la versión por "tipo de celda" de las
  // primeras 20 filas incluía FILAS DE DATOS — una glosa de 21 caracteres ("T")
  // vs una de 20 ("t") cambiaba la huella, igual que el titular o el período en
  // los metadatos de arriba. En prod: 53 adaptadores para 42 huellas, 34 usados
  // UNA sola vez → cada cartola re-adivinaba su formato (y a veces mal: BCI
  // Detallado de LC). Los títulos de las columnas SON el formato del banco; no
  // son datos de transacciones.
  const encabezado = encabezadoNormalizado(rows);
  if (encabezado) {
    return createHash("sha256").update(`H1:${encabezado.join("|")}`).digest("hex").slice(0, 16);
  }
  return computeFingerprintLegacy(rows);
}

/**
 * Fila de títulos normalizada (minúsculas, sin tildes, espacios colapsados, sin
 * vacías al final) = la fila justo antes del primer bloque de movimientos. null
 * si no hay una fila de títulos reconocible (entonces manda la huella legacy).
 */
export function encabezadoNormalizado(rows: Row[]): string[] | null {
  const tx = findTransactionBlockStart(rows);
  if (tx <= 0) return null;
  const fila = rows[tx - 1] ?? [];
  const celdas = fila.map((c) =>
    (c as unknown) instanceof Date || typeof c === "number"
      ? "#"
      : String(c ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim(),
  );
  while (celdas.length && !celdas[celdas.length - 1]) celdas.pop();
  const textos = celdas.filter((c) => c && c !== "#" && !/^[\d.,\-/: ]+$/.test(c));
  if (textos.length < 2 || textos.length < celdas.filter(Boolean).length) return null;
  return celdas;
}

/**
 * Huella estructural original (tipo de celda de las primeras 20 filas). Se
 * conserva para archivos sin fila de títulos y para encontrar los adaptadores
 * MANUALES guardados antes del cambio de huella.
 */
export function computeFingerprintLegacy(rows: Row[]): string {
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
