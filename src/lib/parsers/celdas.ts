/**
 * Reglas de FORMA de celdas y columnas, compartidas por la heurística, el
 * lector (applyAdapter) y el censo independiente. Sin dependencias de las otras
 * capas para no crear ciclos de import.
 */

/**
 * ¿La celda parece una fecha? Cubre las TRES formas en que llega una fecha
 * desde XLSX (cellDates:true): Date nativo, serial de Excel (rango 2000-2099,
 * mismo criterio que apply.ts), o texto dd/mm/yyyy · yyyy-mm-dd. Antes solo
 * se aceptaba texto → una planilla con fechas REALES de Excel (el caso normal
 * de una planilla casera) era invisible para todos los detectores y caía a
 * la capa legacy → IA (bug cazado con la planilla M&E 2026-08-22).
 */
export function cellEsFecha(cell: string | number | null | undefined | Date): boolean {
  if (cell == null) return false;
  if (cell instanceof Date) return !Number.isNaN(cell.getTime());
  if (typeof cell === "number") return cell >= 36526 && cell <= 73050;
  const s = String(cell).trim();
  if (!s) return false;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(s)) return true;
  // Date ya serializado a string (p.ej. "2026-08-08 00:00:00" o ISO)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return true;
  // BancoEstado (incidente 2026-09-23): "20260923" en la cartola y "02/09" (sin
  // año) en la hoja Movimientos. Sin esto la hoja no parecía cartola y caía a la
  // IA, que inventaba la glosa y clasificaba por giro. Ventana de año acotada
  // para no confundir un N° de cuenta de 8 dígitos con una fecha.
  const m8 = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (m8) {
    const y = parseInt(m8[1], 10); const mm = parseInt(m8[2], 10); const dd = parseInt(m8[3], 10);
    return y >= 2015 && y <= new Date().getFullYear() + 1 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }
  const mSinAnio = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mSinAnio) {
    const dd = parseInt(mSinAnio[1], 10); const mm = parseInt(mSinAnio[2], 10);
    return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12;
  }
  return false;
}

/**
 * ¿La serie es un CORRELATIVO (N° de documento/operación: 5000, 5001, 5002… o
 * 900000, 900013, 900026…)? Paso constante entre vecinos en ≥80% de los pares.
 * Un saldo o un monto jamás avanza con paso fijo (Itaú sin títulos, 2026-09-30:
 * "N° Docto" se tomó como saldo). Mínimo 5 valores para opinar.
 */
export function esSerieCorrelativa(valores: number[]): boolean {
  const v = valores.filter((x) => Number.isFinite(x) && x !== 0);
  if (v.length < 5) return false;
  const pasos = new Map<number, number>();
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    pasos.set(d, (pasos.get(d) ?? 0) + 1);
  }
  let mejor = 0;
  let paso = 0;
  for (const [d, n] of pasos) if (n > mejor) { mejor = n; paso = d; }
  return paso !== 0 && mejor / (v.length - 1) >= 0.8;
}

/**
 * ¿La columna es de IDENTIFICADORES (texto de puros dígitos, mismo largo ≥6, o
 * con cero a la izquierda)? Un monto nunca va con cero a la izquierda ni con
 * largo fijo en todas las filas.
 */
export function esColumnaDeCodigos(celdas: unknown[]): boolean {
  const vals: string[] = [];
  let noVacias = 0;
  for (const v of celdas) {
    if (v == null || String(v).trim() === "") continue;
    noVacias++;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) vals.push(v.trim());
  }
  if (noVacias < 3 || vals.length / noVacias < 0.8) return false;
  if (vals.some((v) => v.length > 1 && v.startsWith("0"))) return true;
  const len = vals[0].length;
  return len >= 6 && vals.every((v) => v.length === len);
}
