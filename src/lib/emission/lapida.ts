// ¿Este job bloquea re-emitir su propuesta? (plan-emision-confiable §1.1 + B3a, 2026-09-28)
//
// Caso LC 27-sep 23:37: la boleta 17 del lote quedó `running` (la extensión nunca
// contestó y la pestaña murió). Al vencer el candado, el chequeo de "en vuelo" dejó
// de verla y la propuesta volvió a Listas SIN lápida, aunque el folio pudo haber
// salido en el SII → re-emitirla podía dar DOBLE FOLIO. Un job del LOTE vencido y
// todavía abierto es un resultado DESCONOCIDO: se trata como "a medias" (se verifica
// o se declara, nunca se repite a ciegas).
//
// Acotado a jobs nuevos (B3a): los colgados anteriores al corte se resuelven a mano;
// si no, cientos de jobs viejos caerían de golpe en "A medias" sin forma de verificarlos.

export const SIN_RESPUESTA_DESDE = "2026-09-28T00:00:00Z";

export type MotivoLapida = "a_medias" | "sin_respuesta";

export type JobParaLapida = {
  estado: string;
  propuesta_id: string | null;
  expires_at: string | null;
  created_at: string;
};

export function esLapidaEfectiva(job: JobParaLapida, ahora: Date = new Date()): MotivoLapida | null {
  if (!job.propuesta_id) return null; // boleta única: su reja es el candado
  if (job.estado === "revision_pendiente") return "a_medias";
  if (job.estado !== "created" && job.estado !== "running") return null;
  if (job.created_at < SIN_RESPUESTA_DESDE) return null;
  if (!job.expires_at) return null;
  return Date.parse(job.expires_at) <= ahora.getTime() ? "sin_respuesta" : null;
}

/** Estados que hay que traer para juzgar lápidas. */
export const ESTADOS_LAPIDA = ["revision_pendiente", "created", "running"] as const;
