// Guard tributario: un contribuyente EXENTO no puede emitir una boleta AFECTA (39).
//
// La boleta afecta genera débito fiscal (IVA 19%); un emisor exento no está
// habilitado para cobrarlo. El carril MOCK ya normaliza silenciosamente
// (exento → 41), pero en el carril REAL normalizar en el server dejaría la UI
// mostrando "Afecta" mientras emite 41 → descuadre y confusión. Por eso el carril
// real RECHAZA (fail-closed) y enruta a Check para que el humano corrija el tipo.
//
// Nombre deliberadamente distinto de `normalizarTipoPorEmisor` (src/lib/ai/tipo-emisor.ts),
// que opera sobre strings de clasificación ('boleta'→'exenta'); este opera sobre el
// tipo DTE numérico ya decidido (39/41) y es un guard, no un normalizador.

export type TipoDteEmisorGuard =
  | { ok: true }
  | { ok: false; code: "EMISOR_EXENTO_NO_AFECTA" };

/**
 * Rechaza SOLO las combinaciones imposibles: emisor exento + documento AFECTO
 * (boleta 39 o factura 33 — ambos generan débito fiscal que un exento no puede
 * cobrar). `tipoContribuyente` normaliza a minúsculas; solo el literal "exento"
 * bloquea. 'auto' / 'afecto' / null pasan (auto NO implica exento — la app es
 * amplia). Los tipos exentos (41, 34) pasan siempre.
 */
export function guardTipoDteEmisor(
  tipoDte: 33 | 34 | 39 | 41,
  tipoContribuyente: string | null | undefined,
): TipoDteEmisorGuard {
  const esExento = (tipoContribuyente ?? "").trim().toLowerCase() === "exento";
  if (esExento && (tipoDte === 39 || tipoDte === 33)) {
    return { ok: false, code: "EMISOR_EXENTO_NO_AFECTA" };
  }
  return { ok: true };
}
