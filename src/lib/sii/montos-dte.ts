/**
 * Derivación de montos de un DTE de VENTA a partir del total.
 *
 * El total es el dato duro: es lo que entró a la cuenta. El neto y el IVA se
 * derivan de ahí, nunca al revés.
 *
 * `iva = total - neto` (no `round(neto * 0,19)`) A PROPÓSITO: así
 * `neto + iva === total` SIEMPRE, sin pesos que se pierden en el redondeo. La
 * factura tiene su propia función (`derivarMontosFactura`), que además avisa
 * cuando el SII va a emitir por un peso de diferencia, porque allá el portal
 * recibe el neto y recalcula. Acá el documento se emite con los tres números
 * que devolvemos, así que tienen que cuadrar entre ellos.
 *
 * Punto único (2026-09-05): esta cuenta estaba copiada en el editor ampliado y
 * en la tarjeta de revisión, y ahora también la necesita el cambio de tipo en
 * bloque. Tres copias de la misma aritmética es una discrepancia esperando
 * ocurrir.
 */
export function derivarMontosDte(total: number, afecta: boolean): { neto: number; iva: number } {
  const t = Math.round(total);
  if (!afecta) return { neto: t, iva: 0 };
  const neto = Math.round(t / 1.19);
  return { neto, iva: t - neto };
}
