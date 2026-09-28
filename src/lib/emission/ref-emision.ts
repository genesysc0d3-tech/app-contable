// ID interno de emisión "R-XXX-XXX" (2026-09-28). Para la clienta y soporte; NO se
// imprime en la boleta del SII ni en la personalizada. Lo GENERA la base
// (emision_ref_nueva, migración 20260928120000_emision_refs.sql); acá solo se valida
// y normaliza lo que alguien escribe en el buscador. El dígito de control (Luhn
// mod 24) es el mismo de la función SQL: si cambia uno, cambian los dos.

export const ALFABETO_REF = "23456789BCDFGHJKMNPRSTXZ";
const N = ALFABETO_REF.length; // 24

/** Carácter de control de un cuerpo de 5 caracteres (Luhn mod N). null si hay un carácter inválido. */
export function controlRef(cuerpo: string): string | null {
  if (cuerpo.length !== 5) return null;
  let factor = 2;
  let suma = 0;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    const idx = ALFABETO_REF.indexOf(cuerpo[i]);
    if (idx < 0) return null;
    let addend = factor * idx;
    addend = Math.floor(addend / N) + (addend % N);
    suma += addend;
    factor = factor === 2 ? 1 : 2;
  }
  return ALFABETO_REF[(N - (suma % N)) % N];
}

/** Arma "R-ABC-DE?" a partir de 5 caracteres (lo que hace la base). */
export function formatoRef(cuerpo: string): string | null {
  const c = controlRef(cuerpo);
  return c ? `R-${cuerpo.slice(0, 3)}-${cuerpo.slice(3, 5)}${c}` : null;
}

/**
 * Normaliza lo que alguien tipea o dicta: mayúsculas, sin espacios ni guiones, con o
 * sin la "R". Devuelve la forma canónica "R-XXX-XXX" o null si no tiene forma de ref.
 */
export function normalizarRef(entrada: string): string | null {
  const limpio = entrada.toUpperCase().replace(/[\s\-.]/g, "");
  const sinR = limpio.startsWith("R") && limpio.length === 7 ? limpio.slice(1) : limpio;
  if (sinR.length !== 6) return null;
  if ([...sinR].some((ch) => !ALFABETO_REF.includes(ch))) return null;
  return `R-${sinR.slice(0, 3)}-${sinR.slice(3)}`;
}

/** ¿El dígito de control calza? Detecta toda letra cambiada y casi toda inversión de dos vecinas. */
export function refValida(ref: string): boolean {
  const n = normalizarRef(ref);
  if (!n) return false;
  const cuerpo = n.slice(2, 5) + n.slice(6, 8);
  return controlRef(cuerpo) === n[8];
}
