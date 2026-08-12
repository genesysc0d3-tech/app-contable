import type { Tables } from "@/lib/database.types";

export const DOCUMENT_PIPELINE_VERSION = "document-processing:v1";
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_QUEUE_LIMIT = 3;
// Reaper de jobs "running" colgados. DEBE quedar > maxDuration (300s) + skew, si no
// el reaper re-encola un job que AÚN corre → doble worker → movimientos DUPLICADOS.
// 12min = 300s de maxDuration + ~420s de margen para skew de reloj y sobrecosto de red
// (7min daba solo 120s de margen, demasiado justo).
export const STALE_RUNNING_MS = 12 * 60 * 1000;
// Presupuesto de tiempo de IA por invocación para UN job (Hobby mata la función a
// los 300s). Al agotarse, el processor lanza ProcessorYieldError con checkpoint
// guardado y el job se reagenda al tiro SIN gastar intento: la próxima invocación
// retoma donde quedó. Margen bajo 300s para descarga/parseo/inserción.
export const JOB_TIME_BUDGET_MS = 200 * 1000;
// Presupuesto del loop de drenaje de la cola dentro de una invocación (kick/cron):
// procesa jobs de a 1 hasta agotarlo y luego se encadena a una invocación fresca.
export const DRAIN_BUDGET_MS = 60 * 1000;
// Tope de encadenamientos kick→kick para cortar cualquier loop degenerado. Con
// yields cada eslabón avanza al menos un batch, así que 40 eslabones ≈ horas de
// trabajo útil — de sobra para cualquier cartola real.
export const MAX_CHAIN_DEPTH = 40;

export type DocumentProcessingJob = Tables<"document_processing_jobs">;
export type DocumentJobStatus = "queued" | "running" | "retryable" | "completed" | "failed" | "cancelled";

export function documentJobIdempotencyKey(documentoId: string, pipelineVersion = DOCUMENT_PIPELINE_VERSION) {
  return `${documentoId}:${pipelineVersion}`;
}

export function safeJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...[truncated:${normalized.length}]` : normalized;
}

export function nextRetryAt(attempts: number, now = new Date()) {
  const retryNumber = Math.max(1, attempts);
  const delayMs = Math.min(30 * 60 * 1000, 2 ** (retryNumber - 1) * 60 * 1000);
  return new Date(now.getTime() + delayMs).toISOString();
}

export function isStaleRunningJob(job: Pick<DocumentProcessingJob, "status" | "locked_at">, now = new Date()) {
  if (job.status !== "running" || !job.locked_at) return false;
  return new Date(job.locked_at).getTime() <= now.getTime() - STALE_RUNNING_MS;
}
