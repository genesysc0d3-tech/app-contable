/**
 * Métodos de pago del modal de e-Boleta del SII.
 *
 * Vive fuera de las server actions a propósito: un archivo "use server" solo
 * puede exportar funciones async — exportar la constante desde ahí la convierte
 * en una referencia de servidor y revienta en el cliente al usarla ("map is not
 * a function", pantalla 500).
 *
 * El worker de la extensión los busca por texto en el selector del portal, con
 * match flexible ("Transferencia" calza con "Transferencia Electrónica"), así
 * que estos rótulos viajan tal cual en el job.
 */
export const MEDIOS_PAGO_SII = [
  "Efectivo",
  "Transferencia",
  "Tarjeta de débito",
  "Tarjeta de crédito",
  "Cheque",
] as const;

export type MedioPagoSii = (typeof MEDIOS_PAGO_SII)[number];

export function esMedioPagoValido(valor: string): valor is MedioPagoSii {
  return (MEDIOS_PAGO_SII as readonly string[]).includes(valor);
}
