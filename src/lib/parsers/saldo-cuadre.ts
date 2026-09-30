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
  /** Filas cuya ecuación se pudo comprobar (todas menos la primera de la cadena). */
  revisadas: number;
  /** Filas que NO cierran al peso. */
  fallidas: number;
  /** Filas leídas sin saldo en la hoja (no se pueden comprobar una a una). */
  sinSaldo: number;
  /** ¿La lectura con cargo↔abono al revés TAMBIÉN cierra? (entonces nada prueba la dirección). */
  invertidaCuadra: boolean;
}

/**
 * La ecuación del saldo sobre LO LEÍDO (no sobre las celdas crudas): cada
 * movimiento leído, en el orden de la hoja o en el inverso, tiene que cerrar
 * saldo = saldo_anterior ± monto AL PESO. Una fila sin saldo (banco que imprime
 * el saldo solo al final del día) acumula su efecto hasta la siguiente fila con
 * saldo; si no hay una siguiente, queda sin comprobar.
 */
export function cuadreDeLectura(lines: ParsedLine[], rows: Row[], cfg: AdapterConfig): CuadreDeLectura {
  const col = cfg.columns.saldo;
  const tieneSaldo = (l: ParsedLine) => {
    if (col < 0 || typeof l.saldo !== "number" || !Number.isFinite(l.saldo)) return false;
    const celda = rows[(l.excel_row ?? 0) - 1]?.[col];
    return celda != null && String(celda).trim() !== "";
  };
  const medir = (orden: ParsedLine[], signo: 1 | -1) => {
    let prev: number | null = null;
    let pendiente = 0;
    let enEspera = 0;
    let revisadas = 0;
    let fallidas = 0;
    let sinComprobar = 0;
    for (const l of orden) {
      const efecto = signo * (l.tipo === "ENTRADA" ? l.monto : -l.monto);
      if (!tieneSaldo(l)) { pendiente += efecto; enEspera++; continue; }
      const s = l.saldo as number;
      if (prev === null) {
        sinComprobar += enEspera; // antes del primer saldo: nada con qué comparar
      } else {
        const filas = enEspera + 1;
        revisadas += filas;
        if (Math.abs(s - (prev + pendiente + efecto)) > TOLERANCIA_SELLO_PESOS) fallidas += filas;
      }
      prev = s; pendiente = 0; enEspera = 0;
    }
    sinComprobar += enEspera;
    return { revisadas, fallidas, sinComprobar };
  };
  const mejor = (signo: 1 | -1) => {
    const a = medir(lines, signo);
    const b = medir([...lines].reverse(), signo);
    return b.fallidas < a.fallidas || (b.fallidas === a.fallidas && b.sinComprobar < a.sinComprobar) ? b : a;
  };
  const normal = mejor(1);
  const invertida = mejor(-1);
  return {
    leidas: lines.length,
    revisadas: normal.revisadas,
    fallidas: normal.fallidas,
    sinSaldo: lines.filter((l) => !tieneSaldo(l)).length,
    invertidaCuadra: invertida.revisadas > 0 && invertida.fallidas === 0,
  };
}
