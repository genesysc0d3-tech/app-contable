/**
 * Motor de correlación (F3) — núcleo PURO y testeable, como [[emision-decision]].
 *
 * Decide si un movimiento nuevo (p. ej. el abono en CLP del banco/MP) se UNE a un
 * candidato de OTRA fuente (p. ej. la orden de Binance) para formar una sola
 * transacción = una boleta, o si crea una nueva, o si hay que REVISAR.
 *
 * Principio (rápido + fiable): unir solo con confianza; ante duda, revisar; nunca
 * adivinar en silencio. Reglas clave:
 *  - NUNCA une dos movimientos de la MISMA fuente (dos abonos del mismo banco el
 *    mismo día son ventas reales distintas, no duplicados).
 *  - Señal fuerte (código de operación compartido) → une aunque haya varios.
 *  - Sin código: un único candidato de OTRA fuente con monto EXACTO + (si hay hora)
 *    dentro de la ventana → une. Monto solo aproximado (banda por fee) o varios
 *    candidatos → revisar.
 *
 * El cableado (buscar candidatos en la DB, asignar transaccion_id, marcar revisar)
 * es F3.2 — esta función no toca la DB.
 */

export interface MovimientoCorrelacionable {
  id: string;
  /** Canal/fuente de datos: banco | mercadopago | binance | telegram | ... */
  fuente: string;
  /** Monto en CLP (lo que sigue a la plata). */
  montoClp: number;
  /** Fecha en día de Chile (YYYY-MM-DD). */
  fecha: string;
  /** Hora HH:mm (día de Chile) si la fuente la trae; si no, null. */
  hora?: string | null;
  /** Identificador de contraparte (nick/nombre), opcional. */
  contraparte?: string | null;
  /** Código de operación/orden (Binance order, código de transferencia): señal fuerte. */
  codigoOperacion?: string | null;
}

export type DecisionCorrelacion =
  | { accion: "unir"; conId: string; razon: string }
  | { accion: "nueva"; razon: string }
  | { accion: "revisar"; razon: string; candidatos: string[] };

export interface CtxCorrelacion {
  /** Ventana en minutos cuando ambos movimientos tienen hora (default 30). */
  ventanaMinutos?: number;
  /** Banda absoluta de monto por comisión/fee (default 0 = exacto). */
  toleranciaMonto?: number;
  /** Banda relativa de monto por fee, fracción 0..1 (default 0). */
  toleranciaPct?: number;
}

function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Decide la correlación de `nuevo` contra `candidatos` (movimientos aún sin cruzar).
 * Pura: mismas entradas → misma salida.
 */
export function evaluarCorrelacion(
  nuevo: MovimientoCorrelacionable,
  candidatos: MovimientoCorrelacionable[],
  ctx: CtxCorrelacion = {},
): DecisionCorrelacion {
  const ventana = ctx.ventanaMinutos ?? 30;
  const tolAbs = Math.max(0, ctx.toleranciaMonto ?? 0);
  const tolPct = Math.max(0, ctx.toleranciaPct ?? 0);

  const banda = (montoCandidato: number) => Math.max(tolAbs, Math.round(montoCandidato * tolPct));
  const montoExacto = (c: MovimientoCorrelacionable) => Math.round(c.montoClp) === Math.round(nuevo.montoClp);
  const montoEnBanda = (c: MovimientoCorrelacionable) => Math.abs(Math.round(c.montoClp) - Math.round(nuevo.montoClp)) <= banda(c.montoClp);
  const tiempoCalza = (c: MovimientoCorrelacionable) => {
    if (c.fecha !== nuevo.fecha) return false;
    const a = nuevo.hora ? aMinutos(nuevo.hora) : null;
    const b = c.hora ? aMinutos(c.hora) : null;
    if (a !== null && b !== null) return Math.abs(a - b) <= ventana;
    return true; // sin hora en alguno → basta el mismo día
  };

  // Elegibles: OTRA fuente (nunca la misma) + mismo día/ventana + monto en banda.
  const elegibles = candidatos.filter(
    (c) => c.id !== nuevo.id && c.fuente !== nuevo.fuente && tiempoCalza(c) && montoEnBanda(c),
  );
  if (elegibles.length === 0) {
    return { accion: "nueva", razon: "sin candidato de otra fuente con mismo monto + ventana de tiempo" };
  }

  // Señal fuerte: código de operación compartido.
  if (nuevo.codigoOperacion) {
    const porCodigo = elegibles.filter((c) => c.codigoOperacion && c.codigoOperacion === nuevo.codigoOperacion);
    if (porCodigo.length === 1) return { accion: "unir", conId: porCodigo[0].id, razon: "código de operación coincide" };
    if (porCodigo.length > 1) return { accion: "revisar", razon: "varios candidatos con el mismo código de operación", candidatos: porCodigo.map((c) => c.id) };
  }

  // Sin código: el monto debe ser EXACTO para unir solo.
  const exactos = elegibles.filter(montoExacto);
  if (exactos.length === 1) {
    return { accion: "unir", conId: exactos[0].id, razon: "único candidato de otra fuente con monto exacto + ventana" };
  }
  if (exactos.length > 1) {
    return { accion: "revisar", razon: "varios candidatos con monto exacto", candidatos: exactos.map((c) => c.id) };
  }
  // Solo coincidencias aproximadas (banda por fee) → no unir solo, revisar.
  return { accion: "revisar", razon: "candidato(s) con monto aproximado (no exacto)", candidatos: elegibles.map((c) => c.id) };
}
