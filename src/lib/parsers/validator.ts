import type { ParsedLine, Row, AdapterConfig, ValidationResult } from "./types";
import { parseChileanNumber } from "./apply";

const MIN_ROWS = 1;
const MAX_ROWS = 5000;
const MAX_SINGLE_MONTO = 100_000_000_000; // 100 billones — anti-saldo
const MAX_OUTLIER_RATIO = 10; // max monto no debe superar 10x la mediana

// Ventana de fechas creíble para una cartola. Generosa a propósito: alguien
// puede subir una cartola vieja para ponerse al día, pero NADIE tiene
// movimientos del 2091.
const ANIOS_ATRAS_MAX = 10;
const ANIOS_ADELANTE_MAX = 1;
// Fracción de fechas fuera de ventana que delata una columna mal mapeada. Una
// fila rara puede ser un dedazo del usuario; un quinto del archivo es que
// estamos leyendo la columna equivocada.
const FRACCION_FECHAS_ABSURDAS = 0.2;

/**
 * Validate a set of parsed lines extracted by any layer.
 *
 * Never throws — always returns a structured result. Callers decide what to
 * do based on `ok`. Errors are blocking (capa falla), warnings are
 * non-blocking (capa pasa, pero el documento se flagea).
 *
 * The `rows` and `cfg` arguments are optional but enable the stronger
 * "saldo monotonia" check: if the raw sheet has a saldo column, verify that
 * saldo[i+1] ≈ saldo[i] ± monto[i+1]. This detects column-mapping errors
 * with mathematical certainty.
 */
export function validate(
  lines: ParsedLine[],
  rows?: Row[],
  cfg?: AdapterConfig
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stats = computeStats(lines);

  // Check 1: minimum rows
  if (lines.length < MIN_ROWS) {
    errors.push(`check_1_min_rows: got ${lines.length}, need ≥ ${MIN_ROWS}`);
  }

  // Check 2: all dates parsed (non-empty)
  const badDates = lines.filter((l) => !l.fecha || l.fecha.length < 8);
  if (badDates.length > 0) {
    errors.push(`check_2_bad_dates: ${badDates.length} rows with invalid fecha`);
  }

  // Check 2b: las fechas tienen que ser CREÍBLES, no solo estar presentes.
  // Caso real (clienta M&E, 2026-08-28): su planilla dejó de traer columna de
  // fecha y el detector tomó la de MONTOS como si fuera fecha. En Excel una
  // fecha es un número —46.242 es el 21-nov-2026— así que un monto de $46.242
  // se ve idéntico a una fecha. Resultado: 66 movimientos con fechas de 2036,
  // 2064 y 2091, montos sacados de la columna de comisiones, y todo con cara
  // de éxito listo para aprobar. El check 2 lo dejaba pasar porque solo mira
  // que la fecha no esté vacía y tenga 8 caracteres: "2091-08-25" los tiene.
  const anioHoy = new Date().getUTCFullYear();
  const anioMin = anioHoy - ANIOS_ATRAS_MAX;
  const anioMax = anioHoy + ANIOS_ADELANTE_MAX;
  const conFecha = lines.filter((l) => l.fecha && l.fecha.length >= 8);
  const absurdas = conFecha.filter((l) => {
    const anio = Number(String(l.fecha).slice(0, 4));
    return !Number.isFinite(anio) || anio < anioMin || anio > anioMax;
  });
  if (conFecha.length > 0 && absurdas.length / conFecha.length >= FRACCION_FECHAS_ABSURDAS) {
    const ejemplos = [...new Set(absurdas.map((l) => l.fecha))].slice(0, 3).join(", ");
    errors.push(
      `check_2b_fechas_absurdas: ${absurdas.length}/${conFecha.length} fuera de ${anioMin}-${anioMax} (${ejemplos})`,
    );
  }

  // Check 3: all montos > 0
  const badMontos = lines.filter((l) => !l.monto || l.monto <= 0);
  if (badMontos.length > 0) {
    errors.push(`check_3_zero_monto: ${badMontos.length} rows with monto ≤ 0`);
  }

  // Check 4: max monto sane (anti-saldo extraction)
  if (stats.maxMonto >= MAX_SINGLE_MONTO) {
    errors.push(
      `check_4_max_monto_insane: ${stats.maxMonto.toLocaleString()} ≥ ${MAX_SINGLE_MONTO.toLocaleString()}`
    );
  }
  // Outlier relative to median
  if (
    stats.medianMonto > 0 &&
    stats.maxMonto > stats.medianMonto * MAX_OUTLIER_RATIO &&
    lines.length >= 20
  ) {
    warnings.push(
      `warn_outlier_monto: max ${stats.maxMonto.toLocaleString()} > ${MAX_OUTLIER_RATIO}x median ${stats.medianMonto.toLocaleString()}`
    );
  }

  // Check 5: not too many rows
  if (lines.length > MAX_ROWS) {
    errors.push(`check_5_too_many_rows: ${lines.length} > ${MAX_ROWS}`);
  }

  // Check 6: saldo monotonia. Only meaningful for two_cols layout where the
  // equation distinguishes cargo from abono mapping. In single_col and
  // transactions_log layouts the tipo_flujo source is explicit (column flag
  // or default), so the saldo equation is not needed and may give false
  // negatives when rows are ordered DESC or saldo is registered pre-tx.
  if (rows && cfg && cfg.columns.saldo >= 0 && (cfg.layout ?? "two_cols") === "two_cols") {
    const monotoniaError = checkSaldoMonotonia(rows, cfg);
    if (monotoniaError) errors.push(monotoniaError);
  }

  // Warning: tipo_flujo ratio extreme
  if (lines.length >= 20) {
    const entradaRatio = stats.entradas / lines.length;
    if (entradaRatio > 0.98 || entradaRatio < 0.02) {
      warnings.push(
        `warn_extreme_ratio: ${(entradaRatio * 100).toFixed(0)}% entradas (posible inversión de tipo_flujo)`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

function computeStats(lines: ParsedLine[]): ValidationResult["stats"] {
  let entradas = 0;
  let salidas = 0;
  let sumEntradas = 0;
  let sumSalidas = 0;
  const montos: number[] = [];

  for (const l of lines) {
    if (l.tipo === "ENTRADA") {
      entradas++;
      sumEntradas += l.monto;
    } else {
      salidas++;
      sumSalidas += l.monto;
    }
    if (l.monto > 0) montos.push(l.monto);
  }

  montos.sort((a, b) => a - b);
  const medianMonto = montos.length ? montos[Math.floor(montos.length / 2)] : 0;
  const minMonto = montos[0] ?? 0;
  const maxMonto = montos[montos.length - 1] ?? 0;

  return {
    rows: lines.length,
    entradas,
    salidas,
    sumEntradas,
    sumSalidas,
    minMonto,
    maxMonto,
    medianMonto,
  };
}

/**
 * Check that saldo[i] = saldo[i-1] + abono[i] - cargo[i].
 * Allow a tolerance for rounding. If > 20% of rows fail, the column mapping
 * is wrong and this layer's config should be rejected.
 */
function checkSaldoMonotonia(rows: Row[], cfg: AdapterConfig): string | null {
  const { columns: c, skip_rows_before_data } = cfg;
  if (c.saldo < 0) return null;

  let prevSaldo: number | null = null;
  let checked = 0;
  let failed = 0;

  for (let i = skip_rows_before_data; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;

    const fechaRaw = r[c.fecha];
    if (
      !fechaRaw ||
      !String(fechaRaw).match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/)
    )
      continue;

    const cargo = parseChileanNumber(r[c.cargo]);
    const abono = parseChileanNumber(r[c.abono]);
    const saldo = parseChileanNumber(r[c.saldo]);

    if (!cargo && !abono) continue;
    if (!saldo) continue;

    if (prevSaldo !== null) {
      const expected = prevSaldo + abono - cargo;
      const diff = Math.abs(saldo - expected);
      // Tolerate 1% relative error or 100 CLP absolute
      const tolerance = Math.max(100, Math.abs(expected) * 0.01);
      checked++;
      if (diff > tolerance) failed++;
    }

    prevSaldo = saldo;
  }

  if (checked < 10) return null; // too few samples to judge
  const failRatio = failed / checked;
  if (failRatio > 0.2) {
    return `check_6_saldo_monotonia: ${failed}/${checked} rows failed running-balance equation (${(failRatio * 100).toFixed(0)}%)`;
  }
  return null;
}
