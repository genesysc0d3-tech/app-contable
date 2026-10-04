/**
 * DESTINO ÚNICO de una propuesta: ¿este movimiento es una venta, y de qué carril?
 *
 * ── Reglas tributarias de massDTE ──────────────────────────────────────────────
 * Versión: 2026-10-04.1
 * Dueño:   Matías (contador). Pendiente validar: arriendo y comisión (ver abajo).
 * Regla:   ante la duda → "preguntar" (requiere acción del cliente), NUNCA adivinar.
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Antes había 7 listas que no coincidían (processor TIPOS_VENTA_AUTO, TIPOS_EMITIBLES,
 * pendientes-emision, emitir-lote, tipoMeta de Check, mesa-data, editor). El limbo
 * de arriendo/comisión: nacía 41 por el cable automático, Check lo pintaba "Boleta
 * exenta", la cartola lo contaba gasto y Emitir lo mostraba y lo rechazaba. Este
 * archivo es la ÚNICA decisión; el resto la importa (test de censo:
 * destino.censo.test.ts se pone rojo si alguien vuelve a escribir una lista suelta).
 *
 * Cambiar una regla tributaria = cambiar ESTE archivo (y subir la versión).
 */

export type Destino = "boleta" | "factura" | "no_es_venta" | "preguntar";

/** Versión de las reglas tributarias (subirla al cambiar cualquier tabla de abajo). */
export const VERSION_REGLAS_TRIBUTARIAS = "2026-10-04.1";

/**
 * Tabla canónica: CADA tipo_propuesto válido (los del CHECK de propuestas_ia) con su
 * destino. Un tipo nuevo sin destino no compila (Record exhaustivo).
 */
const DESTINO_POR_TIPO = {
  // ── Ventas por BOLETA (39/41) ──
  boleta: "boleta",
  exenta: "boleta",
  transferencia_p2p: "boleta", // exenta por ley (Of. SII 963/2018)
  compraventa_crypto: "boleta", // exenta por ley
  operacion_forex: "boleta", // exenta por ley

  // ── Ventas por FACTURA (33/34) ──
  factura: "factura",
  factura_afecta: "factura",
  factura_exenta: "factura",

  // ── NO son venta: no se boletean ni se facturan desde la app ──
  gasto: "no_es_venta",
  gasto_egreso: "no_es_venta",
  no_comercial: "no_es_venta",
  ignorar: "no_es_venta",
  registro_crypto: "no_es_venta",
  impuesto: "no_es_venta",
  cotizacion_previsional: "no_es_venta",
  remuneracion: "no_es_venta",
  dividendo: "no_es_venta",
  interes: "no_es_venta",
  retencion: "no_es_venta",
  donacion: "no_es_venta",
  // Honorarios (BHE, Segunda Categoría, Ley 21.133): se emiten en sii.cl, FUERA de
  // la emisión DTE de la app. Para el flujo de boletas/facturas no es una venta.
  boleta_honorarios: "no_es_venta",

  // ── PREGUNTAR: la respuesta depende de hechos que la app no ve ──
  // Pendiente validar con Matías (afirmaciones enviadas 2026-10-04):
  //  - arriendo sin amoblar → exenta; amoblado / con instalaciones → afecta.
  //  - comisión por intermediar → afecta (neto + IVA).
  // Hasta que conteste: "¿Es venta? · decide tú" en Check. Nunca nace con tipo_dte.
  arriendo: "preguntar",
  comision: "preguntar",
} as const satisfies Record<string, Destino>;

export type TipoPropuesto = keyof typeof DESTINO_POR_TIPO;

/** Todos los tipo_propuesto válidos (antes VALID_TIPOS en processor.ts). */
export const TODOS_LOS_TIPOS: readonly TipoPropuesto[] = Object.keys(DESTINO_POR_TIPO) as TipoPropuesto[];

const TODOS_SET: ReadonlySet<string> = new Set(TODOS_LOS_TIPOS);

export function esTipoValido(tipo: string | null | undefined): tipo is TipoPropuesto {
  return !!tipo && TODOS_SET.has(tipo);
}

/**
 * Destino de un tipo_propuesto. Un tipo desconocido (o vacío) → "preguntar": ante la
 * duda, requiere acción; nunca se adivina venta ni no-venta.
 */
export function destino(tipo: string | null | undefined): Destino {
  if (!tipo) return "preguntar";
  return esTipoValido(tipo) ? DESTINO_POR_TIPO[tipo] : "preguntar";
}

/** ¿Es una venta que la app emite (boleta o factura)? */
export function esVentaEmitible(tipo: string | null | undefined): boolean {
  const d = destino(tipo);
  return d === "boleta" || d === "factura";
}

/** tipo_propuesto que representan una venta EXENTA de IVA (41 / 34). */
export const TIPOS_PROPUESTA_EXENTOS = [
  "exenta",
  "factura_exenta",
  "compraventa_crypto",
  "transferencia_p2p",
  "operacion_forex",
] as const satisfies readonly TipoPropuesto[];

const EXENTOS_SET: ReadonlySet<string> = new Set(TIPOS_PROPUESTA_EXENTOS);

/** Venta exenta POR SU TIPO (la categoría manda sobre la heurística del giro). */
export function esExentoPorTipo(tipo: string | null | undefined): boolean {
  return !!tipo && EXENTOS_SET.has(tipo);
}

/** Venta afecta POR SU TIPO: venta emitible y no exenta (boleta, factura, factura_afecta). */
export function esAfectoPorTipo(tipo: string | null | undefined): boolean {
  return esVentaEmitible(tipo) && !esExentoPorTipo(tipo);
}

/** Tipos cuyo destino es X (derivado de la tabla, en el orden canónico). */
export function tiposConDestino(d: Destino): TipoPropuesto[] {
  return TODOS_LOS_TIPOS.filter((t) => DESTINO_POR_TIPO[t] === d);
}

/**
 * tipo_propuesto que representan un INGRESO boletificable (una boleta de venta).
 * Consumido por la cola de pendientes y el gate del lote (emitir-lote).
 */
export const TIPOS_EMITIBLES: string[] = tiposConDestino("boleta");

/** Tipos que esperan la decisión del cliente ("¿Es venta?"). */
export const TIPOS_POR_DECIDIR: string[] = tiposConDestino("preguntar");

/** Mensaje único para un ingreso "por decidir" (Emitir y el lote lo muestran igual). */
export const MSG_TIPO_POR_DECIDIR = "Dinos en Check si este ingreso es venta exenta, afecta o no es venta.";
