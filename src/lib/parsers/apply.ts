import type { AdapterConfig, ParsedLine, PreExtractedMovimiento, Row } from "./types";

/**
 * Parse a Chilean-formatted number: "1.600.000", "80,000", "1.234,56" → integer.
 * Drops all non-digit characters, returning a plain integer of the major units.
 * Saldo/monto columns in Chilean bank statements are always integers (CLP).
 */
export function parseChileanNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // If the last 3 chars are ,dd or .dd treat as decimal and drop
  const normalized = s.replace(/[^\d-]/g, "");
  if (!normalized) return 0;
  const n = parseInt(normalized, 10);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeDate(
  v: unknown,
  format: AdapterConfig["date_format"]
): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";

  if (format === "dd/mm/yyyy" || format === "dd-mm-yyyy" || format === "unknown") {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  if (format === "yyyy-mm-dd") {
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  // Last resort: try the generic form
  const generic = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (generic) return `${generic[3]}-${generic[2].padStart(2, "0")}-${generic[1].padStart(2, "0")}`;

  return s;
}

/**
 * Classify a tipo_flujo string value from a "single_col" layout's tipo flag.
 * Returns "SALIDA" for cargo/débito/egreso variants, "ENTRADA" for abono/
 * crédito/ingreso variants. Returns null if unrecognized.
 */
function classifyTipoFlag(v: unknown): ParsedLine["tipo"] | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (/^(cargo|d[eé]bito|debito|egreso|salida|giro|cheque)/.test(s)) return "SALIDA";
  if (/^(abono|cr[eé]dito|credito|ingreso|entrada|dep[oó]sito|deposito)/.test(s)) return "ENTRADA";
  return null;
}

/**
 * Apply an adapter config to raw rows → list of parsed transaction lines.
 * Supports two layouts:
 *  - two_cols: separate cargo and abono columns (mutually exclusive)
 *  - single_col: one monto column + one tipo_flujo_col with "Abono"/"Cargo"
 *
 * Skips:
 *  - Rows before skip_rows_before_data
 *  - Rows where the fecha column doesn't contain a date
 *  - Rows without a valid amount / ambiguous type
 */
export function applyAdapter(rows: Row[], cfg: AdapterConfig): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const { columns: c } = cfg;
  const layout = cfg.layout ?? "two_cols";
  const start = cfg.skip_rows_before_data;

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const fechaRaw = r[c.fecha];
    if (!fechaRaw) continue;
    const fechaStr = String(fechaRaw).trim();
    if (!fechaStr.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/))
      continue;

    let tipo: ParsedLine["tipo"];
    let monto: number;

    if (layout === "single_col") {
      const montoCol = c.monto ?? -1;
      const tipoCol = c.tipo_flujo_col ?? -1;
      if (montoCol < 0 || tipoCol < 0) continue;
      const amount = parseChileanNumber(r[montoCol]);
      if (!amount) continue;
      const t = classifyTipoFlag(r[tipoCol]);
      if (!t) continue;
      tipo = t;
      monto = amount;
    } else if (layout === "transactions_log") {
      // 1 monto column, no tipo flag → use default_tipo_flujo (defaults to entrada)
      const montoCol = c.monto ?? -1;
      if (montoCol < 0) continue;
      const amount = parseChileanNumber(r[montoCol]);
      if (!amount) continue;
      tipo = (cfg.default_tipo_flujo ?? "entrada") === "salida" ? "SALIDA" : "ENTRADA";
      monto = amount;
    } else {
      const cargo = parseChileanNumber(r[c.cargo]);
      const abono = parseChileanNumber(r[c.abono]);
      // Both zero → metadata, summary, or blank line
      if (!cargo && !abono) continue;
      // Both non-zero → ambiguous, skip
      if (cargo && abono) continue;
      tipo = cargo ? "SALIDA" : "ENTRADA";
      monto = cargo || abono;
    }

    const fecha = normalizeDate(fechaRaw, cfg.date_format);
    const descripcion = String(r[c.descripcion] ?? "").trim();
    const n_documento =
      c.n_documento >= 0 ? String(r[c.n_documento] ?? "").trim() : "";

    lines.push({ tipo, fecha, monto, descripcion, n_documento });
  }

  return lines;
}

/**
 * Convert ParsedLine[] to the AI layer's MovimientoExtraido-compatible shape
 * used by the bypass path. This is what we hand to Mistral when we skip
 * extraction and only ask for classification.
 */
export function linesToPreExtracted(lines: ParsedLine[]): PreExtractedMovimiento[] {
  return lines.map((l) => ({
    fecha: l.fecha,
    descripcion: l.descripcion,
    monto: l.monto,
    tipo_flujo: l.tipo === "ENTRADA" ? "entrada" : "salida",
    origen: "cartola_preparseada",
    n_documento: l.n_documento || null,
  }));
}

/**
 * Serialize parsed lines into the text format that the processor & Mistral
 * receive. Self-describing: each line already carries its TIPO so Mistral
 * cannot invert entrada/salida.
 */
export function serializeLines(lines: ParsedLine[], sheetName: string): string {
  const header =
    `--- Hoja: ${sheetName} (cartola pre-parseada) ---\n` +
    `# Formato: TIPO|FECHA|MONTO|DESCRIPCION|NDOC. TIPO viene pre-clasificado (ENTRADA/SALIDA) — NO invertir.`;
  const body = lines
    .map(
      (l) =>
        `${l.tipo}|${l.fecha}|${l.monto}|${l.descripcion}|${l.n_documento}`
    )
    .join("\n");
  return `${header}\n${body}`;
}
