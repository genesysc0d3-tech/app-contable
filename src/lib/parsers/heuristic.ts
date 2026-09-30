import type { AdapterConfig, Row } from "./types";
import { classifyTipoFlag, parseChileanNumber } from "./apply";
import { cuadreSaldo } from "./saldo-cuadre";
import { derivarNumberFormat, leerCeldaMonto, valorCeldaSuelta } from "./numeros";
import { cellEsFecha, esColumnaCorrelativa, esColumnaDeCodigos } from "./celdas";
import { encabezadoConSaldo, encabezadoConSalidas, normalizarTitulo, RE_ENTRADA, RE_SALIDA } from "./encabezados";

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
// cellEsFecha vive en celdas.ts (lo usan también el lector y el censo); se
// re-exporta acá porque validator y tests lo importan desde heuristic.
export { cellEsFecha } from "./celdas";

export function detectHeuristic(rows: Row[]): AdapterConfig | null {
  const cfg = detectHeuristicSinFormato(rows);
  if (!cfg) return null;
  // number_format DERIVADO de las celdas de plata (punto 1, 2026-09-30): antes
  // siempre "chilean" y applyAdapter lo ignoraba.
  const c = cfg.columns;
  cfg.number_format = derivarNumberFormat(rows as unknown[][], cfg.skip_rows_before_data, [c.cargo, c.abono, c.saldo, c.monto ?? -1]);
  return cfg;
}

function detectHeuristicSinFormato(rows: Row[]): AdapterConfig | null {
  // Step 1: find the first run of >= 3 consecutive "transaction-looking" rows
  // (lowered from 5 to also accept smaller test cartolas)
  const inicio = findTransactionBlockStart(rows);
  if (inicio < 0) return null;
  // Glosa partida en 2 filas (adversarial-1 falla 3): el primer bloque de ≥3
  // movimientos seguidos puede empezar DESPUÉS de movimientos separados por una
  // fila de continuación. Se extiende hacia arriba para no perder el primero.
  const txStart = extenderBloqueHaciaArriba(rows, inicio);

  // Step 2: collect a sample of tx rows to analyze column roles
  const sample: Row[] = [];
  for (let i = txStart; i < rows.length && sample.length < 30; i++) {
    const r = rows[i];
    if (r && isTransactionRow(r)) sample.push(r);
  }
  if (sample.length < 3) return null;

  // Step 3: try layout detection (two_cols first, then single_col)
  const twoColsCfg = inferColumns(sample, txStart > 0 ? rows[txStart - 1] : undefined);
  if (twoColsCfg) {
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: formatoFechaDeColumna(rows, txStart, twoColsCfg.fecha),
      number_format: "chilean",
      layout: "two_cols",
      columns: twoColsCfg,
    };
  }

  const singleColCfg = inferSingleColLayout(sample);
  if (singleColCfg) {
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: formatoFechaDeColumna(rows, txStart, singleColCfg.fecha),
      number_format: "chilean",
      layout: "single_col",
      columns: singleColCfg,
    };
  }

  // Monto con SIGNO en una sola columna (Falabella, vuelta 2 P5).
  const conSigno = inferMontoConSigno(sample, txStart > 0 ? rows[txStart - 1] : undefined);
  if (conSigno) {
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: formatoFechaDeColumna(rows, txStart, conSigno.fecha),
      number_format: "chilean",
      layout: "monto_con_signo",
      columns: conSigno,
    };
  }

  // Last resort: transactions_log layout (1 monto col, no tipo flag, no
  // saldo). Common in manual sales spreadsheets and exchange P2P exports.
  // "Todo entrada" solo si ningún título habla de plata que sale NI de saldo:
  // una cartola con cargos leída así convierte egresos en boletas, y con saldo
  // la heurística llegó a tomar el SALDO como monto (planilla "BOLETAS BIT EM",
  // 2026-09-11). Las cartolas editadas con SOLO abonos (BCI "Abono EXENTAS",
  // BICE "ABONOS", BancoEstado "Depósitos / Abonos") no traen ni una ni otro y
  // siguen pasando. Si no, cae a la IA con alarma.
  const titulos = txStart > 0 ? rows[txStart - 1] : undefined;
  if (encabezadoConSalidas(titulos) || encabezadoConSaldo(titulos)) return null;
  const txLogCfg = inferTransactionsLogLayout(sample);
  if (txLogCfg) {
    return {
      header_row: Math.max(0, txStart - 1),
      skip_rows_before_data: txStart,
      date_format: formatoFechaDeColumna(rows, txStart, txLogCfg.fecha),
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
 * Sube el inicio del bloque mientras arriba haya movimientos, saltando filas de
 * CONTINUACIÓN (sin fecha, con texto) que estén entre dos movimientos.
 */
export function extenderBloqueHaciaArriba(rows: Row[], inicio: number): number {
  let s = inicio;
  let i = inicio - 1;
  while (i >= 0) {
    const r = rows[i];
    if (r && isTransactionRow(r)) { s = i; i--; continue; }
    // Glosa partida en 2, 3 o 4 filas (vuelta 2, P2): se saltan hasta 3
    // continuaciones seguidas si arriba de ellas hay un movimiento.
    let j = i;
    while (j >= 0 && i - j < 3 && rows[j] && esFilaDeContinuacion(rows[j])) j--;
    if (j < i && j >= 0 && rows[j] && isTransactionRow(rows[j])) { i = j; continue; }
    break;
  }
  return s;
}

/** Sin ninguna fecha y con texto (letras): el resto de una glosa partida. */
function esFilaDeContinuacion(r: Row): boolean {
  let texto = false;
  for (const cell of r) {
    if (cell == null || String(cell).trim() === "") continue;
    if (cellEsFecha(cell)) return false;
    if (typeof cell === "string" && /[a-záéíóúñ]/i.test(cell)) texto = true;
  }
  return texto;
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
    if (!hasDate && cellEsFecha(cell)) {
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

function inferColumns(sample: Row[], header?: Row): InferredCols | null {
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
      if (cellEsFecha(cell)) {
        dates++;
        numSeries.push(0);
        continue;
      }
      // Plata = un monto LIMPIO (número tipado o "1.234.567", "$ 1.234",
      // "1,234,567"): antes la regex exigía puros dígitos y separadores, así que
      // "$ 1.234.567" (BancoEstado) no era plata y un RUT "10.111.222-3" sí.
      const l = leerCeldaMonto(cell);
      const n = l ? Math.abs(valorCeldaSuelta(l)) : 0;
      // "20260923" es una fecha, no un monto (BancoEstado, 2026-09-23).
      if (n > 0 && !cellEsFecha(cell)) {
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

  // descripcion: el encabezado manda si dice glosa/descripción/detalle/concepto;
  // si no, la columna de texto más larga que NO sea un código. Antes era "la más
  // larga" a secas y en la cartola BCI "Detallado" ganó "Código de transacción"
  // (un hash de 60 caracteres sin espacios) sobre "Glosa detalle": las 491 filas
  // de LC llegaron sin glosa, ninguna regla calzó y todas fueron a la IA
  // (incidente 2026-09-26).
  const textoCols = stats.filter((s) => s.idx !== fechaCol.idx && s.avgTextLen > 0);
  const porEncabezado = textoCols.find((s) => /glosa|descripci|detalle|concepto/i.test(celdaEncabezado(header, s.idx)));
  const descCol =
    porEncabezado ??
    [...textoCols]
      .sort(
        (a, b) =>
          Number(esTextoCodigo(sample, a.idx)) - Number(esTextoCodigo(sample, b.idx)) ||
          b.avgTextLen - a.avgTextLen ||
          b.nonEmpty - a.nonEmpty,
      )[0];
  if (!descCol) return null;

  // Numeric columns (for cargo/abono/saldo/ndoc selection)
  const numericCols = stats.filter(
    (s) => s.idx !== fechaCol.idx && s.idx !== descCol.idx && s.numberRatio > 0
  );

  // Rol grueso por FORMA: un correlativo (5000, 5001…) o una columna de códigos
  // nunca es plata ni saldo (Itaú sin títulos, 2026-09-30).
  const plata = numericCols.filter((s) => !esColumnaNoPlata(sample, s.idx));

  // (1) La ECUACIÓN primero (punto 4, 2026-09-30): probar TODAS las ternas
  // (saldo, cargo, abono) entre las columnas de plata y quedarse con la que
  // cierra saldo[i] = saldo[i-1] + abono − cargo. Es aritmética, no adivinanza;
  // antes el saldo se elegía por "parece corrido" y la ecuación solo orientaba.
  const terna = mejorTernaPorSaldo(sample, plata.map((s) => s.idx));
  if (terna) {
    const ndoc = numericCols
      .filter((s) => s.idx !== terna.cargo && s.idx !== terna.abono && s.idx !== terna.saldo)
      .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];
    return {
      fecha: fechaCol.idx,
      descripcion: descCol.idx,
      n_documento: ndoc?.idx ?? -1,
      cargo: terna.cargo,
      abono: terna.abono,
      saldo: terna.saldo,
    };
  }

  // (2) Sin terna que cierre: forma. saldo = columna "corrida" llena.
  const saldoCol = plata
    // Lleno de PLATA (≠ 0) en casi todas las filas: un 0 tipado en la columna de
    // abonos (Itaú) no es "lleno" — antes contaba y el abono pasaba por saldo.
    .filter((s) => s.isMonotonic && s.numberRatio >= 0.9)
    .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];

  // cargo & abono: two numeric columns that are mutually exclusive (sum of nonEmpty per row = 1 most of the time)
  const candidateExclusive = plata.filter((s) => !saldoCol || s.idx !== saldoCol.idx);

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
      // Exclusividad DURA: en una cartola two_cols real cada fila tiene cargo
      // XOR abono (both ≈ 0). Un par donde ambos suelen convivir NO es
      // cargo/abono — es monto+comisión u otra cosa (una planilla casera con
      // fechas nativas caía acá y two_cols le robaba el turno al carril
      // transactions_log, extrayendo basura "validada": bug M&E 2026-08-22).
      if (both > sample.length * 0.1) continue;
      // Score: maximize either, minimize both
      const score = either - both * 10;
      if (!bestPair || score > bestPair.score) {
        bestPair = { a, b, score };
      }
    }
  }

  if (!bestPair) return null;

  // cargo vs abono. La posición NO basta: Banco de Chile pone el cargo a la
  // izquierda, BCI "Movimientos Detallado" pone "Ingreso (+)" antes que
  // "Egreso (-)" — con la convención fija, las ventas de LC entraron como gastos
  // (incidente 2026-09-26). Orden de evidencia: (1) el saldo corrido, que es
  // aritmética y no se equivoca; (2) el nombre del encabezado; (3) la convención
  // izquierda = cargo, solo si no hay nada más.
  const izq = Math.min(bestPair.a, bestPair.b);
  const der = Math.max(bestPair.a, bestPair.b);
  let cargoCol = izq;
  let abonoCol = der;
  const porSaldo = saldoCol ? orientarPorSaldo(sample, izq, der, saldoCol.idx) : null;
  const porNombre = orientarPorEncabezado(header, izq, der);
  const orientacion = porSaldo ?? porNombre;
  if (orientacion) {
    cargoCol = orientacion.cargo;
    abonoCol = orientacion.abono;
  }

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

/** Montos (absolutos) de una columna en la muestra; 0 si la celda no es plata. */
function montosColumna(sample: Row[], col: number): number[] {
  return sample.map((r) => {
    const l = leerCeldaMonto(r[col]);
    return l ? Math.abs(valorCeldaSuelta(l)) : 0;
  });
}

/** ¿La columna NO puede ser plata por su forma (código, correlativo, id)? */
function esColumnaNoPlata(sample: Row[], col: number): boolean {
  const celdas = sample.map((r) => r[col]);
  return esColumnaId(sample, col) || esColumnaDeCodigos(celdas) || esColumnaCorrelativa(celdas);
}

/**
 * La terna (saldo, cargo, abono) que mejor cierra la ecuación del saldo, entre
 * TODAS las columnas de plata. Exige: cargo/abono excluyentes (una fila trae uno
 * u otro), ≥5 filas revisadas y ≤10% fallidas; y que la ganadora sea ÚNICA (si
 * dos ternas distintas cierran igual, la ecuación no decide → null).
 */
export function mejorTernaPorSaldo(
  sample: Row[],
  cols: number[],
): { saldo: number; cargo: number; abono: number; fallidas: number; revisadas: number } | null {
  const montos = new Map(cols.map((c) => [c, montosColumna(sample, c)]));
  const llenas = cols.filter((c) => montos.get(c)!.filter((n) => n > 0).length >= sample.length * 0.9);
  // `estricta` = fallidas AL PESO: desempata lo que la tolerancia blanda (1% del
  // saldo) no distingue. Con saldo alto y movimientos chicos, cargo↔abono al
  // revés también "cuadra" blando; al peso, jamás (adversarial-1 falla 1).
  type T = { saldo: number; cargo: number; abono: number; fallidas: number; revisadas: number; ratio: number; estricta: number };
  const buenas: T[] = [];
  for (const s of llenas) {
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const x = cols[i]; const y = cols[j];
        if (x === s || y === s) continue;
        const mx = montos.get(x)!; const my = montos.get(y)!;
        let both = 0; let either = 0;
        for (let k = 0; k < sample.length; k++) {
          if (mx[k] > 0 && my[k] > 0) both++;
          if (mx[k] > 0 || my[k] > 0) either++;
        }
        if (either < sample.length * 0.9 || both > sample.length * 0.1) continue;
        for (const [cargo, abono] of [[x, y], [y, x]]) {
          const r = cuadreSaldo(sample, cargo, abono, s);
          if (r.revisadas < 5) continue;
          const ratio = r.fallidas / r.revisadas;
          if (ratio > 0.1) continue;
          const e = cuadreSaldo(sample, cargo, abono, s, "estricta");
          buenas.push({ saldo: s, cargo, abono, ...r, ratio, estricta: e.revisadas ? e.fallidas / e.revisadas : 1 });
        }
      }
    }
  }
  if (!buenas.length) return null;
  buenas.sort((a, b) => a.estricta - b.estricta || a.ratio - b.ratio || b.revisadas - a.revisadas);
  const [g, segunda] = buenas;
  // Empate exacto entre dos asignaciones distintas: la aritmética no decide.
  if (segunda && segunda.estricta === g.estricta && segunda.ratio === g.ratio && segunda.revisadas === g.revisadas) return null;
  return { saldo: g.saldo, cargo: g.cargo, abono: g.abono, fallidas: g.fallidas, revisadas: g.revisadas };
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
      if (cellEsFecha(r[col])) dates++;
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

  // Collect all candidate numeric columns (montos LIMPIOS; un correlativo o un
  // código nunca es monto ni saldo — Santander "N° Documento" 1000, 1001…).
  const numericCols: number[] = [];
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol || col === tipoCol) continue;
    if (esColumnaNoPlata(sample, col)) continue;
    const numericCount = montosColumna(sample, col).filter((n) => n > 0).length;
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
      // La ecuación no verificó: por FORMA, el monto es la columna que NO
      // parece saldo corrido (antes "la primera numérica", y con las columnas
      // en orden inverso el saldo pasaba a ser el monto en silencio).
      const corridas = numericCols.filter((c) => isLikelyRunningBalance(montosColumna(sample, c)));
      const noCorridas = numericCols.filter((c) => !corridas.includes(c));
      montoCol = noCorridas[0] ?? numericCols[0];
      saldoCol = corridas.find((c) => c !== montoCol) ?? numericCols.find((c) => c !== montoCol) ?? -1;
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
/**
 * Columna de IDENTIFICADORES, no de plata: N° de operación / N° de documento.
 * Incidente 2026-09-23 (BancoEstado, hoja Movimientos): "N° Operación" son
 * strings de 7 dígitos, todos distintos y crecientes; con el puntaje "mayor
 * promedio gana" le ganaban a "Depósitos / Abonos" y los montos de las boletas
 * habrían sido números de operación. Criterio: ≥80% de las celdas son strings
 * de puros dígitos, TODAS del mismo largo (≥6) y con un rango minúsculo frente
 * a su magnitud (correlativos). Un monto real no cumple las tres a la vez.
 */
function celdaEncabezado(header: Row | undefined, col: number): string {
  const v = header?.[col];
  return v == null ? "" : String(v).trim();
}

/**
 * ¿La columna es un CÓDIGO y no una glosa? Texto de una sola "palabra" larga
 * (sin espacios) en casi todas las filas: hashes, IDs de transacción, folios
 * alfanuméricos. Una glosa real trae palabras separadas por espacios.
 */
function esTextoCodigo(sample: Row[], col: number): boolean {
  let texto = 0;
  let codigo = 0;
  for (const r of sample) {
    const v = r[col];
    if (v == null) continue;
    const t = String(v).trim();
    if (!t) continue;
    texto++;
    if (!/\s/.test(t) && t.length >= 12) codigo++;
  }
  return texto >= 3 && codigo / texto >= 0.8;
}

/**
 * Orientación por saldo corrido: la asignación que cuadra (≤20% de filas
 * fallidas, con al menos 5 revisadas) gana. Si las dos cuadran igual de mal o
 * de bien, no decide (null) y se pasa a la siguiente evidencia.
 */
function orientarPorSaldo(
  sample: Row[],
  izq: number,
  der: number,
  saldo: number,
): { cargo: number; abono: number } | null {
  const ratio = (x: { revisadas: number; fallidas: number }) => (x.revisadas >= 5 ? x.fallidas / x.revisadas : 1);
  const normal = ratio(cuadreSaldo(sample, izq, der, saldo));
  const invertida = ratio(cuadreSaldo(sample, der, izq, saldo));
  if (normal <= 0.2 && normal < invertida) return { cargo: izq, abono: der };
  if (invertida <= 0.2 && invertida < normal) return { cargo: der, abono: izq };
  // Empate blando (saldo alto, movimientos chicos): desempata AL PESO.
  if (normal <= 0.2 && invertida <= 0.2) {
    const ne = ratio(cuadreSaldo(sample, izq, der, saldo, "estricta"));
    const ie = ratio(cuadreSaldo(sample, der, izq, saldo, "estricta"));
    if (ne < ie) return { cargo: izq, abono: der };
    if (ie < ne) return { cargo: der, abono: izq };
  }
  return null;
}

/** Orientación por nombre de encabezado (vocabulario único de encabezados.ts). */
function orientarPorEncabezado(
  header: Row | undefined,
  izq: number,
  der: number,
): { cargo: number; abono: number } | null {
  const hi = normalizarTitulo(celdaEncabezado(header, izq));
  const hd = normalizarTitulo(celdaEncabezado(header, der));
  const sal = (t: string) => RE_SALIDA.test(t) && !RE_ENTRADA.test(t);
  const ent = (t: string) => RE_ENTRADA.test(t) && !RE_SALIDA.test(t);
  if (ent(hi) && sal(hd)) return { cargo: der, abono: izq };
  if (sal(hi) && ent(hd)) return { cargo: izq, abono: der };
  return null;
}

function esColumnaId(sample: Row[], col: number): boolean {
  const vals: string[] = [];
  let nonEmpty = 0;
  for (const r of sample) {
    const v = r[col];
    if (v == null || String(v).trim() === "") continue;
    nonEmpty++;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) vals.push(v.trim());
  }
  if (nonEmpty < 3 || vals.length / nonEmpty < 0.8) return false;
  const len = vals[0].length;
  if (len < 6 || vals.some((v) => v.length !== len)) return false;
  // Correlativos: números grandes casi iguales entre sí (1234567, 1234571, …).
  // Los montos de una cartola se mueven en órdenes de magnitud; un rango menor
  // al 10% del máximo no es plata, es un contador.
  if (vals.some((v) => v.startsWith("0"))) return true; // un monto nunca va con cero a la izquierda
  const nums = vals.map((v) => parseInt(v, 10));
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  return max > 0 && (max - min) / max < 0.1;
}

function inferTransactionsLogLayout(sample: Row[]): InferredCols | null {
  const ncols = Math.max(...sample.map((r) => r.length));
  if (ncols < 3) return null;

  // Find fecha column
  let fechaCol = -1;
  for (let col = 0; col < ncols; col++) {
    let dates = 0;
    for (const r of sample) {
      if (cellEsFecha(r[col])) dates++;
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
  // descripcion es OPCIONAL acá: la planilla casera "fecha + monto" pura (el
  // libro de ventas de un microemprendedor, caso M&E) no trae glosa. Sin
  // glosa el detector se pone MÁS exigente con el monto (≥90% de valores
  // monetarios limpios en vez de 80%) — ante la duda, mapeo manual.
  const montoRatioMinimo = descCol < 0 ? 0.9 : 0.8;

  // Find monto column: monetary values typically 1000 ≤ n ≤ 10^9 CLP.
  // Excludes phone numbers (~5.7×10^10), RUT-like values, IDs, etc.
  // Also excludes columns where values look like RUTs (have a dash + digit).
  const MIN_MONTO = 1000;
  const MAX_MONTO = 1_000_000_000; // 1 billón CLP
  // Dos pasadas (BancoEstado 2026-09-23: "N° Operación" son strings de 7
  // dígitos y "Depósitos / Abonos" celdas numéricas; el banco tipa la plata
  // como número y los identificadores como texto): primero solo columnas cuyas
  // celdas son NÚMEROS de verdad; si ninguna sirve, recién se admiten strings.
  const esNumericaTipada = (col: number) => {
    let n = 0; let t = 0;
    for (const r of sample) { const v = r[col]; if (v == null || String(v).trim() === "") continue; t++; if (typeof v === "number") n++; }
    return t > 0 && n / t >= 0.8;
  };
  let montoCol = -1;
  let bestScore = 0;
  for (const soloTipadas of [true, false]) {
  if (montoCol >= 0) break;
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol) continue;
    if (esColumnaNoPlata(sample, col)) continue;
    if (soloTipadas && !esNumericaTipada(col)) continue;
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
    if (inRangeCount / sample.length < montoRatioMinimo) continue;
    if (looksLikeRut > 0) continue;
    // Score = avg value (favor more meaningful monetary columns)
    const avg = total / inRangeCount;
    if (avg > bestScore) {
      bestScore = avg;
      montoCol = col;
    }
  }
  }
  if (montoCol < 0) return null;

  // Si alguna columna es el SALDO CORRIDO de otra (|Δsaldo| = monto), la
  // planilla tiene plata que entra y sale sin bandera que diga cuál: leerla
  // "todo entrada" convierte egresos en ventas, y tomar el saldo como monto es
  // peor. No se adivina: null → siguiente capa / el cliente (punto 4).
  const plata: number[] = [];
  for (let col = 0; col < ncols; col++) {
    if (col === fechaCol || col === descCol || esColumnaNoPlata(sample, col)) continue;
    if (montosColumna(sample, col).filter((n) => n > 0).length >= sample.length * 0.8) plata.push(col);
  }
  if (plata.some((s) => plata.some((m) => m !== s && saldoExplicadoPor(sample, s, m)))) return null;

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

/**
 * UNA columna de monto CON SIGNO (negativo = cargo): Banco Falabella. Se acepta
 * solo con prueba de forma: la columna trae negativos y positivos, y (a) hay una
 * columna de saldo que cierra saldo = anterior + monto AL PESO en ≥90% de los
 * pares (algún orden), o (b) sin saldo, su título dice monto/importe.
 */
function inferMontoConSigno(sample: Row[], header?: Row): InferredCols | null {
  const ncols = Math.max(...sample.map((r) => r.length));
  let fecha = -1;
  for (let col = 0; col < ncols && fecha < 0; col++) {
    if (sample.filter((r) => cellEsFecha(r[col])).length / sample.length >= 0.8) fecha = col;
  }
  if (fecha < 0) return null;
  const valores = (col: number) => sample.map((r) => { const l = leerCeldaMonto(r[col]); return l ? valorCeldaSuelta(l) : null; });
  const candidatas: number[] = [];
  for (let col = 0; col < ncols; col++) {
    if (col === fecha || esColumnaNoPlata(sample, col)) continue;
    const v = valores(col);
    const llenas = v.filter((x) => x != null && x !== 0) as number[];
    if (llenas.length < sample.length * 0.9) continue;
    candidatas.push(col);
  }
  const signadas = candidatas.filter((col) => {
    const v = valores(col).filter((x) => x != null) as number[];
    return v.some((x) => x < 0) && v.some((x) => x > 0);
  });
  const cierra = (m: number, s: number) => {
    const medir = (orden: Row[]) => {
      let ok = 0; let rev = 0;
      for (let i = 1; i < orden.length; i++) {
        const a = parseChileanNumber(orden[i - 1][s]); const b = parseChileanNumber(orden[i][s]); const x = parseChileanNumber(orden[i][m]);
        if (!x) continue;
        rev++;
        if (Math.abs(b - (a + x)) <= 1) ok++;
      }
      return rev >= 4 ? ok / rev : 0;
    };
    return Math.max(medir(sample), medir([...sample].reverse())) >= 0.9;
  };
  for (const m of signadas) {
    const saldo = candidatas.find((s) => s !== m && cierra(m, s));
    const titulo = normalizarTitulo(header?.[m]);
    if (saldo == null && !/\b(monto|importe|valor|amount)\b/.test(titulo)) continue;
    // Hay una columna "Saldo" y no cierra con este monto: no se adivina.
    if (saldo == null && encabezadoConSaldo(header)) continue;
    // Glosa: la columna de texto más larga que no sea fecha, monto ni saldo.
    let desc = -1; let largo = 0;
    for (let col = 0; col < ncols; col++) {
      if (col === fecha || col === m || col === saldo) continue;
      const textos = sample.map((r) => String(r[col] ?? "").trim()).filter((t) => t && /[a-z]/i.test(t));
      const prom = textos.length ? textos.reduce((a, t) => a + t.length, 0) / textos.length : 0;
      if (prom > largo) { largo = prom; desc = col; }
    }
    if (desc < 0) return null;
    return { fecha, descripcion: desc, n_documento: -1, cargo: m, abono: m, saldo: saldo ?? -1, monto: m, tipo_flujo_col: -1 };
  }
  return null;
}

/** ¿|saldo[i] − saldo[i−1]| = monto[i] en ≥80% de los pares (algún orden)? */
function saldoExplicadoPor(sample: Row[], saldoCol: number, montoCol: number): boolean {
  const medir = (orden: Row[]) => {
    let ok = 0; let rev = 0;
    for (let i = 1; i < orden.length; i++) {
      const a = parseChileanNumber(orden[i - 1][saldoCol]);
      const b = parseChileanNumber(orden[i][saldoCol]);
      const m = Math.abs(parseChileanNumber(orden[i][montoCol]));
      if (!m || (!a && !b)) continue;
      rev++;
      if (Math.abs(Math.abs(b - a) - m) <= 1) ok++;
    }
    return rev >= 4 ? ok / rev : 0;
  };
  return Math.max(medir(sample), medir([...sample].reverse())) >= 0.8;
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
  // Ambos órdenes (hay bancos que listan lo más nuevo arriba) y banderas de una
  // letra (A/C de Santander): antes la regex solo aceptaba palabras y la
  // ecuación nunca contaba nada con "A"/"C" (2026-09-30).
  const medir = (orden: Row[]) => {
    let matches = 0;
    for (let i = 1; i < orden.length; i++) {
      const prevSaldo = parseChileanNumber(orden[i - 1][saldoCol]);
      const currSaldo = parseChileanNumber(orden[i][saldoCol]);
      const currMonto = Math.abs(parseChileanNumber(orden[i][montoCol]));
      if (!prevSaldo || !currSaldo || !currMonto) continue;
      const t = classifyTipoFlag(orden[i][tipoCol]);
      if (!t) continue;
      const expected = prevSaldo + (t === "ENTRADA" ? 1 : -1) * currMonto;
      // Tolerance: 10 CLP absolute for rounding
      if (Math.abs(currSaldo - expected) <= 10) matches++;
    }
    return matches;
  };
  return Math.max(medir(sample), medir([...sample].reverse()));
}

/**
 * Formato de fecha decidido por COLUMNA, como el de los números (adversarial-1
 * falla 5): "a/b/yyyy" con algún a > 12 → dd/mm; con algún b > 12 y ningún a > 12
 * → mm/dd; si ninguna celda distingue, dd/mm (Chile).
 */
export function formatoFechaDeColumna(rows: Row[], desde: number, col: number): AdapterConfig["date_format"] {
  let diaPrimero = false;
  let mesPrimero = false;
  let primera: string | null = null;
  for (let i = desde; i < rows.length; i++) {
    const v = rows[i]?.[col] as unknown;
    if (v == null || v instanceof Date || typeof v === "number") continue;
    const t = String(v).trim();
    if (!t) continue;
    primera ??= t;
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{4}$/);
    if (!m) continue;
    if (parseInt(m[1], 10) > 12) diaPrimero = true;
    if (parseInt(m[2], 10) > 12) mesPrimero = true;
  }
  if (mesPrimero && !diaPrimero) return "mm/dd/yyyy";
  return detectDateFormat(primera ?? "");
}

function detectDateFormat(sample: string): AdapterConfig["date_format"] {
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(sample)) return "yyyy-mm-dd";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) return "dd/mm/yyyy";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(sample)) return "dd-mm-yyyy";
  return "unknown";
}
