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
  // Date.parse, no strings: PostgREST devuelve "+00:00" y fracciones de segundo.
  if (Date.parse(job.created_at) < Date.parse(SIN_RESPUESTA_DESDE)) return null;
  if (!job.expires_at) return null;
  return Date.parse(job.expires_at) <= ahora.getTime() ? "sin_respuesta" : null;
}

/** Estados que hay que traer para juzgar lápidas. */
export const ESTADOS_LAPIDA = ["revision_pendiente", "created", "running"] as const;

/**
 * ¿Se puede ofrecer "No está en el SII" (salida humana) sobre esta lápida?
 * Una SIN RESPUESTA recién vencida puede seguir viva (ventana del SII tapada, rAF
 * dormido): la regla dura bloquea re-emitir desde el segundo que vence, pero la
 * salida humana espera 30 min más para no devolver a Listas algo que aún trabaja.
 */
export const DECLARAR_SIN_RESPUESTA_TRAS_MS = 30 * 60 * 1000;
export function puedeDeclararNoSalio(job: JobParaLapida, ahora: Date = new Date()): boolean {
  const motivo = esLapidaEfectiva(job, ahora);
  if (motivo === "a_medias") return true;
  if (motivo === "sin_respuesta") return Date.parse(job.expires_at as string) + DECLARAR_SIN_RESPUESTA_TRAS_MS <= ahora.getTime();
  return false;
}

/**
 * "No está en el SII" cierra TODAS las lápidas de la propuesta, no solo la declarada.
 * Por eso el plazo se exige a CADA una (revisión adversarial 2026-09-28): una
 * verificación sellada a medias (revision_pendiente, declarable al tiro) no puede
 * arrastrar al intento original sin respuesta que venció hace 5 min. Devuelve desde
 * cuándo se podrá (el más tardío) si alguna todavía no cumple.
 */
export function plazoDeclararNoSalio(jobs: JobParaLapida[], ahora: Date = new Date()): { ok: true } | { ok: false; desdeMs: number } {
  let desdeMs = -Infinity;
  for (const j of jobs) {
    if (esLapidaEfectiva(j, ahora) === null || puedeDeclararNoSalio(j, ahora)) continue;
    desdeMs = Math.max(desdeMs, Date.parse(j.expires_at as string) + DECLARAR_SIN_RESPUESTA_TRAS_MS);
  }
  return Number.isFinite(desdeMs) ? { ok: false, desdeMs } : { ok: true };
}
