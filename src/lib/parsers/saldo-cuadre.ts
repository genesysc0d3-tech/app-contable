import type { AdapterConfig, ParsedLine, Row } from "./types";
import { parseChileanNumber } from "./apply";

/**
 * DOS tolerancias, dos trabajos (revisiones adversariales 2026-09-30):
 *   - "blanda" (1% del saldo o $100): sirve para ORIENTAR/ELEGIR columnas en la
 *     heurística, donde una celda rara no debe tumbar la elección.
 *   - "estricta" (±$1, solo redondeo): la única que puede SELLAR o CONFIRMAR.
 * Con la blanda, una pyme con saldo de $40 M y movimientos de $150 mil
 * "cuadraba" leída con cargo↔abono invertidos (2×monto < 1% del saldo).
 */
export type Tolerancia = "blanda" | "estricta";
export const TOLERANCIA_SELLO_PESOS = 1;
const tope = (esperado: number, t: Tolerancia) =>
  t === "estricta" ? TOLERANCIA_SELLO_PESOS : Math.max(100, Math.abs(esperado) * 0.01);

/**
 * ¿Cuadra el saldo corrido con esta asignación de cargo/abono?
 *
 * saldo[i] = saldo[i-1] + abono[i] − cargo[i], con 1% o $100 de tolerancia.
 * Se prueba en el orden de la hoja Y en el inverso: hay bancos que listan lo más
 * nuevo arriba (BCI "Movimientos Detallado", incidente LC 2026-09-26) y la
 * ecuación solo vale leída de lo más viejo a lo más nuevo. Devuelve el MEJOR de
 * los dos órdenes.
 *
 * Es la prueba determinista de la orientación: con cargo y abono invertidos la
 * ecuación falla en casi todas las filas (490/490 contra 24/490 en la cartola de
 * LC), así que no hace falta adivinar por la posición ni por el nombre.
 */
export function cuadreSaldo(
  filas: Row[],
  cargo: number,
  abono: number,
  saldo: number,
  tolerancia: Tolerancia = "blanda",
): { revisadas: number; fallidas: number } {
  const medir = (orden: Row[]) => {
    let prev: number | null = null;
    let revisadas = 0;
    let fallidas = 0;
    for (const r of orden) {
      // La columna da la dirección (un "-5.000" en Cargos es un cargo de 5.000);
      // el saldo sí va con signo (un sobregiro es negativo).
      const c = Math.abs(parseChileanNumber(r[cargo]));
      const a = Math.abs(parseChileanNumber(r[abono]));
      const s = parseChileanNumber(r[saldo]);
      if (!c && !a) continue;
      if (!s) continue;
      if (prev !== null) {
        const esperado = prev + a - c;
        revisadas++;
        if (Math.abs(s - esperado) > tope(esperado, tolerancia)) fallidas++;
      }
      prev = s;
    }
    return { revisadas, fallidas };
  };
  const tal = medir(filas);
  const inv = medir([...filas].reverse());
  const ratio = (x: { revisadas: number; fallidas: number }) => (x.revisadas ? x.fallidas / x.revisadas : 1);
  return ratio(inv) < ratio(tal) ? inv : tal;
}

/**
 * Igual que cuadreSaldo pero para single_col: UNA columna de monto y una
 * bandera que dice la dirección (A/C, Abono/Cargo…). Ambos órdenes.
 */
export function cuadreSaldoConBandera(
  filas: Row[],
  monto: number,
  bandera: number,
  saldo: number,
  clasificar: (v: unknown) => "ENTRADA" | "SALIDA" | null,
): { revisadas: number; fallidas: number } {
  const medir = (orden: Row[]) => {
    let prev: number | null = null;
    let revisadas = 0;
    let fallidas = 0;
    for (const r of orden) {
      const m = Math.abs(parseChileanNumber(r[monto]));
      const t = clasificar(r[bandera]);
      const s = parseChileanNumber(r[saldo]);
      if (!m || !t || !s) continue;
      if (prev !== null) {
        const esperado = prev + (t === "ENTRADA" ? m : -m);
        const tolerancia = Math.max(100, Math.abs(esperado) * 0.01);
        revisadas++;
        if (Math.abs(s - esperado) > tolerancia) fallidas++;
      }
      prev = s;
    }
    return { revisadas, fallidas };
  };
  const tal = medir(filas);
  const inv = medir([...filas].reverse());
  const ratio = (x: { revisadas: number; fallidas: number }) => (x.revisadas ? x.fallidas / x.revisadas : 1);
  return ratio(inv) < ratio(tal) ? inv : tal;
}

export interface CuadreDeLectura {
  /** Movimientos leídos. */
  leidas: number;
  /** Filas cuya ecuación se pudo comprobar (con saldo inicial conocido, TODAS). */
  revisadas: number;
  /** Filas que NO cierran al peso. */
  fallidas: number;
  /** Filas leídas sin saldo en la hoja (no se pueden comprobar una a una). */
  sinSaldo: number;
  /** ¿La lectura con cargo↔abono al revés TAMBIÉN cierra? (entonces nada prueba la dirección). */
  invertidaCuadra: boolean;
  /** ¿La PRIMERA fila se comprobó contra un saldo inicial (fila de arriba, resumen impreso)? */
  primeraComprobada: boolean;
  /** Sin saldo inicial: ¿la primera fila deja el saldo inicial en $0 (su monto ES su saldo)? */
  primeraDesdeCero: boolean;
  /** Diferencia (saldo impreso − esperado) de cada fila que no cierra. */
  saltos: number[];
  /** Monto de la fila de cada salto (mismo orden que `saltos`): un salto de ±2×monto delata cargo↔abono al revés. */
  montosSalto: number[];
}

/** Saldo numérico de la celda de saldo de una fila, o null. */
function saldoDeFila(rows: Row[], i: number, col: number): number | null {
  const v = rows[i]?.[col];
  if (v == null || String(v).trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const n = parseChileanNumber(v);
  return /\d/.test(String(v)) ? n : null;
}

/** Bloques de filas consecutivas con la misma fecha, cada uno al revés (orden intradía invertido). */
function invertirDentroDelDia(lines: ParsedLine[]): ParsedLine[] {
  const out: ParsedLine[] = [];
  let bloque: ParsedLine[] = [];
  for (const l of lines) {
    if (bloque.length && bloque[0].fecha !== l.fecha) { out.push(...bloque.reverse()); bloque = []; }
    bloque.push(l);
  }
  out.push(...bloque.reverse());
  return out;
}

/**
 * La ecuación del saldo sobre LO LEÍDO (no sobre las celdas crudas): cada
 * movimiento leído tiene que cerrar saldo = saldo_anterior ± monto AL PESO. Se
 * prueba en el orden de la hoja, en el inverso y con el orden DENTRO de cada día
 * invertido (bancos que listan los días ascendentes pero lo más nuevo arriba
 * dentro del día; vuelta 2, P3). Una fila sin saldo acumula su efecto hasta la
 * siguiente con saldo.
 *
 * La PRIMERA fila (vuelta 2, P1) se comprueba contra un saldo inicial: la fila
 * con saldo justo arriba del primer movimiento (o abajo del último, si la hoja
 * va de lo más nuevo a lo más viejo) o el saldo anterior del resumen impreso.
 */
export function cuadreDeLectura(lines: ParsedLine[], rows: Row[], cfg: AdapterConfig, saldoInicialImpreso: number | null = null): CuadreDeLectura {
  const col = cfg.columns.saldo;
  const tieneSaldo = (l: ParsedLine) => {
    if (col < 0 || typeof l.saldo !== "number" || !Number.isFinite(l.saldo)) return false;
    const celda = rows[(l.excel_row ?? 0) - 1]?.[col];
    return celda != null && String(celda).trim() !== "";
  };
  // Anclas de saldo inicial: arriba del primer movimiento de la hoja (orden
  // ascendente) o abajo del último (descendente).
  const filasLeidas = new Set(lines.map((l) => (l.excel_row ?? 0) - 1));
  const primeraFila = lines.length ? (lines[0].excel_row ?? 1) - 1 : 0;
  const ultimaFila = lines.length ? (lines[lines.length - 1].excel_row ?? 1) - 1 : 0;
  let antes: number | null = null;
  if (col >= 0) {
    // Hasta 3 filas arriba del primer movimiento: la fila "Saldo inicial" puede
    // haber quedado como fila de títulos del bloque (heurística); un título de
    // texto ("Saldo") no es un número y no cuenta.
    for (let i = primeraFila - 1; i >= Math.max(0, primeraFila - 3) && antes == null; i--) {
      if (!filasLeidas.has(i)) antes = saldoDeFila(rows, i, col);
    }
  }
  let despues: number | null = null;
  if (col >= 0) {
    for (let i = ultimaFila + 1; i < Math.min(rows.length, ultimaFila + 4) && despues == null; i++) {
      if (!filasLeidas.has(i)) despues = saldoDeFila(rows, i, col);
    }
  }
  const medir = (orden: ParsedLine[], signo: 1 | -1, inicial: number | null) => {
    let prev: number | null = inicial;
    let pendiente = 0;
    let enEspera = 0;
    let revisadas = 0;
    let fallidas = 0;
    let sinComprobar = 0;
    const saltos: number[] = [];
    const montosSalto: number[] = [];
    let primeraDesdeCero = false;
    let primera = true;
    for (const l of orden) {
      const efecto = signo * (l.tipo === "ENTRADA" ? l.monto : -l.monto);
      if (!tieneSaldo(l)) { pendiente += efecto; enEspera++; continue; }
      const s = l.saldo as number;
      if (prev === null) {
        sinComprobar += enEspera + 1; // antes del primer saldo: nada con qué comparar
        if (primera && enEspera === 0 && Math.abs(s - efecto) <= TOLERANCIA_SELLO_PESOS) primeraDesdeCero = true;
      } else {
        const filas = enEspera + 1;
        revisadas += filas;
        const salto = s - (prev + pendiente + efecto);
        if (Math.abs(salto) > TOLERANCIA_SELLO_PESOS) { fallidas += filas; saltos.push(salto); montosSalto.push(l.monto); }
      }
      primera = false;
      prev = s; pendiente = 0; enEspera = 0;
    }
    sinComprobar += enEspera;
    return { revisadas, fallidas, sinComprobar, saltos, montosSalto, primeraDesdeCero, conInicial: inicial != null };
  };
  const mejor = (signo: 1 | -1) => {
    const intradia = invertirDentroDelDia(lines);
    const ordenes: [ParsedLine[], number | null][] = [
      [lines, antes], [[...lines].reverse(), despues], [intradia, antes], [[...intradia].reverse(), despues],
    ];
    // La fila de saldo pegada al bloque es estructura (vale aunque delate un
    // error). El "saldo anterior" IMPRESO en un encabezado puede ser de otra
    // cosa: vale solo si cierra; si no, la primera queda "sin comprobar".
    const candidatos = ordenes.flatMap(([o, ancla]) => ancla != null
      ? [medir(o, signo, ancla)]
      : [medir(o, signo, saldoInicialImpreso), medir(o, signo, null)]);
    return candidatos.reduce((m, x) => (x.fallidas < m.fallidas || (x.fallidas === m.fallidas && x.sinComprobar < m.sinComprobar) ? x : m));
  };
  const normal = mejor(1);
  const invertida = mejor(-1);
  return {
    leidas: lines.length,
    revisadas: normal.revisadas,
    fallidas: normal.fallidas,
    sinSaldo: lines.filter((l) => !tieneSaldo(l)).length,
    invertidaCuadra: invertida.revisadas > 0 && invertida.fallidas === 0,
    primeraComprobada: normal.conInicial && normal.sinComprobar === 0,
    primeraDesdeCero: !normal.conInicial && normal.primeraDesdeCero,
    saltos: normal.saltos,
    montosSalto: normal.montosSalto,
  };
}
