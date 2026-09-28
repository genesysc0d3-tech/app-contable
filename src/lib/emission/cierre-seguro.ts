// Cierre seguro de un job de emisión por DELETE (plan-emision-confiable §1.5, riesgo C, 2026-09-28).
//
// `cancelled` es un cierre PERMISIVO: deja la propuesta lista para re-emitir. Un job
// del LOTE (con propuesta_id) que se cierra desde afuera —hoy, el "liberar mi
// candado" de la boleta única (EmitirDirectaView cancelStaleLock) puede tomar el
// candado de un job del lote colgado— pudo haber apretado EMITIR: cancelarlo abría
// la puerta al doble folio. Con propuesta, el cierre pedido como `cancelled` se sella
// como lápida `revision_pendiente` (a medias: se verifica antes de re-emitir).
// El lote nunca pide `cancelled` (usa `failed` para lo pre-emit seguro).

export type EstadoCierre = "failed" | "cancelled" | "revision_pendiente";

export function estadoCierreSeguro(pedido: EstadoCierre, job: { propuesta_id: string | null }): EstadoCierre {
  if (pedido === "cancelled" && job.propuesta_id) return "revision_pendiente";
  return pedido;
}
