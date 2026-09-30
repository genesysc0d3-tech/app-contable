import type { Row } from "./types";
import { parseChileanNumber } from "./apply";

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
