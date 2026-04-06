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
  // Step 1: find the first run of >= 5 consecutive "transaction-looking" rows
  const txStart = findTransactionBlockStart(rows);
  if (txStart < 0) return null;

  // Step 2: collect a sample of tx rows to analyze column roles
  const sample: Row[] = [];
  for (let i = txStart; i < rows.length && sample.length < 30; i++) {
    const r = rows[i];
    if (r && isTransactionRow(r)) sample.push(r);
  }
  if (sample.length < 5) return null;

  // Step 3: infer column roles across the sample
  const cols = inferColumns(sample);
  if (!cols) return null;

  // Step 4: figure out date format from the first fecha value
  const firstFecha = String(sample[0][cols.fecha] ?? "");
  const dateFormat = detectDateFormat(firstFecha);

  return {
    header_row: Math.max(0, txStart - 1),
    skip_rows_before_data: txStart,
    date_format: dateFormat,
    number_format: "chilean",
    columns: cols,
  };
}

function findTransactionBlockStart(rows: Row[]): number {
  const REQUIRED_CONSECUTIVE = 5;
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

function detectDateFormat(sample: string): AdapterConfig["date_format"] {
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(sample)) return "yyyy-mm-dd";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) return "dd/mm/yyyy";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(sample)) return "dd-mm-yyyy";
  return "unknown";
}
