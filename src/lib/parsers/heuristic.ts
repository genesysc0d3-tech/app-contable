import type { AdapterConfig, Row } from "./types";
import { parseChileanNumber } from "./apply";

/**
 * Universal heuristic detector: finds the transaction block by STRUCTURE,
 * not by column names. Works with any bank layout that has:
 *   - Fecha column
 *   - Descripción column (text)
 *   - Two mutually-exclusive numeric columns (cargo vs abono)
 *   - Optional saldo column (running balance, present in every tx row)
 *
 * Returns null if no plausible cartola structure is detected. The caller
 * should then fall back to the next layer.
 */
export function detectHeuristic(rows: Row[]): AdapterConfig | null {
  // Step 1: find the first run of >= 3 consecutive "transaction-looking" rows
  // (lowered from 5 to also accept smaller test cartolas)
  const txStart = findTransactionBlockStart(rows);
  if (txStart < 0) return null;

  // Step 2: collect a sample of tx rows to analyze column roles
  const sample: Row[] = [];
  for (let i = txStart; i < rows.length && sample.length < 30; i++) {
    const r = rows[i];
    if (r && isTransactionRow(r)) sample.push(r);
  }
  if (sample.length < 3) return null;

  // Step 3: try layout detection (two_cols first, then single_col)
  const twoColsCfg = inferColumns(sample);
  if (twoColsCfg) {
    const firstFecha = String(sample[0][twoColsCfg.fecha] ?? "");
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: detectDateFormat(firstFecha),
      number_format: "chilean",
      layout: "two_cols",
      columns: twoColsCfg,
    };
  }

  const singleColCfg = inferSingleColLayout(sample);
  if (singleColCfg) {
    const firstFecha = String(sample[0][singleColCfg.fecha] ?? "");
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: detectDateFormat(firstFecha),
      number_format: "chilean",
      layout: "single_col",
      columns: singleColCfg,
    };
  }

  // Last resort: transactions_log layout (1 monto col, no tipo flag, no
  // saldo). Common in manual sales spreadsheets and exchange P2P exports.
  const txLogCfg = inferTransactionsLogLayout(sample);
  if (txLogCfg) {
    const firstFecha = String(sample[0][txLogCfg.fecha] ?? "");
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: detectDateFormat(firstFecha),
      number_format: "chilean",
      layout: "transactions_log",
      default_tipo_flujo: "entrada",
      columns: txLogCfg,
    };
  }

  return null;
}

export function findTransactionBlockStart(rows: Row[]): number {
  const REQUIRED_CONSECUTIVE = 3;
  let consec = 0;
  let start = -1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && isTransactionRow(r)) {
      if (consec === 0) start = i;
      consec++;
      if (consec >= REQUIRED_CONSECUTIVE) return start;
    } else {
      consec = 0;
      start = -1;
    }
  }
  return -1;
}

/**
 * A row "looks like a transaction" if it has:
 *  - At least one cell that parses as a date
 *  - At least one cell that parses as a number > 0
 */
function isTransactionRow(r: Row): boolean {
  let hasDate = false;
  let hasNumber = false;
  for (const cell of r) {
    if (cell == null) continue;
    const s = String(cell).trim();
    if (!s) continue;
    if (
      !hasDate &&
      /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)
    ) {
      hasDate = true;
    }
    if (!hasNumber) {
      const n = parseChileanNumber(s);
      if (n > 0) hasNumber = true;
    }
  }
  return hasDate && hasNumber;
}

interface InferredCols {
  fecha: number;
  descripcion: number;
  n_documento: number;
  cargo: number;
  abono: number;
  saldo: number;
  monto?: number;
  tipo_flujo_col?: number;
}

function inferColumns(sample: Row[]): InferredCols | null {
  const ncols = Math.max(...sample.map((r) => r.length));
  if (ncols < 3) return null;

  // For each column index, compute per-column stats
  interface ColStats {
    idx: number;
    dateRatio: number;      // fraction of cells that parse as dates
    numberRatio: number;    // fraction that parse as numbers > 0
    nonEmpty: number;       // count of non-empty cells
    avgTextLen: number;     // mean string length for text-ish cells
    avgNumValue: number;    // mean value for numeric cells
    maxNumValue: number;
    isMonotonic: boolean;   // looks like a running balance
  }

  const stats: ColStats[] = [];

  for (let col = 0; col < ncols; col++) {
    let dates = 0;
    let numbers = 0;
    let nonEmpty = 0;
    let textLen = 0;
    let textCount = 0;
    let numSum = 0;
    let numMax = 0;
    const numSeries: number[] = [];

    for (const r of sample) {
      const cell = r[col];
      if (cell == null || cell === "") {
        numSeries.push(0);
        continue;
      }
      const s = String(cell).trim();
      if (!s) {
        numSeries.push(0);
        continue;
      }
      nonEmpty++;
      if (
        /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)
      ) {
        dates++;
        numSeries.push(0);
        continue;
      }
      const n = parseChileanNumber(s);
      if (n > 0 && /^[\d.,\- ]+$/.test(s)) {
        numbers++;
        numSum += n;
        if (n > numMax) numMax = n;
        numSeries.push(n);
      } else {
        textLen += s.length;
        textCount++;
        numSeries.push(0);
      }
    }

    const total = sample.length;
    stats.push({
      idx: col,
      dateRatio: dates / total,
      numberRatio: numbers / total,
      nonEmpty,
      avgTextLen: textCount ? textLen / textCount : 0,
      avgNumValue: numbers ? numSum / numbers : 0,
      maxNumValue: numMax,
      isMonotonic: isLikelyRunningBalance(numSeries),
    });
  }

  // fecha: column with highest dateRatio (must be > 0.8)
  const fechaCol = [...stats].sort((a, b) => b.dateRatio - a.dateRatio)[0];
  if (!fechaCol || fechaCol.dateRatio < 0.8) return null;

  // descripcion: column with highest avgTextLen (ties broken by nonEmpty)
  const descCol = [...stats]
    .filter((s) => s.idx !== fechaCol.idx && s.avgTextLen > 0)
    .sort((a, b) => b.avgTextLen - a.avgTextLen || b.nonEmpty - a.nonEmpty)[0];
  if (!descCol) return null;

  // Numeric columns (for cargo/abono/saldo/ndoc selection)
  const numericCols = stats.filter(
    (s) => s.idx !== fechaCol.idx && s.idx !== descCol.idx && s.numberRatio > 0
  );

  // saldo: numeric column that looks monotonic AND has values in every row
  const saldoCol = numericCols
    .filter((s) => s.isMonotonic && s.nonEmpty >= sample.length * 0.9)
    .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];

  // cargo & abono: two numeric columns that are mutually exclusive (sum of nonEmpty per row = 1 most of the time)
  const candidateExclusive = numericCols.filter(
    (s) => !saldoCol || s.idx !== saldoCol.idx
  );

  // Find the pair (i,j) in candidateExclusive where rows with BOTH > 0 is minimal
  // AND rows with AT LEAST ONE > 0 is maximal.
  let bestPair: { a: number; b: number; score: number } | null = null;
  for (let i = 0; i < candidateExclusive.length; i++) {
    for (let j = i + 1; j < candidateExclusive.length; j++) {
      const a = candidateExclusive[i].idx;
      const b = candidateExclusive[j].idx;
      let both = 0;
      let either = 0;
      for (const r of sample) {
        const na = parseChileanNumber(r[a]);
        const nb = parseChileanNumber(r[b]);
        if (na > 0 && nb > 0) both++;
        if (na > 0 || nb > 0) either++;
      }
      if (either < sample.length * 0.9) continue;
      // Score: maximize either, minimize both
      const score = either - both * 10;
      if (!bestPair || score > bestPair.score) {
        bestPair = { a, b, score };
      }
    }
  }

  if (!bestPair) return null;

  // Assign cargo vs abono: in Chilean cartolas the convention is that cargos
  // (salidas) appear FIRST (left) and abonos (entradas) appear SECOND (right).
  // We preserve order to match Banco de Chile convention.
  const cargoCol = Math.min(bestPair.a, bestPair.b);
  const abonoCol = Math.max(bestPair.a, bestPair.b);

  // n_documento: numeric column that's not cargo/abono/saldo, typically has
  // long integer values (like transaction IDs). We allow -1 if not found.
  const ndocCol = numericCols
    .filter(
      (s) =>
        s.idx !== cargoCol &&
        s.idx !== abonoCol &&
        (!saldoCol || s.idx !== saldoCol.idx)
    )
    .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];

  return {
    fecha: fechaCol.idx,
    descripcion: descCol.idx,
    n_documento: ndocCol?.idx ?? -1,
    cargo: cargoCol,
    abono: abonoCol,
    saldo: saldoCol?.idx ?? -1,
  };
}

/**
 * A numeric series "looks like a running balance" if consecutive non-zero
 * values don't jump too wildly (no 100x changes between neighbors) and the
 * series is mostly filled.
 */
function isLikelyRunningBalance(series: number[]): boolean {
  const nonZero = series.filter((n) => n > 0);
  if (nonZero.length < 5) return false;
  // Check that neighbors aren't wildly different
  let bigJumps = 0;
  for (let i = 1; i < nonZero.length; i++) {
    const prev = nonZero[i - 1];
    const curr = nonZero[i];
    if (prev === 0) continue;
    const ratio = curr / prev;
    if (ratio > 100 || ratio < 0.01) bigJumps++;
  }
  return bigJumps / nonZero.length < 0.1;
}

/**
 * Detect a "single_col" layout: one numeric column (monto) + one text column
 * whose values are flags like "Abono"/"Cargo" or "Crédito"/"Débito". This
 * covers simplified Chilean cartolas and test files with a single amount.
 */
function inferSingleColLayout(sample: Row[]): InferredCols | null {
  const ncols = Math.max(...sample.map((r) => r.length));
  if (ncols < 3) return null;

  // Find fecha column
  let fechaCol = -1;
  for (let col = 0; col < ncols; col++) {
    let dates = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)) {
        dates++;
      }
    }
    if (dates / sample.length >= 0.8) {
      fechaCol = col;
      break;
    }
  }
  if (fechaCol < 0) return null;

  // Find descripcion column (longest average text, not fecha)
  let descCol = -1;
  let maxLen = 0;
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol) continue;
    let totalLen = 0;
    let textCount = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (!s) continue;
      // Skip numeric-looking values
      if (/^-?[\d.,]+$/.test(s) && /\d/.test(s)) continue;
      totalLen += s.length;
      textCount++;
    }
    const avg = textCount > 0 ? totalLen / textCount : 0;
    if (avg > maxLen && avg > 10) {
      maxLen = avg;
      descCol = col;
    }
  }
  if (descCol < 0) return null;

  // Find tipo_flujo column: text column with values matching Abono/Cargo
  // pattern OR single-letter flags A/C/D/H (Santander style).
  let tipoCol = -1;
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol) continue;
    let matches = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim().toLowerCase();
      if (!s) continue;
      // Single-letter flags
      if (s === "a" || s === "c" || s === "d" || s === "h") {
        matches++;
        continue;
      }
      // Word flags
      if (/^(abono|cargo|cr[eé]dito|d[eé]bito|ingreso|egreso|dep[oó]sito|giro|haber)/.test(s)) {
        matches++;
      }
    }
    if (matches / sample.length >= 0.8) {
      tipoCol = col;
      break;
    }
  }
  if (tipoCol < 0) return null;

  // Collect all candidate numeric columns
  const numericCols: number[] = [];
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol || col === tipoCol) continue;
    let numericCount = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (!s) continue;
      if (parseChileanNumberLocal(s) > 0) numericCount++;
    }
    if (numericCount / sample.length >= 0.7) numericCols.push(col);
  }

  let montoCol = -1;
  let saldoCol = -1;

  if (numericCols.length === 1) {
    // Only one numeric column → that's monto, no saldo
    montoCol = numericCols[0];
  } else if (numericCols.length >= 2) {
    // Try every pair (a=monto, b=saldo) and pick the one where the equation
    //   saldo[i] = saldo[i-1] + sign(tipo[i]) * monto[i]
    // matches the most consecutive rows. This is the mathematical
    // discriminator between monto (transaction amount) and saldo (running
    // balance) and is immune to range/variance heuristics.
    let bestScore = -1;
    let bestPair: { monto: number; saldo: number } | null = null;
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = 0; j < numericCols.length; j++) {
        if (i === j) continue;
        const m = numericCols[i];
        const s = numericCols[j];
        const score = countEquationMatches(sample, m, s, tipoCol);
        if (score > bestScore) {
          bestScore = score;
          bestPair = { monto: m, saldo: s };
        }
      }
    }
    // Require at least half of testable pairs to satisfy the equation.
    if (bestPair && bestScore >= Math.floor((sample.length - 1) / 2)) {
      montoCol = bestPair.monto;
      saldoCol = bestPair.saldo;
    } else if (bestPair) {
      // Couldn't verify via equation → fall back to first numeric col as monto
      montoCol = numericCols[0];
      saldoCol = numericCols[1] ?? -1;
    }
  }

  if (montoCol < 0) return null;

  return {
    fecha: fechaCol,
    descripcion: descCol,
    n_documento: -1,
    cargo: montoCol,         // Re-used for storage; apply.ts uses monto in single_col mode
    abono: montoCol,         // Same
    saldo: saldoCol,
    monto: montoCol,
    tipo_flujo_col: tipoCol,
  };
}

/**
 * Detect a "transactions_log" layout: fecha + descripcion + 1 monto column,
 * no tipo flag, no saldo, no cargo/abono split. Common in manual sales
 * spreadsheets, planillas de honorarios, exchange P2P trade exports.
 *
 * Defaults all rows to entrada (tipo_flujo). The user can change the default
 * by editing the adapter config later.
 */
function inferTransactionsLogLayout(sample: Row[]): InferredCols | null {
  const ncols = Math.max(...sample.map((r) => r.length));
  if (ncols < 3) return null;

  // Find fecha column
  let fechaCol = -1;
  for (let col = 0; col < ncols; col++) {
    let dates = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)) {
        dates++;
      }
    }
    if (dates / sample.length >= 0.8) {
      fechaCol = col;
      break;
    }
  }
  if (fechaCol < 0) return null;

  // Find descripcion column (longest avg text, not fecha)
  let descCol = -1;
  let maxLen = 0;
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol) continue;
    let totalLen = 0;
    let textCount = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (!s) continue;
      if (/^-?[\d.,]+$/.test(s) && /\d/.test(s)) continue;
      totalLen += s.length;
      textCount++;
    }
    const avg = textCount > 0 ? totalLen / textCount : 0;
    if (avg > maxLen && avg > 10) {
      maxLen = avg;
      descCol = col;
    }
  }
  if (descCol < 0) return null;

  // Find monto column: monetary values typically 1000 ≤ n ≤ 10^9 CLP.
  // Excludes phone numbers (~5.7×10^10), RUT-like values, IDs, etc.
  // Also excludes columns where values look like RUTs (have a dash + digit).
  const MIN_MONTO = 1000;
  const MAX_MONTO = 1_000_000_000; // 1 billón CLP
  let montoCol = -1;
  let bestScore = 0;
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol) continue;
    let inRangeCount = 0;
    let totalNumeric = 0;
    let looksLikeRut = 0;
    let total = 0;
    for (const r of sample) {
      const s = String(r[col] ?? "").trim();
      if (!s) continue;
      // Skip RUT-like strings (e.g. "12345678-9")
      if (/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(s)) {
        looksLikeRut++;
        continue;
      }
      const n = parseChileanNumberLocal(s);
      if (n > 0) {
        totalNumeric++;
        if (n >= MIN_MONTO && n <= MAX_MONTO) {
          inRangeCount++;
          total += n;
        }
      }
    }
    // Require at least 80% of values to be numeric AND in monetary range
    if (totalNumeric / sample.length < 0.8) continue;
    if (inRangeCount / sample.length < 0.8) continue;
    if (looksLikeRut > 0) continue;
    // Score = avg value (favor more meaningful monetary columns)
    const avg = total / inRangeCount;
    if (avg > bestScore) {
      bestScore = avg;
      montoCol = col;
    }
  }
  if (montoCol < 0) return null;

  return {
    fecha: fechaCol,
    descripcion: descCol,
    n_documento: -1,
    cargo: montoCol,
    abono: montoCol,
    saldo: -1,
    monto: montoCol,
    tipo_flujo_col: -1,
  };
}

function parseChileanNumberLocal(s: string): number {
  const digits = s.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Count how many consecutive rows satisfy saldo[i] = saldo[i-1] ± monto[i],
 * where the sign is determined by the tipo_flujo column. Used to pick the
 * correct monto vs saldo assignment when two numeric columns are present.
 */
function countEquationMatches(
  sample: Row[],
  montoCol: number,
  saldoCol: number,
  tipoCol: number
): number {
  let matches = 0;
  for (let i = 1; i < sample.length; i++) {
    const prevSaldoRaw = sample[i - 1][saldoCol];
    const currSaldoRaw = sample[i][saldoCol];
    const currMontoRaw = sample[i][montoCol];
    const currTipoRaw = sample[i][tipoCol];

    const prevSaldo = parseChileanNumberLocal(String(prevSaldoRaw ?? ""));
    const currSaldo = parseChileanNumberLocal(String(currSaldoRaw ?? ""));
    const currMonto = parseChileanNumberLocal(String(currMontoRaw ?? ""));
    if (!prevSaldo || !currSaldo || !currMonto) continue;

    const tipoStr = String(currTipoRaw ?? "").trim().toLowerCase();
    let sign = 0;
    if (/^(abono|cr[eé]dito|credito|ingreso|dep[oó]sito|deposito)/.test(tipoStr)) sign = 1;
    else if (/^(cargo|d[eé]bito|debito|egreso|giro)/.test(tipoStr)) sign = -1;
    if (sign === 0) continue;

    const expected = prevSaldo + sign * currMonto;
    // Tolerance: 10 CLP absolute for rounding
    if (Math.abs(currSaldo - expected) <= 10) matches++;
  }
  return matches;
}

function detectDateFormat(sample: string): AdapterConfig["date_format"] {
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(sample)) return "yyyy-mm-dd";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) return "dd/mm/yyyy";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(sample)) return "dd-mm-yyyy";
  return "unknown";
}
