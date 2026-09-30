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
const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
/**
 * Fecha con el MES EN TEXTO (vuelta 2, P5): "05-SEP-2026", "05-Ago-2026",
 * "5 dic 2025", "05/sept./2026" (español o inglés, 3+ letras). null si no calza.
 */
export function fechaConMesEnTexto(s: string): { y: number; m: number; d: number } | null {
  const x = s.trim().match(/^(\d{1,2})[\s\-\/.]+([a-záéíóú]{3,10})\.?[\s\-\/.]+(\d{4})$/i);
  if (!x) return null;
  const m = MESES[x[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3)];
  if (!m) return null;
  return { y: parseInt(x[3], 10), m, d: parseInt(x[1], 10) };
}

export function cellEsFecha(cell: string | number | null | undefined | Date): boolean {
  if (cell == null) return false;
  if (cell instanceof Date) return !Number.isNaN(cell.getTime());
  if (typeof cell === "number") return cell >= 36526 && cell <= 73050;
  const s = String(cell).trim();
  if (!s) return false;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(s)) return true;
  // Date ya serializado a string (p.ej. "2026-08-08 00:00:00" o ISO)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return true;
  if (fechaConMesEnTexto(s)) return true;
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
  // Paso chico (1, 13…): un N° correlativo. Montos con paso fijo grande (1.000,
  // 10.000) aparecen en planillas de prueba y en cuotas: no se tocan.
  return paso !== 0 && Math.abs(paso) <= 100 && mejor / (v.length - 1) >= 0.8;
}

/**
 * ¿La columna es un N° CORRELATIVO? Texto de puros dígitos (así exportan los
 * bancos el N° de documento/operación: "5000", "900013") en ≥80% de las celdas
 * y con paso fijo chico (esSerieCorrelativa). Los montos tipados como número no
 * entran: una planilla de prueba con 20.000, 20.001… sigue siendo plata.
 */
export function esColumnaCorrelativa(celdas: unknown[]): boolean {
  const nums: number[] = [];
  let noVacias = 0;
  for (const v of celdas) {
    if (v == null || String(v).trim() === "") continue;
    noVacias++;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) nums.push(parseInt(v.trim(), 10));
  }
  return noVacias >= 5 && nums.length / noVacias >= 0.8 && esSerieCorrelativa(nums);
}

/**
 * ¿La columna es de CÓDIGOS con cero a la izquierda ("0900013")? Un monto nunca
 * va con cero a la izquierda.
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
  return vals.some((v) => v.length > 1 && v.startsWith("0"));
}
