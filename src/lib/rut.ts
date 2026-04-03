/**
 * Validación y formateo de RUT chileno.
 */

/** Remove dots and dashes, uppercase K */
function clean(rut: string): string {
  return rut.replace(/[.\-\s]/g, "").toUpperCase();
}

/** Validate Chilean RUT using modulo 11 algorithm */
export function validarRut(rut: string): boolean {
  const cleaned = clean(rut);
  if (cleaned.length < 2) return false;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const expectedDv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);

  return dv === expectedDv;
}

/** Format RUT as XX.XXX.XXX-X */
export function formatRut(rut: string): string {
  const cleaned = clean(rut);
  if (cleaned.length < 2) return rut;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}
