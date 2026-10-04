/**
 * SELLO DE DECISIÓN sobre propuestas_ia (Fase 1 del plan del clasificador:
 * medir antes de mover — docs/plan-clasificador-cirujano-2026-10-03.md).
 *
 * Cada escritura a propuestas_ia lleva, en el MISMO UPDATE, quién decidió, por qué
 * canal y en qué gesto (lote). La base (migración 20261004140000) copia antes/
 * después a `propuesta_decisiones` con un trigger: atómico y sin viajes extra.
 * Una escritura que no sella queda `sin_sello` (lo marca el trigger): por eso un
 * test estático (escrituras-propuestas.test.ts) exige `sello(` en cada .update().
 *
 * Lote = UN uuid por GESTO completo (todos los trozos de 50 comparten el mismo), y
 * lote_n = cuántas filas pidió el gesto (no el trozo). Así "aprobó 300 de una" se
 * distingue de "aprobó 1 mirándola".
 *
 * La lista de canales es CERRADA y vive también en el CHECK de la migración.
 */

export const CANALES_DECISION = [
  "check_fila",      // acción sobre UNA fila desde la lista (sin abrir el detalle)
  "check_detalle",   // acción con el detalle abierto (editor, veredicto, glosa)
  "check_lote",      // selección múltiple / "poner listas (N)" / cambio de tipo en bloque
  "aprobar_cartola", // "Aprobar cartola" → manda lo listo a Emitir
  "devolver_cartola",// "Devolver cartola" desde Emitir
  "propagacion",     // aprender-al-clasificar voltea hermanos de la misma contraparte
  "mcp",             // conector MCP (IA externa del usuario)
  "telegram",        // bot de Telegram
  "sistema",         // el propio sistema (reclasificar a mesa factura, etc.)
] as const;

export type CanalDecision = (typeof CANALES_DECISION)[number];

/** Canales que el CLIENTE puede declarar como origen de ponerListo/volverAPendientes/
 *  rechazarPropuestas. El resto (mcp, propagación, sistema…) jamás viene del navegador. */
export const ORIGENES_CHECK = ["check_fila", "check_detalle", "check_lote"] as const;
export type OrigenCheck = (typeof ORIGENES_CHECK)[number];

export type SelloDecision = {
  decision_canal: CanalDecision;
  decision_por: string | null;
  decision_lote: string;
  decision_lote_n: number;
  decision_abierta: boolean | null;
  decision_soporte: boolean | null;
};

export function esCanalDecision(v: unknown): v is CanalDecision {
  return typeof v === "string" && (CANALES_DECISION as readonly string[]).includes(v);
}

export function nuevoLote(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Arma el sello para spread en el payload del update:
 *   .update({ estado: "listo", ...sello("check_lote", { usuarioId, loteN: ids.length, lote }) })
 * `lote` se pasa cuando el gesto se escribe en varios trozos (todos comparten el uuid).
 * `abierta`: true si la fila estaba abierta (detalle), false si fue a ciegas (lote,
 * propagación), null si no se sabe (MCP, Telegram, sistema).
 */
export function sello(
  canal: CanalDecision,
  opts: { usuarioId: string | null | undefined; loteN: number; lote?: string; abierta?: boolean | null; soporte?: boolean | null },
): SelloDecision {
  if (!esCanalDecision(canal)) throw new Error(`Canal de decisión fuera de la lista cerrada: ${String(canal)}`);
  const loteN = Math.max(1, Math.floor(Number(opts.loteN) || 1));
  return {
    decision_canal: canal,
    decision_por: opts.usuarioId ?? null,
    decision_lote: opts.lote ?? nuevoLote(),
    decision_lote_n: loteN,
    decision_abierta: opts.abierta === undefined ? abiertaPorDefecto(canal) : opts.abierta,
    decision_soporte: opts.soporte ?? null,
  };
}

function abiertaPorDefecto(canal: CanalDecision): boolean | null {
  if (canal === "check_detalle") return true;
  if (canal === "mcp" || canal === "telegram" || canal === "sistema") return null;
  return false;
}

/**
 * Valida el `origen` que manda el navegador a una server action (endpoint público:
 * el tipo TS no limita el payload). Fuera de la lista → se ignora y se deduce:
 * 1 fila = check_fila, varias = check_lote.
 */
export function canalDeOrigen(origen: unknown, n: number): OrigenCheck {
  if (typeof origen === "string" && (ORIGENES_CHECK as readonly string[]).includes(origen)) return origen as OrigenCheck;
  return n === 1 ? "check_fila" : "check_lote";
}
