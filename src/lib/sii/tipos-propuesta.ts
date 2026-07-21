/**
 * Fuente ÚNICA de verdad para los tipos de propuesta IA.
 *
 * Antes esta lista estaba copiada a mano en varios componentes y ya había
 * divergido: VeredictoCartola omitía `factura_exenta` y `transferencia_p2p`, así
 * que contaba esas ventas como afectas en el desglose de la confirmación. Un solo
 * lugar evita que se vuelvan a desincronizar.
 */

/** tipo_propuesto que representan una venta EXENTA de IVA (boleta tipo 41). */
export const TIPOS_PROPUESTA_EXENTOS = [
  "exenta",
  "factura_exenta",
  "compraventa_crypto",
  "transferencia_p2p",
  "operacion_forex",
] as const;

export function esTipoPropuestoExento(tipo: string | null | undefined): boolean {
  return !!tipo && (TIPOS_PROPUESTA_EXENTOS as readonly string[]).includes(tipo);
}

/**
 * tipo_propuesto que representan un INGRESO boletificable (una boleta de venta).
 * Facturas, gastos, no comerciales y honorarios quedan fuera. Consumido por la cola
 * de pendientes (getPendientesEmision) y por el gate del lote (emitir-lote): un solo
 * lugar para que ambos filtren exactamente los mismos tipos.
 */
export const TIPOS_EMITIBLES = ["boleta", "exenta", "transferencia_p2p", "compraventa_crypto", "operacion_forex"];
