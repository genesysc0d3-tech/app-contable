import type { AdapterConfig, ParsedLine, PreExtractedMovimiento, Row } from "./types";

/**
 * Parse a Chilean-formatted number: "1.600.000", "80,000", "1.234,56" → integer.
 * Drops all non-digit characters, returning a plain integer of the major units.
 * Saldo/monto columns in Chilean bank statements are always integers (CLP).
 */
export function parseChileanNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  // Celdas numéricas (xlsx las entrega como number): redondear, NO stringificar —
  // si no, 53000.5 → "53000.5" → "530005" (×10). Los montos son CLP enteros.
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).trim();
  if (!s) return 0;
  const neg = s.startsWith("-");
  // Formato chileno: la COMA es el separador DECIMAL → se conserva solo la parte
  // entera. "53.000,00" = 53000, no 5.300.000 (antes daba ×100). El punto es
  // separador de MILES y se elimina abajo con el resto de los no-dígitos.
  const intPart = s.split(",")[0];
  const digits = intPart.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/**
 * Año para fechas que vienen SIN año ("02/09"): BancoEstado exporta así la hoja
 * "Movimientos" (el año solo está en la hoja "Resumen"). Se toma el año más
 * frecuente entre las fechas completas que haya en la hoja (p. ej. "FECHA DESDE /
 * HASTA" de la cabecera); si no hay ninguna, null → el caller usa el año actual.
 */
export function inferirAnioPista(rows: Row[]): number | null {
  const conteo = new Map<number, number>();
  const suma = (y: number) => { if (y >= 2000 && y <= 2100) conteo.set(y, (conteo.get(y) ?? 0) + 1); };
  for (const r of rows) {
    for (const cell of r ?? []) {
      if (cell == null) continue;
      const asDate = cell as unknown;
      if (asDate instanceof Date) { if (!Number.isNaN(asDate.getTime())) suma(asDate.getFullYear()); continue; }
      const t = String(cell).trim();
      let m = t.match(/^\d{1,2}[\/\-]\d{1,2}[\/\-](\d{4})/);
      if (m) { suma(parseInt(m[1], 10)); continue; }
      m = t.match(/^(\d{4})[\/\-]\d{1,2}[\/\-]\d{1,2}/);
      if (m) { suma(parseInt(m[1], 10)); continue; }
      m = t.match(/^(20\d{2})(\d{2})(\d{2})$/);
      if (m && parseInt(m[2], 10) >= 1 && parseInt(m[2], 10) <= 12 && parseInt(m[3], 10) >= 1 && parseInt(m[3], 10) <= 31) suma(parseInt(m[1], 10));
    }
  }
  let mejor: number | null = null; let n = 0;
  for (const [y, c] of conteo) if (c > n) { mejor = y; n = c; }
  return mejor;
}

export function normalizeDate(
  v: unknown,
  format: AdapterConfig["date_format"],
  anioPista?: number | null,
  ahora: Date = new Date(),
): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";

  // Incidente 2026-09-23 (2 cartolas BancoEstado cayeron a la IA y salieron
  // AFECTAS): "20260923" (yyyymmdd) y "02/09" (sin año). Formatos del banco,
  // no rarezas. Sin año: el de la pista (fechas completas de la hoja) o el
  // actual; si eso deja la fecha en el futuro (cartola de dic subida en ene),
  // es el año anterior.
  const m8 = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (m8) {
    const mm = parseInt(m8[2], 10); const dd = parseInt(m8[3], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${m8[1]}-${m8[2]}-${m8[3]}`;
  }
  const mSinAnio = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mSinAnio) {
    const dd = parseInt(mSinAnio[1], 10); const mm = parseInt(mSinAnio[2], 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let y = anioPista ?? ahora.getFullYear();
      if (anioPista == null) {
        const candidata = new Date(y, mm - 1, dd).getTime();
        if (candidata > ahora.getTime() + 7 * 86_400_000) y -= 1;
      }
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  if (format === "dd/mm/yyyy" || format === "dd-mm-yyyy" || format === "unknown") {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (m2) {
      const yy = parseInt(m2[3], 10);
      const fullYear = yy > 50 ? 1900 + yy : 2000 + yy;
      return `${fullYear}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
    }
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
  // Single-letter flags (Santander style: A=Abono, C=Cargo, D=Débito, H=Haber)
  if (s === "a" || s === "h") return "ENTRADA";
  if (s === "c" || s === "d") return "SALIDA";
  // Word flags
  if (/^(cargo|d[eé]bito|debito|egreso|salida|giro|cheque)/.test(s)) return "SALIDA";
  if (/^(abono|cr[eé]dito|credito|ingreso|entrada|dep[oó]sito|deposito|haber)/.test(s)) return "ENTRADA";
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
  const anioPista = inferirAnioPista(rows);

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const fechaRaw = r[c.fecha];
    if (!fechaRaw) continue;

    // Convert Date objects (from cellDates:true) to ISO string. El tipo Row
    // declara string|number, pero con cellDates el runtime trae Date reales.
    const fechaVal = fechaRaw as unknown as Date | string | number;
    const isDate = fechaVal instanceof Date;
    let fechaStr = isDate
      ? `${fechaVal.getFullYear()}-${String(fechaVal.getMonth() + 1).padStart(2, "0")}-${String(fechaVal.getDate()).padStart(2, "0")}`
      : String(fechaRaw).trim();

    // Fecha como número serial de Excel (algunos bancos exportan la celda como
    // número, no texto ni Date): 46245 = 2026-08-11. Rango acotado a 2000–2100
    // para no confundir montos con fechas.
    const serial = typeof fechaVal === "number" && Number.isFinite(fechaVal)
      ? Math.floor(fechaVal)
      : /^\d{5}$/.test(fechaStr) ? parseInt(fechaStr, 10) : NaN;
    const isSerial = !isDate && serial >= 36526 && serial <= 73050;
    if (isSerial) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      fechaStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }

    if (!isDate && !isSerial) {
      // Se acepta lo que normalizeDate sepa convertir a ISO (incluye yyyymmdd y
      // dd/mm sin año); lo demás no es un movimiento.
      const iso = normalizeDate(fechaStr, cfg.date_format, anioPista);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      fechaStr = iso;
    }

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

    const fecha = isDate || isSerial ? fechaStr : normalizeDate(fechaRaw, cfg.date_format);
    const descripcion = String(r[c.descripcion] ?? "").trim();
    const n_documento =
      c.n_documento >= 0 ? String(r[c.n_documento] ?? "").trim() : "";
    const saldo = c.saldo >= 0 ? parseChileanNumber(r[c.saldo]) : undefined;

    // Plantilla extendida: campos que el cliente clasificó fila a fila.
    const pc = cfg.plantilla_cols;
    const celda = (idx: number | undefined) => {
      if (idx === undefined || idx < 0) return null;
      const v = String(r[idx] ?? "").trim();
      return v || null;
    };
    lines.push({
      tipo,
      fecha,
      monto,
      descripcion,
      n_documento,
      excel_row: i + 1,
      saldo,
      ...(pc ? {
        plantilla_tipo: celda(pc.tipo),
        plantilla_receptor_rut: celda(pc.receptor_rut),
        plantilla_receptor_nombre: celda(pc.receptor_nombre),
        plantilla_medio_pago: celda(pc.medio_pago),
      } : {}),
    });
  }

  return lines;
}

/**
 * Convert ParsedLine[] to the AI layer's MovimientoExtraido-compatible shape
 * used by the bypass path. This is what we hand to OpenCode when we skip
 * extraction and only ask for classification.
 */
export function linesToPreExtracted(lines: ParsedLine[]): PreExtractedMovimiento[] {
  return lines.map((l) => ({
    fecha: l.fecha,
    descripcion: l.descripcion,
    // Campos de la plantilla extendida: solo viajan si la fila trae alguno
    // (mantiene el shape mínimo para cartolas normales y sus tests).
    ...(l.plantilla_tipo != null || l.plantilla_receptor_rut != null || l.plantilla_receptor_nombre != null || l.plantilla_medio_pago != null
      ? {
          plantilla_tipo: l.plantilla_tipo ?? null,
          plantilla_receptor_rut: l.plantilla_receptor_rut ?? null,
          plantilla_receptor_nombre: l.plantilla_receptor_nombre ?? null,
          plantilla_medio_pago: l.plantilla_medio_pago ?? null,
        }
      : {}),
    monto: l.monto,
    tipo_flujo: l.tipo === "ENTRADA" ? "entrada" : "salida",
    origen: "cartola_preparseada",
    n_documento: l.n_documento || null,
    excel_row: l.excel_row,
    saldo: l.saldo,
  }));
}

/**
 * Serialize parsed lines into the text format that the processor & OpenCode
 * receive. Self-describing: each line already carries its TIPO so OpenCode
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
