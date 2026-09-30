import type { AdapterConfig, DescarteFila, ParsedLine, PreExtractedMovimiento, Row } from "./types";
import { LectorMontos, leerCeldaMonto, lecturaLaxa, valorCeldaSuelta } from "./numeros";
import { cellEsFecha, esColumnaCorrelativa, esColumnaDeCodigos, fechaConMesEnTexto } from "./celdas";

/**
 * Monto de UNA celda, sin contexto de columna: "1.600.000", "250,000",
 * "1.234,56", "$ -418.370", "(5.000)" → entero CLP (fracción truncada).
 *
 * Si la celda admite una sola lectura (ver numeros.ts) se usa esa: "250,000" es
 * 250000 (antes 250: se cortaba en la primera coma, hallazgo 0.1-2 de
 * docs/investigacion-lector-cartolas-2026-09-30.md) y el signo después del "$"
 * ya no se pierde. Para leer una COLUMNA de una cartola usar LectorMontos, que
 * decide el formato mirando todas sus celdas y no adivina si la columna mezcla.
 */
export function parseChileanNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  // Celdas numéricas (xlsx las entrega como number): redondear, NO stringificar —
  // si no, 53000.5 → "53000.5" → "530005" (×10). Los montos son CLP enteros.
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  const l = leerCeldaMonto(v);
  if (l) return valorCeldaSuelta(l);
  return lecturaLaxa(v);
}

/** Fecha COMPLETA de una celda (dd/mm/yyyy o yyyy-mm-dd al inicio, yyyymmdd, Date). */
function fechaCompletaDeCelda(cell: unknown): string | null {
  if (cell == null) return null;
  let y: number; let m: number; let d: number;
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    y = cell.getFullYear(); m = cell.getMonth() + 1; d = cell.getDate();
  } else {
    const t = String(cell).trim();
    let x = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (x) { d = +x[1]; m = +x[2]; y = +x[3]; } else {
      x = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/) ?? t.match(/^(20\d{2})(\d{2})(\d{2})$/);
      if (!x) return null;
      y = +x[1]; m = +x[2]; d = +x[3];
    }
  }
  if (y < 2000 || y > 2100 || !esFechaCalendario(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Rango de fechas del período de la cartola, para dar año a las fechas "dd/mm"
 * (una cartola dic–ene tiene "20/12" y "05/01" en la misma hoja).
 *
 * SOLO dos fuentes (revisión adversarial: una fecha de impresión o una glosa
 * "01/03/2019 cuota" no pueden decidir el año):
 *   1. Etiquetas DESDE/HASTA explícitas ("FECHA DESDE: 15/12/2025", o la etiqueta
 *      y la fecha en la celda de al lado / de abajo). Si hay, mandan (explicito).
 *   2. Si no, fechas completas de la COLUMNA fecha, desde la primera fila de datos.
 */
export interface RangoFechas { min: string; max: string; explicito: boolean }
export function inferirRangoFechas(rows: Row[], cfg: Pick<AdapterConfig, "columns" | "skip_rows_before_data">): RangoFechas | null {
  const rangoDe = (isos: string[], explicito: boolean): RangoFechas | null => {
    if (isos.length === 0) return null;
    const orden = [...isos].sort();
    return { min: orden[0], max: orden[orden.length - 1], explicito };
  };

  const explicitas: string[] = [];
  const reEnCelda = /\b(?:desde|hasta)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/gi;
  const reEtiqueta = /\b(?:desde|hasta)\s*:?\s*$/i;
  rows.forEach((r, i) => {
    (r ?? []).forEach((cell, j) => {
      if (typeof cell !== "string") return;
      let hit = false;
      for (const m of cell.matchAll(reEnCelda)) {
        const iso = fechaCompletaDeCelda(`${m[1]}/${m[2]}/${m[3]}`);
        if (iso) { explicitas.push(iso); hit = true; }
      }
      if (hit || !reEtiqueta.test(cell.trim())) return;
      for (const vecina of [r[j + 1], rows[i + 1]?.[j]]) {
        const iso = fechaCompletaDeCelda(vecina);
        if (iso) { explicitas.push(iso); break; }
      }
    });
  });
  if (explicitas.length) return rangoDe(explicitas, true);

  const col = cfg.columns.fecha;
  const deColumna: string[] = [];
  if (col >= 0) {
    for (let i = cfg.skip_rows_before_data; i < rows.length; i++) {
      const iso = fechaCompletaDeCelda(rows[i]?.[col]);
      if (iso) deColumna.push(iso);
    }
  }
  return rangoDe(deColumna, false);
}

const SIETE_DIAS_MS = 7 * 86_400_000;

/**
 * Año para "dd/mm" según el rango: entre (año min − 1) y (año max + 1), sin
 * candidatos a más de 7 días en el futuro, gana el que deja la fecha dentro del
 * rango o más cerca de él. Empate (rango de más de un año) → el más reciente.
 */
function anioSegunRango(mm: number, dd: number, rango: RangoFechas, tope: number): number | null {
  const [y0, m0, d0] = rango.min.split("-").map(Number);
  const [y1, m1, d1] = rango.max.split("-").map(Number);
  const lo = Date.UTC(y0, m0 - 1, d0); const hi = Date.UTC(y1, m1 - 1, d1);
  let mejor: number | null = null; let mejorDist = Infinity;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    // Sin filtrar por calendario: "29/02" en una cartola de 2025 debe salir
    // fecha_imposible (isoSiReal del caller), no saltar a 2024.
    if (new Date(y, mm - 1, dd).getTime() > tope) continue;
    const f = Date.UTC(y, mm - 1, dd);
    const dist = f < lo ? lo - f : f > hi ? f - hi : 0;
    if (dist <= mejorDist) { mejor = y; mejorDist = dist; }
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
  opts: { rango?: RangoFechas | null; ahora?: Date } = {},
): FechaCartola {
  if (v == null) return { ok: false, motivo: "fecha_ilegible" };
  const s = String(v).trim();
  if (!s) return { ok: false, motivo: "fecha_ilegible" };

  // Incidente 2026-09-23 (2 cartolas BancoEstado cayeron a la IA y salieron
  // AFECTAS): "20260923" (yyyymmdd) y "02/09" (sin año). Formatos del banco,
  // no rarezas. Sin año: el del rango del período (ver inferirRangoFechas) o,
  // sin rango confiable, el actual; nunca más de 7 días en el futuro (cartola
  // de dic subida en ene → año anterior).
  const conMes = fechaConMesEnTexto(s);
  if (conMes) return isoSiReal(conMes.y, conMes.m, conMes.d);

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
    const ahora = opts.ahora ?? new Date();
    const tope = ahora.getTime() + SIETE_DIAS_MS;
    const rango = opts.rango;
    // Un rango de UN solo punto que no viene de DESDE/HASTA (una fecha suelta
    // en la columna) no dice nada del período → regla del año actual.
    if (rango && (rango.explicito || rango.min !== rango.max)) {
      const yr = anioSegunRango(mm, dd, rango, tope);
      if (yr != null) return isoSiReal(yr, mm, dd);
    }
    let y = ahora.getFullYear();
    if (new Date(y, mm - 1, dd).getTime() > tope) y -= 1;
    return isoSiReal(y, mm, dd);
  }

  // mm/dd/yyyy SOLO si la columna lo probó (heuristic.formatoFechaDeColumna): en
  // Chile el día va primero (adversarial-1 falla 5: "05/09" era 9 de mayo).
  if (format === "mm/dd/yyyy") {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return isoSiReal(parseInt(m[3], 10), parseInt(m[1], 10), parseInt(m[2], 10));
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
 * Classify a tipo_flujo string value from a "single_col" layout's tipo flag.
 * Returns "SALIDA" for cargo/débito/egreso variants, "ENTRADA" for abono/
 * crédito/ingreso variants. Returns null if unrecognized.
 */
export function classifyTipoFlag(v: unknown): ParsedLine["tipo"] | null {
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

/** La celda de fecha tal como vino, para diagnosticar un descarte. */
function celdaCruda(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  return String(v).trim() || null;
}

export const RESUMEN_RE = /\b(sub\s*total|total(es)?|saldo\s+(inicial|final|anterior|disponible|contable)|resumen)\b/i;
/**
 * Frases que NINGUNA glosa de movimiento real usa ("SALDO INICIAL", "RESUMEN
 * DEL PERIODO"): marcan una fila de saldos aunque traiga fecha. "TOTAL" no está
 * acá: "PAGO TOTAL TARJETA" es un movimiento.
 */
const SALDO_O_RESUMEN_RE = /\bsaldo\s+(inicial|final|anterior|disponible|contable)\b|\bresumen\b/i;
/**
 * Glosa que ES una fila de saldo (EMPIEZA con "SALDO INICIAL/ANTERIOR/FINAL…" o
 * "RESUMEN"). "TRASPASO SALDO DISPONIBLE LINEA CREDITO" no: es un movimiento.
 */
const FILA_DE_SALDO_RE = /^\s*(s(al)?do\.?\s+(inicial|ini|final|fin|anterior|ant|disponible|disp|contable|cont)\b|resumen\b)/i;

/** Plata de la fila según las columnas del mapeo (0 si no trae monto). */
function montoEnFila(
  r: Row,
  cfg: AdapterConfig,
  lector: LectorMontos,
): { monto: number; tipo: DescarteFila["tipo_flujo"]; ambiguo: boolean } {
  const c = cfg.columns;
  const layout = cfg.layout ?? "two_cols";
  if (layout === "single_col" || layout === "transactions_log" || layout === "monto_con_signo") {
    const m = lector.leer(r, c.monto);
    const tipo = layout === "transactions_log"
      ? ((cfg.default_tipo_flujo ?? "entrada") === "salida" ? "salida" : "entrada")
      : layout === "monto_con_signo" && !m.ambiguo && m.valor !== 0
        ? (m.valor < 0 ? "salida" : "entrada")
        : null;
    return { monto: m.ambiguo ? (m.referencia ?? 0) : Math.abs(m.valor), tipo, ambiguo: m.ambiguo };
  }
  const cm = lector.leer(r, c.cargo);
  const am = lector.leer(r, c.abono);
  const cargo = cm.ambiguo ? (cm.referencia ?? 0) : Math.abs(cm.valor);
  const abono = am.ambiguo ? (am.referencia ?? 0) : Math.abs(am.valor);
  const ambiguo = cm.ambiguo || am.ambiguo;
  if (cargo && !abono) return { monto: cargo, tipo: "salida", ambiguo };
  if (abono && !cargo) return { monto: abono, tipo: "entrada", ambiguo };
  return { monto: cargo + abono, tipo: null, ambiguo };
}

/** ¿Después de esta fila (saltando más continuaciones de texto) viene un movimiento con fecha? */
function vuelveUnMovimiento(rows: Row[], i: number, colFecha: number, colsPlata: Set<number>): boolean {
  for (let k = i + 1; k < Math.min(rows.length, i + 5); k++) {
    const r = rows[k];
    if (!r || r.every((v) => v == null || String(v).trim() === "")) return false;
    if (cellEsFecha(r[colFecha] as never)) return true;
    const soloTexto = r.every((v, j) => !colsPlata.has(j) || v == null || String(v).trim() === "");
    if (!soloTexto) return false;
  }
  return false;
}

/** Lo leído del día en curso (para reconocer su subtotal). */
interface AcumDia { e: number; s: number; ne: number; ns: number; saldos: number[] }

/**
 * ¿La fila (con fecha) es un SUBTOTAL del día? Vuelta 2, N2: no puede botar
 * ventas reales. Exige que la fila NO tenga movimiento propio distinguible:
 *   (a) sus montos = suma exacta de las filas previas del día, ≥2 filas previas,
 *       el saldo no avanza respecto al último del día Y dentro del día el saldo
 *       SÍ se movía (un banco que repite el saldo de cierre en cada fila no
 *       permite distinguir: ahí se lee como movimiento); o
 *   (b) la GLOSA empieza con "total"/"subtotal" (no "PAGO TOTAL…", no otra
 *       columna), sus montos = suma del día y el saldo no avanza (o no hay).
 * Si no, se lee como movimiento (y la ecuación del saldo lo delata si sobra).
 */
function esSubtotalPorEstructura(
  cargo: number,
  abono: number,
  dia: AcumDia | null,
  saldoFila: number | null,
  ultimoSaldo: number | null,
  glosaDeTotal: boolean,
): boolean {
  if (!dia || dia.ne + dia.ns === 0) return false;
  const calza = (x: number, suma: number, n: number) => x === 0 || (n >= 1 && Math.abs(x - suma) <= 1);
  if (!calza(cargo, dia.s, dia.ns) || !calza(abono, dia.e, dia.ne)) return false;
  const saldoQuieto = saldoFila != null && ultimoSaldo != null && Math.abs(saldoFila - ultimoSaldo) <= 1;
  const saldoSeMovia = new Set(dia.saldos).size > 1;
  if (dia.ne + dia.ns >= 2 && saldoQuieto && saldoSeMovia) return true;
  return glosaDeTotal && (saldoFila == null || saldoQuieto);
}

type LecturaFecha =
  | { ok: true; iso: string }
  | { ok: false; motivo: "sin_fecha" | "fecha_ilegible" | "fecha_imposible" | "fecha_fuera_de_rango"; iso: string | null };

/** Fecha de la celda de la columna fecha, con el motivo exacto si no sirve. */
function leerFechaFila(
  fechaRaw: unknown,
  cfg: AdapterConfig,
  rango: RangoFechas | null,
  ahora: Date,
): LecturaFecha {
  if (!fechaRaw) return { ok: false, motivo: "sin_fecha", iso: null };
  // Convert Date objects (from cellDates:true) to ISO string. El tipo Row
  // declara string|number, pero con cellDates el runtime trae Date reales.
  const fechaVal = fechaRaw as Date | string | number;
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

  if (isDate && Number.isNaN((fechaVal as Date).getTime())) return { ok: false, motivo: "fecha_ilegible", iso: null };
  if (!isDate && !isSerial) {
    // Se acepta lo que parseFechaCartola sepa convertir a una fecha REAL
    // (incluye yyyymmdd y dd/mm sin año). "32/13/2026" o "31/02/2026" no se
    // corren al mes siguiente: van al censo como fecha_imposible, y el cuadre
    // las muestra como perdidas en vez de meter un movimiento con fecha falsa.
    const f = parseFechaCartola(fechaStr, cfg.date_format, { rango, ahora });
    if (!f.ok) return { ok: false, motivo: f.motivo, iso: null };
    fechaStr = f.iso;
  }
  // Año fuera de 2000..actual+1 (p. ej. "14/06/99" → 1999, o un Date/serial
  // de 2091): tampoco es un movimiento creíble de esta cartola.
  if (!anioCartolaCreible(parseInt(fechaStr.slice(0, 4), 10), ahora)) {
    return { ok: false, motivo: "fecha_fuera_de_rango", iso: fechaStr };
  }
  return { ok: true, iso: fechaStr };
}

export interface OpcionesApply {
  /**
   * Filas (índice 0-based) con una fórmula SUMA del banco en una columna de
   * plata: son de totales POR DEFINICIÓN (juez-banco.ts), no por una palabra.
   */
  filasFormula?: Set<number>;
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
export function applyAdapter(
  rows: Row[],
  cfg: AdapterConfig,
  descartes?: DescarteFila[],
  ahora: Date = new Date(),
  opts: OpcionesApply = {},
): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const { columns: c } = cfg;
  const layout = cfg.layout ?? "two_cols";
  const start = cfg.skip_rows_before_data;
  // "dd/mm" sin año: el año sale del rango del período (DESDE/HASTA o la
  // columna fecha; cruce dic–ene), nunca más de 7 días al futuro.
  const rango = inferirRangoFechas(rows, cfg);
  // Formato de número decidido POR COLUMNA con todas sus celdas (numeros.ts).
  const lector = new LectorMontos(rows as unknown[][], start, cfg.number_format === "generic" ? "generic" : "chilean");
  // Bloque de resumen del banco (BICE: "RESUMEN DEL PERIODO", "TOTAL ABONOS",
  // "SALDO FINAL"). Se decide por ESTRUCTURA (punto 2, 2026-09-30): se abre con
  // una fila SIN fecha válida que dice total/resumen/saldo (o que trae la
  // fórmula SUMA del banco) y se CIERRA en cuanto vuelve una fila con fecha. Una
  // glosa "PAGO TOTAL TARJETA" con fecha es un movimiento: antes prendía el
  // bloque para todo lo que seguía y las pérdidas de abajo salían "legítimas".
  let bloqueResumen = false;
  const filasResumen = new Set<number>();
  // Subtotales CON fecha ("Total del día", "Total general"): se reconocen por
  // ESTRUCTURA (adversarial-1 falla 8): sus montos son la suma de lo leído del
  // día (o de todo) y el saldo no se mueve. Nunca por la palabra.
  const vacio = (): AcumDia => ({ e: 0, s: 0, ne: 0, ns: 0, saldos: [] });
  let dia = { fecha: "", ...vacio() };
  let ultimoSaldo: number | null = null;
  // Glosa partida en 2 filas (adversarial-1 falla 3): la fila de continuación
  // (sin fecha ni plata, solo texto) se pega a la glosa del movimiento anterior.
  let filaAnterior = -2;
  const colsPlata = new Set<number>(
    [c.fecha, c.cargo, c.abono, c.saldo, c.monto ?? -1, c.tipo_flujo_col ?? -1].filter((x) => x != null && x >= 0),
  );

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const fecha = leerFechaFila(r[c.fecha], cfg, rango, ahora);
    const conFecha = fecha.ok || fecha.motivo === "fecha_fuera_de_rango";
    if (conFecha) bloqueResumen = false;
    // Censo: una fila con plata que no termina en movimiento se anota con su
    // motivo. Antes cada `continue` de abajo la botaba en silencio (incidente
    // LC 2026-09-27: filas perdidas sin que nadie se enterara).
    const plata = montoEnFila(r, cfg, lector);
    const glosa = typeof r[c.descripcion] === "string" ? String(r[c.descripcion]) : "";
    const palabraFueraDeGlosa = r.some((v, j) => j !== c.descripcion && typeof v === "string" && RESUMEN_RE.test(v));
    const palabraEnGlosa = RESUMEN_RE.test(glosa);
    // CON FECHA VÁLIDA una palabra nunca hace resumen (adversarial-2 C2: un pago
    // a "TOTAL CHILE SPA" o un "TRASPASO SALDO DISPONIBLE" son movimientos). Solo
    // la estructura: fórmula SUMA del banco, o una fila "SALDO INICIAL/FINAL" cuyo
    // monto ES su propio saldo (no una venta de $5.000.000).
    const glosaDeSaldo = FILA_DE_SALDO_RE.test(glosa);
    const saldoComoMonto = conFecha && glosaDeSaldo && plata.monto > 0 && c.saldo >= 0
      && Math.abs(lector.leer(r, c.saldo).valor) === plata.monto;
    // "SALDO INICIAL" con fecha y plata que NO es su propio saldo: ni venta ni
    // resumen callado — se deja afuera y a la vista (fila_de_saldo, no legítima).
    const saldoDudoso = conFecha && glosaDeSaldo && plata.monto > 0 && !saldoComoMonto;
    const filaResumen =
      opts.filasFormula?.has(i) === true ||
      saldoComoMonto ||
      (!conFecha && (palabraFueraDeGlosa || palabraEnGlosa));
    if (filaResumen) filasResumen.add(i);
    if (filaResumen && !conFecha) bloqueResumen = true;
    const resumen = filaResumen || (bloqueResumen && !conFecha);
    if (resumen) filasResumen.add(i);

    const descartar = (motivo: DescarteFila["motivo"], fechaIso: string | null, tipo: DescarteFila["tipo_flujo"], legitimo = resumen) => {
      if (!descartes || !plata.monto) return;
      descartes.push({
        excel_row: i + 1,
        motivo: legitimo ? "resumen" : motivo,
        legitimo,
        fecha: fechaIso,
        monto: plata.monto,
        tipo_flujo: tipo ?? plata.tipo,
        descripcion: String(r[c.descripcion] ?? "").trim(),
        fecha_cruda: celdaCruda(r[c.fecha]),
      });
    };

    if (!fecha.ok) {
      const previa = lines[lines.length - 1];
      const texto = glosa.trim();
      const esContinuacion = fecha.motivo === "sin_fecha" && !plata.monto && !plata.ambiguo && !resumen
        && previa && filaAnterior === i - 1 && /[a-záéíóúñ]/i.test(texto) && texto.length <= 120
        && r.every((v, j) => !colsPlata.has(j) || v == null || String(v).trim() === "")
        // Solo ENTRE movimientos (vuelta 2, N6): un pie de página tras el último
        // movimiento ("Este documento no constituye…") no se pega a su glosa.
        && vuelveUnMovimiento(rows, i, c.fecha, colsPlata);
      if (esContinuacion) {
        previa.descripcion = `${previa.descripcion} ${texto}`.trim();
        previa.filas_glosa_continuada = [...(previa.filas_glosa_continuada ?? []), i + 1];
        filaAnterior = i;
        continue;
      }
      descartar(fecha.motivo, fecha.iso, null);
      continue;
    }
    const fechaStr = fecha.iso;
    // Un monto que su columna no permite leer sin adivinar ("250,000" en una
    // columna de "1.234.567"): al censo, jamás un número inventado.
    if (plata.ambiguo) { descartar("monto_ambiguo", fechaStr, null); continue; }
    // Fila de totales con fecha (fórmula SUMA del banco, o saldo como monto):
    // no es un movimiento.
    if (resumen) { descartar("resumen", fechaStr, null); continue; }
    if (saldoDudoso) { descartar("fila_de_saldo", fechaStr, null); continue; }

    let tipo: ParsedLine["tipo"];
    let monto: number;

    if (layout === "single_col") {
      const montoCol = c.monto ?? -1;
      const tipoCol = c.tipo_flujo_col ?? -1;
      if (montoCol < 0 || tipoCol < 0) continue;
      const amount = Math.abs(lector.leer(r, montoCol).valor);
      if (!amount) continue;
      const t = classifyTipoFlag(r[tipoCol]);
      if (!t) { descartar("tipo_desconocido", fechaStr, null); continue; }
      tipo = t;
      monto = amount;
    } else if (layout === "monto_con_signo") {
      // El SIGNO dice la dirección: negativo = cargo (Falabella, vuelta 2 P5).
      const montoCol = c.monto ?? -1;
      if (montoCol < 0) continue;
      const v = lector.leer(r, montoCol).valor;
      if (!v) continue;
      tipo = v < 0 ? "SALIDA" : "ENTRADA";
      monto = Math.abs(v);
    } else if (layout === "transactions_log") {
      // 1 monto column, no tipo flag → use default_tipo_flujo (defaults to entrada)
      const montoCol = c.monto ?? -1;
      if (montoCol < 0) continue;
      const amount = lector.leer(r, montoCol).valor;
      if (!amount) continue;
      tipo = (cfg.default_tipo_flujo ?? "entrada") === "salida" ? "SALIDA" : "ENTRADA";
      monto = amount;
    } else {
      // La COLUMNA dice la dirección: un "-5.000" en la columna Cargos es un
      // cargo de 5.000 (varios bancos los imprimen con signo).
      const cargo = Math.abs(lector.leer(r, c.cargo).valor);
      const abono = Math.abs(lector.leer(r, c.abono).valor);
      // Both zero → metadata, summary, or blank line
      if (!cargo && !abono) continue;
      if (fechaStr !== dia.fecha) dia = { fecha: fechaStr, ...vacio() };
      const celdaSaldo = c.saldo >= 0 ? r[c.saldo] : null;
      const saldoFila = celdaSaldo != null && String(celdaSaldo).trim() !== "" ? lector.leer(r, c.saldo).valor : null;
      const glosaDeTotal = /^\s*(sub\s*)?total(es)?\b/i.test(glosa);
      if (esSubtotalPorEstructura(cargo, abono, dia, saldoFila, ultimoSaldo, glosaDeTotal)) {
        filasResumen.add(i);
        descartar("resumen", fechaStr, null, true);
        if (descartes?.length && descartes[descartes.length - 1].excel_row === i + 1) descartes[descartes.length - 1].subtotal = true;
        dia = { fecha: fechaStr, ...vacio() };
        continue;
      }
      // Both non-zero → ambiguous, skip
      if (cargo && abono) { descartar("cargo_y_abono", fechaStr, null); continue; }
      tipo = cargo ? "SALIDA" : "ENTRADA";
      monto = cargo || abono;
      if (tipo === "SALIDA") { dia.s += monto; dia.ns++; } else { dia.e += monto; dia.ne++; }
      if (saldoFila != null) { ultimoSaldo = saldoFila; dia.saldos.push(saldoFila); }
    }
    filaAnterior = i;

    const descripcion = String(r[c.descripcion] ?? "").trim();
    const n_documento =
      c.n_documento >= 0 ? String(r[c.n_documento] ?? "").trim() : "";
    const saldo = c.saldo >= 0 ? lector.leer(r, c.saldo).valor : undefined;

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
      fecha: fechaStr,
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

  if (descartes) {
    marcarFilasDeTotales(lines, descartes);
    censoIndependiente(rows, cfg, lines, descartes, filasResumen);
  }
  return lines;
}

/**
 * CENSO INDEPENDIENTE DEL MAPEO (punto 3, 2026-09-30). El censo de arriba cuenta
 * con los mismos ojos con que leyó (las columnas del mapa): si el banco inserta
 * una columna, la plata que quedó fuera del mapa no se ve. Este segundo censo NO
 * mira el mapa: toda fila de la región de datos con ALGUNA fecha y ALGUNA plata
 * (en cualquier columna que no sea fecha, saldo, N° de documento o un código)
 * tiene que haber terminado en movimiento o en descarte explicado. Si no, queda
 * como sospecha `sin_leer` (no legítima → el cuadre la muestra). Nunca silencio.
 */
function censoIndependiente(
  rows: Row[],
  cfg: AdapterConfig,
  lines: ParsedLine[],
  descartes: DescarteFila[],
  filasResumen: Set<number>,
): void {
  const c = cfg.columns;
  const start = cfg.skip_rows_before_data;
  const vistas = new Set<number>([
    ...lines.map((l) => (l.excel_row ?? 0) - 1),
    ...descartes.map((d) => d.excel_row - 1),
  ]);
  const ncols = rows.slice(start).reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  const noPlata = new Set<number>([c.fecha, c.saldo, c.n_documento].filter((x) => x != null && x >= 0));
  for (let col = 0; col < ncols; col++) {
    if (noPlata.has(col)) continue;
    const celdas = rows.slice(start).map((r) => r?.[col]);
    if (esColumnaDeCodigos(celdas) || esColumnaCorrelativa(celdas)) noPlata.add(col);
  }
  const lector = new LectorMontos(rows as unknown[][], start, cfg.number_format === "generic" ? "generic" : "chilean");
  // ARRIBA del bloque detectado (adversarial-1 falla 3): una fila con fecha en la
  // columna fecha y plata en las columnas del mapa es un movimiento que el bloque
  // dejó afuera, no metadata. Con la forma exacta del mapa, para no confundir el
  // encabezado del banco (cuenta, período) con plata.
  for (let i = 0; i < start; i++) {
    const r = rows[i];
    if (i === cfg.header_row || vistas.has(i) || !r || !cellEsFecha(r[c.fecha] as never)) continue;
    const plata = montoEnFila(r, cfg, lector);
    if (!plata.monto) continue;
    const saldoComoMonto = c.saldo >= 0 && Math.abs(lector.leer(r, c.saldo).valor) === plata.monto;
    const celdaF = r[c.fecha] as unknown;
    const f = celdaF instanceof Date
      ? { ok: !Number.isNaN(celdaF.getTime()), iso: Number.isNaN(celdaF.getTime()) ? "" : `${celdaF.getFullYear()}-${String(celdaF.getMonth() + 1).padStart(2, "0")}-${String(celdaF.getDate()).padStart(2, "0")}` }
      : parseFechaCartola(String(celdaF ?? ""), cfg.date_format);
    descartes.push({
      excel_row: i + 1,
      motivo: saldoComoMonto ? "resumen" : "sin_leer",
      legitimo: saldoComoMonto,
      fecha: f.ok && "iso" in f ? f.iso || null : null,
      monto: plata.monto,
      tipo_flujo: plata.tipo,
      descripcion: String(r[c.descripcion] ?? "").trim(),
      fecha_cruda: celdaCruda(r[c.fecha]),
    });
  }
  for (let i = start; i < rows.length; i++) {
    if (vistas.has(i)) continue;
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const conFecha = r.some((v) => cellEsFecha(v as never));
    if (!conFecha) continue;
    let plata = 0;
    r.forEach((v, j) => {
      if (noPlata.has(j) || v == null || v === "" || (v as unknown) instanceof Date) return;
      if (typeof v === "number" && ((cellEsFecha(v) && j === c.fecha) || Math.abs(v) < 1)) return; // fecha serial u hora (fracción de día)
      if (typeof v !== "number" && !leerCeldaMonto(v)) return;
      const m = lector.leer(r, j);
      const val = m.ambiguo ? (m.referencia ?? 0) : Math.abs(m.valor);
      if (val > plata) plata = val;
    });
    if (!plata) continue;
    const resumen = filasResumen.has(i) || r.some((v) => typeof v === "string" && SALDO_O_RESUMEN_RE.test(v));
    const fechaCelda = r[c.fecha] as unknown;
    const fecha = fechaCelda instanceof Date && !Number.isNaN(fechaCelda.getTime())
      ? `${fechaCelda.getFullYear()}-${String(fechaCelda.getMonth() + 1).padStart(2, "0")}-${String(fechaCelda.getDate()).padStart(2, "0")}`
      : (() => { const f = parseFechaCartola(String(fechaCelda ?? ""), cfg.date_format); return f.ok ? f.iso : null; })();
    descartes.push({
      excel_row: i + 1,
      motivo: resumen ? "resumen" : "sin_leer",
      legitimo: resumen,
      fecha,
      monto: plata,
      tipo_flujo: null,
      descripcion: String(r[c.descripcion] ?? "").trim(),
      fecha_cruda: celdaCruda(fechaCelda),
    });
  }
  descartes.sort((a, b) => a.excel_row - b.excel_row);
}

/** Qué sumas de lo leído calzaron con una fila de totales del banco. */
export interface CalceTotales {
  entradas: boolean;
  salidas: boolean;
  todo: boolean;
}

/**
 * Una fila sin fecha cuyo monto es la suma de los abonos, de los cargos o de
 * todo lo leído es la fila de totales del banco (BancoEstado, BICE: sin texto,
 * solo el número). No es una transacción → descarte legítimo. Devuelve QUÉ
 * sumas calzaron: ese calce es PRUEBA a favor de la lectura (juez-banco.ts), no
 * solo un motivo para botar la fila.
 */
export function marcarFilasDeTotales(lines: ParsedLine[], descartes: DescarteFila[]): CalceTotales {
  // Dos formas de sumar: la nuestra (todo lo leído) y la del Excel del banco,
  // cuya fórmula SUMA ignora los montos escritos como texto (BancoEstado: un
  // abono "$100" en texto → el total del banco quedaba $100 abajo).
  const suma = (tipo: ParsedLine["tipo"] | null, soloNumeros: boolean) =>
    lines
      .filter((l) => (tipo == null || l.tipo === tipo) && !(soloNumeros && l.monto_texto))
      .reduce((s, l) => s + l.monto, 0);
  const calce: CalceTotales = { entradas: false, salidas: false, todo: false };
  const cerca = (a: number, b: number) => a > 0 && Math.abs(a - b) <= 1;
  for (const d of descartes) {
    if (d.motivo !== "sin_fecha" && d.motivo !== "resumen") continue;
    let calzo = false;
    for (const soloNumeros of [false, true]) {
      if (cerca(suma("ENTRADA", soloNumeros), d.monto) && d.tipo_flujo !== "salida") { calce.entradas = true; calzo = true; }
      if (cerca(suma("SALIDA", soloNumeros), d.monto) && d.tipo_flujo !== "entrada") { calce.salidas = true; calzo = true; }
      if (cerca(suma(null, soloNumeros), d.monto)) { calce.todo = true; calzo = true; }
    }
    // Solo una fila SIN fecha se vuelve legítima por calzar (como siempre).
    if (calzo && d.motivo === "sin_fecha") {
      d.legitimo = true;
      d.motivo = "resumen";
    }
  }
  return calce;
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
