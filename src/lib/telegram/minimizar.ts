import { createVault, tokenizeForAI } from "@/lib/ai/tokenize";

/**
 * Minimización de lo que el bot MUESTRA en el chat de Telegram.
 *
 * Telegram no ofrece contrato de tratamiento de datos: todo lo que el bot
 * escribe queda en sus servidores. Por eso el bot nunca devuelve la identidad
 * completa de un tercero. Los nombres van en iniciales, los RUT y las cuentas
 * enmascarados, y los correos y teléfonos fuera. El cliente igual reconoce
 * de quién se trata ("P. R.", RUT terminado en 678-9), y el detalle completo
 * está en massDTE.
 */

const FORMA_JURIDICA_RE = /\s*\b(spa|s\.a\.?|ltda\.?|limitada|eirl|e\.i\.r\.l\.?)\s*$/i;
const CONECTORES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "van", "von"]);

/** "Pedro Rojas Soto" → "P. R. S."; "Juan Pérez EIRL" → "J. P. EIRL". */
export function iniciales(nombre: string | null | undefined): string {
  const limpio = String(nombre ?? "").trim();
  if (!limpio) return "";
  const forma = limpio.match(FORMA_JURIDICA_RE);
  const base = forma ? limpio.slice(0, forma.index).trim().replace(/[,\s]+$/, "") : limpio;
  const letras = base
    .split(/[\s.]+/)
    .filter((p) => p && !CONECTORES.has(p.toLowerCase()) && /\p{L}/u.test(p))
    .map((p) => `${p.match(/\p{L}/u)![0].toUpperCase()}.`);
  const sufijo = forma ? ` ${forma[1]}` : "";
  return (letras.join(" ") + sufijo).trim();
}

/** "12.345.678-9" → "••.•••.678-9": se reconoce sin exponer el RUT entero. */
export function enmascararRut(rut: string | null | undefined): string {
  const limpio = String(rut ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 5) return limpio ? "••••" : "";
  const dv = limpio.slice(-1);
  const cuerpo = limpio.slice(0, -1);
  return `••.•••.${cuerpo.slice(-3)}-${dv}`;
}

/** Nº de cuenta → últimos 4 dígitos. */
export function enmascararCuenta(cuenta: string | null | undefined): string {
  const digitos = String(cuenta ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  return digitos.length <= 4 ? "••••" : `••••${digitos.slice(-4)}`;
}

/**
 * Texto libre (glosa, detalle, mensaje del comprobante) con la identidad de
 * terceros en iniciales. Reusa el detector de la seudonimización de IA
 * (tokenizeForAI): la misma regla decide qué es una persona.
 */
export function minimizarTexto(texto: string | null | undefined): string {
  const vault = createVault();
  const tokenizado = tokenizeForAI(texto, vault);
  return tokenizado
    .replace(/\bPER_\d+\b/g, (tok) => {
      const real = vault.toReal.get(tok);
      if (real?.nombre) return iniciales(real.nombre);
      if (real?.rut) return `RUT ${enmascararRut(real.rut)}`;
      return "(tercero)";
    })
    .replace(/\[CORREO\]/g, "(correo)")
    .replace(/\[TEL\]/g, "(teléfono)")
    .replace(/\[NUM\]/g, "••••");
}
