// Normalización del tipo de venta según el EMISOR (la empresa), no el receptor.
//
// Un contribuyente EXENTO no puede emitir un DTE afecto (boleta/factura con IVA):
// su venta va como boleta/factura EXENTA (DTE 41/34, sin IVA). Este módulo mapea el
// tipo afecto propuesto a su equivalente exento GENÉRICO cuando la empresa es exenta.
//
// Genérico a propósito: el foco del producto es venta P2P de cripto, pero la app debe
// servir a cualquier contribuyente exento — así que el default es "exenta" (no
// "compraventa_crypto"). Si el LLM (OpenCode) o una regla detecta cripto/forex
// puntualmente, ese tipo específico ya es exento y NO se toca.
//
// Se aplica en el insert de propuestas_ia (processor.ts), único punto por donde pasan
// los 3 carriles (atajo template + Mistral + reglas), así que corrige badge/split/
// confirmación de una sola vez. Es PURO (sin I/O) para poder testearlo.
//
// NO toca: gasto_egreso / no_comercial (no son ventas), boleta_honorarios (BHE, va
// fuera de la app), ni los tipos que ya son exentos (compraventa_crypto, etc.).

const AFECTO_A_EXENTO: Record<string, string> = {
  boleta: "exenta",
  factura: "factura_exenta",
  factura_afecta: "factura_exenta",
};

/** Tipo de venta normalizado al emisor. Si la empresa es exenta y el tipo es afecto,
 *  devuelve su equivalente exento genérico; si no, devuelve el tipo tal cual. */
export function normalizarTipoPorEmisor(
  tipoBase: string,
  tipoContribuyenteEmpresa: string | null | undefined,
): string {
  if (tipoContribuyenteEmpresa !== "exento") return tipoBase;
  return AFECTO_A_EXENTO[tipoBase] ?? tipoBase;
}

/** ¿Esta propuesta es una venta que debe quedar EXENTA por ser la empresa exenta?
 *  (para forzar iva=0 y monto_neto=total de forma coherente con el tipo). */
export function esVentaExentaEmisor(
  tipoBase: string,
  tipoContribuyenteEmpresa: string | null | undefined,
): boolean {
  return tipoContribuyenteEmpresa === "exento" && tipoBase in AFECTO_A_EXENTO;
}
