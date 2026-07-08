// RUT chileno — normalización canónica + validación de dígito verificador (módulo 11).
//
// Punto ÚNICO de verdad para comparar RUT de emisor en la extensión. La regla de oro
// del emisor ("no es permitido equivocarse") depende de que estas funciones sean
// EXACTAS: la comparación es siempre string-igual sobre la forma canónica "CUERPO-DV",
// nunca substring. Este módulo es ESM (lo importan background.js / sii-local.js). El
// content-script sii-worker.js NO puede importar ESM: mantiene un espejo inline con la
// MISMA lógica y los MISMOS vectores de test.

/**
 * Normaliza cualquier forma de RUT a la canónica "CUERPO-DV" (sin puntos, con guion,
 * DV en mayúscula). Devuelve null si no es una forma de RUT plausible.
 * Acepta: "76.269.769-6", "76269769-6", "762697696", "12.345.678-k", etc.
 */
export function normalizeRut(value) {
  if (value == null) return null;
  let s = String(value).trim().toUpperCase().replace(/[^0-9K]/g, "");
  if (s.length < 2) return null; // mínimo cuerpo(1) + DV(1)
  const dv = s.slice(-1);
  let cuerpo = s.slice(0, -1);
  if (!/^[0-9]+$/.test(cuerpo)) return null; // el cuerpo es solo dígitos; K solo puede ser DV
  cuerpo = cuerpo.replace(/^0+/, "") || "0"; // sin ceros a la izquierda, pero no vacío
  if (cuerpo.length < 1 || cuerpo.length > 8) return null; // RUT chileno: 1..8 dígitos de cuerpo
  if (!/^[0-9K]$/.test(dv)) return null;
  return cuerpo + "-" + dv;
}

/** Calcula el dígito verificador (módulo 11) del cuerpo (string de dígitos). */
export function computeDv(cuerpo) {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i -= 1) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/** true solo si el RUT normaliza a una forma válida Y su DV declarado == el calculado. */
export function isRutValido(value) {
  const canon = normalizeRut(value);
  if (canon == null) return false;
  const idx = canon.lastIndexOf("-");
  const cuerpo = canon.slice(0, idx);
  const dv = canon.slice(idx + 1);
  return computeDv(cuerpo) === dv;
}

/**
 * Igualdad ESTRICTA de dos RUT — la ÚNICA comparación permitida al matchear el emisor.
 * Compara la forma canónica completa (cuerpo + DV); nunca substring, nunca includes.
 */
export function rutIguales(a, b) {
  const ca = normalizeRut(a);
  const cb = normalizeRut(b);
  return ca != null && cb != null && ca === cb;
}

/**
 * Extrae los RUT presentes en un texto (opción de lista, región del selector) y los
 * devuelve normalizados y deduplicados. Tolerante a con/sin puntos y con/sin guion.
 * Devuelve [] si no hay ninguno legible — quien llama DEBE tratar [] donde se espera un
 * emisor como "no legible → abortar" (nunca fail-open).
 */
export function extractRutTokens(text) {
  if (text == null) return [];
  const out = [];
  const seen = new Set();
  const re = /\b\d{1,2}(?:\.?\d{3}){2}\s*-?\s*[0-9kK]\b/g;
  const matches = String(text).match(re) || [];
  for (const m of matches) {
    const canon = normalizeRut(m);
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}
