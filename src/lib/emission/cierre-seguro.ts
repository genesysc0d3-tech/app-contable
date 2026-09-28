// Cierre seguro de un job de emisión por DELETE (plan-emision-confiable §1.5, riesgo C, 2026-09-28).
//
// `cancelled` es un cierre PERMISIVO: deja la propuesta lista para re-emitir. Un job
// del LOTE (con propuesta_id) que se cierra desde afuera —hoy, el "liberar mi
// candado" de la boleta única (EmitirDirectaView cancelStaleLock) puede tomar el
// candado de un job del lote colgado— pudo haber apretado EMITIR: cancelarlo abría
// la puerta al doble folio. Con propuesta, el cierre pedido como `cancelled` se sella
// como lápida `revision_pendiente` (a medias: se verifica antes de re-emitir).
// El lote nunca pide `cancelled` (usa `failed` para lo pre-emit seguro).

import { esLapidaEfectiva, type JobParaLapida } from "./lapida";

export type EstadoCierre ="failed" | "cancelled" | "revision_pendiente";

export function estadoCierreSeguro(pedido: EstadoCierre, job: { propuesta_id: string | null }): EstadoCierre {
  if (pedido === "cancelled" && job.propuesta_id) return "revision_pendiente";
  return pedido;
}

/**
 * ¿El DELETE debe dejar el job como está? (Verificar y seguir, 2026-09-28.)
 * Una lápida SIN RESPUESTA (job del lote vencido y abierto) solo baja a `failed` con
 * el veredicto "no salió" que valida el server (/api/sii-local/result, adopcion.ts) o
 * con la declaración humana. Un DELETE `failed`/`cancelled` no la baja; sí puede
 * sellarla a medias (`revision_pendiente`, más protección).
 */
export function deleteRespetaSinRespuesta(job: JobParaLapida, estado: EstadoCierre, ahora: Date = new Date()): boolean {
  return estado !== "revision_pendiente" && esLapidaEfectiva(job, ahora) === "sin_respuesta";
}
