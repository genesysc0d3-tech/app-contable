import type { AdapterConfig, DescarteFila, ParsedLine, PreExtractedMovimiento, Row } from "./types";

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

/**
 * Rango de fechas COMPLETAS de la hoja (cabecera "FECHA DESDE / HASTA", filas
 * con año, Date de cellDates). Sirve para dar año a las fechas "dd/mm": una
 * cartola dic–ene tiene "20/12" (año anterior) y "05/01" (año siguiente) en la
 * misma hoja, y un único año pista corría una de las dos.
 */
export interface RangoFechas { min: string; max: string }
export function inferirRangoFechas(rows: Row[]): RangoFechas | null {
  let min: string | null = null; let max: string | null = null;
  const suma = (y: number, m: number, d: number) => {
    if (y < 2000 || y > 2100 || !esFechaCalendario(y, m, d)) return;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (min == null || iso < min) min = iso;
    if (max == null || iso > max) max = iso;
  };
  const n = (x: string) => parseInt(x, 10);
  for (const r of rows) {
    for (const cell of r ?? []) {
      if (cell == null) continue;
      const asDate = cell as unknown;
      if (asDate instanceof Date) {
        if (!Number.isNaN(asDate.getTime())) suma(asDate.getFullYear(), asDate.getMonth() + 1, asDate.getDate());
        continue;
      }
      const t = String(cell).trim();
      // Al inicio de la celda, o tras "desde/hasta" ("FECHA DESDE: 15/12/2025").
      const reDmy = /(?:^|\b(?:desde|hasta)\s*:?\s*)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/gi;
      let hit = false;
      for (const m of t.matchAll(reDmy)) { suma(n(m[3]), n(m[2]), n(m[1])); hit = true; }
      if (hit) continue;
      let m = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m) { suma(n(m[1]), n(m[2]), n(m[3])); continue; }
      m = t.match(/^(20\d{2})(\d{2})(\d{2})$/);
      if (m) suma(n(m[1]), n(m[2]), n(m[3]));
    }
  }
  return min != null && max != null ? { min, max } : null;
}

/**
 * Año para "dd/mm" según el rango de la hoja: entre (año min − 1) y (año max + 1)
 * gana el que deja la fecha dentro del rango o, si ninguno, más cerca de él.
 * Empate → el año menor (el pasado es más creíble que el futuro).
 */
function anioSegunRango(mm: number, dd: number, rango: RangoFechas): number | null {
  const [y0, m0, d0] = rango.min.split("-").map(Number);
  const [y1, m1, d1] = rango.max.split("-").map(Number);
  const lo = Date.UTC(y0, m0 - 1, d0); const hi = Date.UTC(y1, m1 - 1, d1);
  let mejor: number | null = null; let mejorDist = Infinity;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    if (!esFechaCalendario(y, mm, dd)) continue;
    const f = Date.UTC(y, mm - 1, dd);
    const dist = f < lo ? lo - f : f > hi ? f - hi : 0;
    if (dist < mejorDist) { mejor = y; mejorDist = dist; }
  }
  return mejor;
}

/**
 * ¿Día/mes/año forman una fecha REAL del calendario? Sin rollover: 31/02,
 * 29/02 en año no bisiesto, mes 13 o día 0/32 NO son fechas (JS Date las
 * "arregla" corriéndolas al mes siguiente, que es justo lo que no queremos).
 */
export function esFechaCalendario(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const bisiesto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const diasMes = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= diasMes;
}

/** Ventana de años creíble para un movimiento de cartola: 2000..año actual+1. */
export const ANIO_MIN_CARTOLA = 2000;
export function anioCartolaCreible(y: number, ahora: Date = new Date()): boolean {
  return y >= ANIO_MIN_CARTOLA && y <= ahora.getFullYear() + 1;
}

export type FechaCartola =
  | { ok: true; iso: string }
  | { ok: false; motivo: "fecha_ilegible" | "fecha_imposible" };

function isoSiReal(y: number, m: number, d: number): FechaCartola {
  if (!esFechaCalendario(y, m, d)) return { ok: false, motivo: "fecha_imposible" };
  return { ok: true, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/**
 * Convierte la fecha de una celda a ISO distinguiendo "no es una fecha"
 * (fecha_ilegible) de "tiene forma de fecha pero no existe" (fecha_imposible:
 * "32/13/2026", "31/02/2026"). Nunca inventa una fecha corriéndola.
 */
export function parseFechaCartola(
  v: unknown,
  format: AdapterConfig["date_format"],
  anioPista?: number | null,
  ahora: Date = new Date(),
  rango?: RangoFechas | null,
): FechaCartola {
  if (v == null) return { ok: false, motivo: "fecha_ilegible" };
  const s = String(v).trim();
  if (!s) return { ok: false, motivo: "fecha_ilegible" };

  // Incidente 2026-09-23 (2 cartolas BancoEstado cayeron a la IA y salieron
  // AFECTAS): "20260923" (yyyymmdd) y "02/09" (sin año). Formatos del banco,
  // no rarezas. Sin año: el de la pista (fechas completas de la hoja) o el
  // actual; si eso deja la fecha en el futuro (cartola de dic subida en ene),
  // es el año anterior.
  const m8 = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (m8) {
    const r = isoSiReal(parseInt(m8[1], 10), parseInt(m8[2], 10), parseInt(m8[3], 10));
    // 8 dígitos que no son fecha real pueden ser un N° de documento → ilegible.
    return r.ok ? r : { ok: false, motivo: "fecha_ilegible" };
  }
  const mSinAnio = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mSinAnio) {
    const dd = parseInt(mSinAnio[1], 10); const mm = parseInt(mSinAnio[2], 10);
    if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return { ok: false, motivo: "fecha_imposible" };
    if (rango) {
      const yr = anioSegunRango(mm, dd, rango);
      return yr == null ? { ok: false, motivo: "fecha_imposible" } : isoSiReal(yr, mm, dd);
    }
    let y = anioPista ?? ahora.getFullYear();
    if (anioPista == null) {
      const candidata = new Date(y, mm - 1, dd).getTime();
      if (candidata > ahora.getTime() + 7 * 86_400_000) y -= 1;
    }
    return isoSiReal(y, mm, dd);
  }

  if (format === "dd/mm/yyyy" || format === "dd-mm-yyyy" || format === "unknown") {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return isoSiReal(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (m2) {
      const yy = parseInt(m2[3], 10);
      const fullYear = yy > 50 ? 1900 + yy : 2000 + yy;
      return isoSiReal(fullYear, parseInt(m2[2], 10), parseInt(m2[1], 10));
    }
  }

  if (format === "yyyy-mm-dd") {
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m) return isoSiReal(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }

  // Last resort: try the generic form
  const generic = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (generic) return isoSiReal(parseInt(generic[3], 10), parseInt(generic[2], 10), parseInt(generic[1], 10));

  return { ok: false, motivo: "fecha_ilegible" };
}

/**
 * Fecha → ISO yyyy-mm-dd. Si no se puede leer devuelve el string tal cual (no
 * inventa fecha); si tiene forma de fecha pero no existe ("32/13/2026") devuelve
 * "" — jamás una ISO con día/mes imposible.
 */
export function normalizeDate(
  v: unknown,
  format: AdapterConfig["date_format"],
  anioPista?: number | null,
  ahora: Date = new Date(),
): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const r = parseFechaCartola(s, format, anioPista, ahora);
  if (r.ok) return r.iso;
  return r.motivo === "fecha_imposible" ? "" : s;
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

const RESUMEN_RE = /\b(sub\s*total|total(es)?|saldo\s+(inicial|final|anterior|disponible|contable)|resumen)\b/i;

/** Fila de totales/saldos: tiene plata pero no es una transacción. */
function esFilaResumen(r: Row): boolean {
  return r.some((v) => typeof v === "string" && RESUMEN_RE.test(v));
}

/** Plata de la fila según las columnas del mapeo (0 si no trae monto). */
function montoEnFila(r: Row, cfg: AdapterConfig): { monto: number; tipo: DescarteFila["tipo_flujo"] } {
  const c = cfg.columns;
  const layout = cfg.layout ?? "two_cols";
  if (layout === "single_col" || layout === "transactions_log") {
    const m = c.monto != null && c.monto >= 0 ? Math.abs(parseChileanNumber(r[c.monto])) : 0;
    const tipo = layout === "transactions_log"
      ? ((cfg.default_tipo_flujo ?? "entrada") === "salida" ? "salida" : "entrada")
      : null;
    return { monto: m, tipo };
  }
  const cargo = Math.abs(parseChileanNumber(r[c.cargo]));
  const abono = Math.abs(parseChileanNumber(r[c.abono]));
  if (cargo && !abono) return { monto: cargo, tipo: "salida" };
  if (abono && !cargo) return { monto: abono, tipo: "entrada" };
  return { monto: cargo + abono, tipo: null };
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
export function applyAdapter(rows: Row[], cfg: AdapterConfig, descartes?: DescarteFila[]): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const { columns: c } = cfg;
  const layout = cfg.layout ?? "two_cols";
  const start = cfg.skip_rows_before_data;
  // "dd/mm" sin año: con fechas completas en la hoja, el año sale del rango
  // DESDE–HASTA (cruce dic–ene); sin ninguna, año actual con tope de 7 días
  // al futuro. (El año pista único corría una de las dos puntas del cruce.)
  const rango = inferirRangoFechas(rows);
  // Pasada una fila "Resumen/Total/Saldo", lo que sigue es el bloque de
  // resumen del banco (BICE: "RESUMEN DEL PERIODO", "TOTAL ABONOS", "SALDO FINAL").
  let bloqueResumen = false;

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    if (esFilaResumen(r)) bloqueResumen = true;

    // Censo: una fila con plata que no termina en movimiento se anota con su
    // motivo. Antes cada `continue` de abajo la botaba en silencio (incidente
    // LC 2026-09-27: filas perdidas sin que nadie se enterara).
    const plata = montoEnFila(r, cfg);
    const descartar = (motivo: DescarteFila["motivo"], fecha: string | null, tipo: DescarteFila["tipo_flujo"]) => {
      if (!descartes || !plata.monto) return;
      const resumen = bloqueResumen || esFilaResumen(r);
      descartes.push({
        excel_row: i + 1,
        motivo: resumen ? "resumen" : motivo,
        legitimo: resumen,
        fecha,
        monto: plata.monto,
        tipo_flujo: tipo ?? plata.tipo,
        descripcion: String(r[c.descripcion] ?? "").trim(),
      });
    };

    const fechaRaw = r[c.fecha];
    if (!fechaRaw) { descartar("sin_fecha", null, null); continue; }

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

    if (isDate && Number.isNaN((fechaVal as Date).getTime())) { descartar("fecha_ilegible", null, null); continue; }
    if (!isDate && !isSerial) {
      // Se acepta lo que parseFechaCartola sepa convertir a una fecha REAL
      // (incluye yyyymmdd y dd/mm sin año). "32/13/2026" o "31/02/2026" no se
      // corren al mes siguiente: van al censo como fecha_imposible, y el cuadre
      // las muestra como perdidas en vez de meter un movimiento con fecha falsa.
      const f = parseFechaCartola(fechaStr, cfg.date_format, null, new Date(), rango);
      if (!f.ok) { descartar(f.motivo, null, null); continue; }
      fechaStr = f.iso;
    }
    // Año fuera de 2000..actual+1 (p. ej. "14/06/99" → 1999, o un Date/serial
    // de 2091): tampoco es un movimiento creíble de esta cartola.
    if (!anioCartolaCreible(parseInt(fechaStr.slice(0, 4), 10))) {
      descartar("fecha_fuera_de_rango", fechaStr, null); continue;
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
      if (!t) { descartar("tipo_desconocido", fechaStr, null); continue; }
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
      if (cargo && abono) { descartar("cargo_y_abono", fechaStr, null); continue; }
      tipo = cargo ? "SALIDA" : "ENTRADA";
      monto = cargo || abono;
    }

    const fecha = fechaStr;
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
    const celdaMonto = layout === "two_cols" ? (tipo === "SALIDA" ? r[c.cargo] : r[c.abono]) : r[c.monto ?? -1];
    lines.push({
      tipo,
      fecha,
      monto,
      ...(typeof celdaMonto === "string" ? { monto_texto: true } : {}),
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

  if (descartes) marcarFilasDeTotales(lines, descartes);
  return lines;
}

/**
 * Una fila sin fecha cuyo monto es la suma de los abonos, de los cargos o de
 * todo lo leído es la fila de totales del banco (BancoEstado, BICE: sin texto,
 * solo el número). No es una transacción → descarte legítimo.
 */
function marcarFilasDeTotales(lines: ParsedLine[], descartes: DescarteFila[]): void {
  // Dos formas de sumar: la nuestra (todo lo leído) y la del Excel del banco,
  // cuya fórmula SUMA ignora los montos escritos como texto (BancoEstado: un
  // abono "$100" en texto → el total del banco quedaba $100 abajo).
  const suma = (tipo: ParsedLine["tipo"] | null, soloNumeros: boolean) =>
    lines
      .filter((l) => (tipo == null || l.tipo === tipo) && !(soloNumeros && l.monto_texto))
      .reduce((s, l) => s + l.monto, 0);
  const sumas = [false, true]
    .flatMap((soloNumeros) => [suma("ENTRADA", soloNumeros), suma("SALIDA", soloNumeros), suma(null, soloNumeros)])
    .filter((x) => x > 0);
  for (const d of descartes) {
    if (d.legitimo || d.motivo !== "sin_fecha") continue;
    if (sumas.some((s) => Math.abs(s - d.monto) <= 1)) {
      d.legitimo = true;
      d.motivo = "resumen";
    }
  }
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
