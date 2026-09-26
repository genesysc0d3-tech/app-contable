import type { Row } from "./types";

/**
 * Vocabulario de encabezados de cartolas chilenas. UNA sola fuente para las
 * capas que miran títulos (plantilla, nombres, heurística): antes cada una tenía
 * su propia lista y se contradecían (2026-09-26, revisión adversarial).
 */

/** Normaliza un título: minúsculas, sin tildes, espacios colapsados. */
export function normalizarTitulo(c: unknown): string {
  return String(c ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Columnas que dicen que la plata SALE (cargos). */
export const RE_SALIDA = /\bcargos?\b|\begresos?\b|\bdebe\b|\bdebitos?\b|\bgiros?\b|\bsalidas?\b|\bcheques?\b|\(\s*-\s*\)/;
/** Columnas que dicen que la plata ENTRA (abonos). */
export const RE_ENTRADA = /\babonos?\b|\bingresos?\b|\bhaber\b|\bcreditos?\b|\bdepositos?\b|\bentradas?\b|\(\s*\+\s*\)/;
/** Columna de saldo corrido. */
export const RE_SALDO = /\bsaldo\b/;

/** ¿La fila de títulos es de una cartola BANCARIA (trae columnas de plata del banco)? */
export function encabezadoBancario(fila: Row | undefined): boolean {
  if (!fila) return false;
  return fila.some((c) => {
    const t = normalizarTitulo(c);
    return !!t && (RE_SALIDA.test(t) || RE_ENTRADA.test(t) || RE_SALDO.test(t));
  });
}

/**
 * ¿Algún título habla de plata que SALE? Si sí, la planilla NO puede leerse como
 * "todo entrada": un egreso se convertiría en propuesta de boleta.
 */
export function encabezadoConSalidas(fila: Row | undefined): boolean {
  if (!fila) return false;
  return fila.some((c) => RE_SALIDA.test(normalizarTitulo(c)));
}

/** ¿Algún título es un saldo corrido? */
export function encabezadoConSaldo(fila: Row | undefined): boolean {
  if (!fila) return false;
  return fila.some((c) => RE_SALDO.test(normalizarTitulo(c)));
}
