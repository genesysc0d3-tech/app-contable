import "server-only";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { parseExcel } from "@/lib/parsers";
import { ocrAndGroupImages } from "@/lib/ai/ocr";
import { descargarDocumento } from "@/lib/storage";
import { procesarDocumento } from "@/lib/ai/processor";
import { sanitizeOpsMetadata } from "@/lib/ops/sanitize";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_QUEUE_LIMIT,
  DOCUMENT_PIPELINE_VERSION,
  STALE_RUNNING_MS,
  documentJobIdempotencyKey,
  nextRetryAt,
  safeJobError,
  type DocumentJobStatus,
  type DocumentProcessingJob,
} from "@/lib/document-processing/state";

type Sb = SupabaseClient<Database>;
export type { DocumentJobStatus, DocumentProcessingJob };

type EnqueueArgs = {
  documentoId: string;
  empresaId: string;
  usuarioId?: string | null;
  tipo: string;
  storagePath: string;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
};

type ProcessQueueArgs = {
  sb?: Sb;
  limit?: number;
  lockOwner?: string;
  now?: Date;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

function safeJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    return null;
  }
}

function cleanLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return DEFAULT_QUEUE_LIMIT;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

export async function enqueueDocumentProcessingJob(sb: Sb, args: EnqueueArgs) {
  const now = new Date().toISOString();
  const idempotencyKey = documentJobIdempotencyKey(args.documentoId);
  const metadata = sanitizeOpsMetadata(args.metadata);

  const existing = await sb
    .from("document_processing_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(`JOB_LOOKUP_FAILED:${existing.error.message}`);

  if (existing.data) {
    if (["queued", "running", "retryable", "completed"].includes(existing.data.status)) {
      return existing.data;
    }
    const { data, error } = await sb
      .from("document_processing_jobs")
      .update({
        status: "queued",
        attempts: 0,
        last_error: null,
        locked_at: null,
        locked_by: null,
        next_run_at: now,
        started_at: null,
        completed_at: null,
        storage_path: args.storagePath,
        tipo: args.tipo,
        metadata: metadata as Json,
        updated_at: now,
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (error) throw new Error(`JOB_RESET_FAILED:${error.message}`);
    return data;
  }

  const { data, error } = await sb
    .from("document_processing_jobs")
    .insert({
      documento_id: args.documentoId,
      empresa_id: args.empresaId,
      usuario_id: args.usuarioId ?? null,
      tipo: args.tipo,
      storage_path: args.storagePath,
      status: "queued",
      attempts: 0,
      max_attempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      idempotency_key: idempotencyKey,
      pipeline_version: DOCUMENT_PIPELINE_VERSION,
      metadata: metadata as Json,
      next_run_at: now,
    })
    .select("*")
    .single();
  if (error) throw new Error(`JOB_INSERT_FAILED:${error.message}`);
  return data;
}

async function recoverStaleJobs(sb: Sb, now: Date, lockOwner: string) {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const { data: staleJobs, error } = await sb
    .from("document_processing_jobs")
    .select("*")
    .eq("status", "running")
    .lt("locked_at", staleBefore)
    .limit(20);
  if (error) throw new Error(`STALE_JOB_QUERY_FAILED:${error.message}`);

  for (const job of staleJobs ?? []) {
    const attempts = job.attempts + 1;
    const retryable = attempts < job.max_attempts;
    await sb
      .from("document_processing_jobs")
      .update({
        status: retryable ? "retryable" : "failed",
        attempts,
        last_error: "Job running quedo atascado y fue recuperado por watchdog",
        locked_at: null,
        locked_by: null,
        next_run_at: retryable ? nextRetryAt(attempts, now) : now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);

    await recordOpsEvent({
      sb,
      severity: retryable ? "warn" : "error",
      source: "ia",
      eventName: "document_processing_stale_job_recovered",
      summary: retryable ? "Job de documento atascado fue reagendado" : "Job de documento atascado quedo fallido",
      empresaId: job.empresa_id,
      usuarioId: job.usuario_id,
      resourceType: "document_processing_job",
      resourceId: job.id,
      metadata: { documento_id: job.documento_id, attempts, lock_owner: lockOwner },
    });
  }
  return staleJobs?.length ?? 0;
}

async function runningCountForEmpresa(sb: Sb, empresaId: string) {
  const { count, error } = await sb
    .from("document_processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("status", "running");
  if (error) throw new Error(`RUNNING_COUNT_FAILED:${error.message}`);
  return count ?? 0;
}

async function claimJobs(sb: Sb, args: { limit: number; now: Date; lockOwner: string }) {
  const { data: candidates, error } = await sb
    .from("document_processing_jobs")
    .select("*")
    .in("status", ["queued", "retryable"])
    .lte("next_run_at", args.now.toISOString())
    .order("created_at", { ascending: true })
    .limit(args.limit * 4);
  if (error) throw new Error(`JOB_CANDIDATE_QUERY_FAILED:${error.message}`);

  const claimed: DocumentProcessingJob[] = [];
  for (const job of candidates ?? []) {
    if (claimed.length >= args.limit) break;
    if (await runningCountForEmpresa(sb, job.empresa_id) > 0) continue;

    const nowIso = new Date().toISOString();
    const { data, error: claimError } = await sb
      .from("document_processing_jobs")
      .update({
        status: "running",
        locked_at: nowIso,
        locked_by: args.lockOwner,
        started_at: job.started_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq("id", job.id)
      .in("status", ["queued", "retryable"])
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error(`JOB_CLAIM_FAILED:${claimError.message}`);
    if (data) claimed.push(data);
  }
  return claimed;
}

async function extractContentFromJob(sb: Sb, job: DocumentProcessingJob) {
  if (job.storage_path === "memoria") {
    throw new Error("Archivo original no disponible en almacenamiento");
  }

  const metadata = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
    ? job.metadata as Record<string, Json>
    : {};

  // Provider del archivo (r2 | supabase) según el documento → descarga provider-aware.
  const { data: docRow } = await sb.from("documentos_subidos").select("storage_provider").eq("id", job.documento_id).maybeSingle();
  const provider = docRow?.storage_provider === "r2" ? "r2" : "supabase";
  const bajar = async (p: string): Promise<Buffer> => {
    const { data, error } = await sb.storage.from("documentos").download(p);
    if (error || !data) throw new Error(`Error descargando archivo: ${error?.message ?? "sin archivo"}`);
    return Buffer.from(await data.arrayBuffer());
  };

  const groupedImages = Array.isArray(metadata.grouped_images) ? metadata.grouped_images : null;
  if (groupedImages?.length) {
    const images: { base64: string; mimeType: string; fileName: string }[] = [];
    for (const item of groupedImages.slice(0, 12)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, Json>;
      const path = typeof record.path === "string" ? record.path : null;
      if (!path) continue;
      let buffer: Buffer;
      try { buffer = await descargarDocumento(provider, path, bajar); } catch { continue; }
      images.push({
        base64: buffer.toString("base64"),
        mimeType: typeof record.mime === "string" ? record.mime : "image/jpeg",
        fileName: typeof record.name === "string" ? record.name : "imagen",
      });
    }
    if (images.length === 0) throw new Error("No se pudieron descargar las imagenes agrupadas");
    // Telegram = 1 venta: salta la 2ª pasada IA de agrupado y acorta el timeout OCR.
    const esTelegram = metadata.origen === "telegram";
    const { groupedText } = await ocrAndGroupImages(images, esTelegram ? { skipGrouping: true, ocrTimeoutMs: 60_000 } : undefined);
    return { contenido: groupedText, preExtracted: null };
  }

  const fileBuffer = await descargarDocumento(provider, job.storage_path, bajar);

  let contenido: string;
  let preExtracted: import("@/lib/parsers/types").PreExtractedMovimiento[] | null = null;

  if (job.tipo === "excel") {
    const ab = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const parsed = await parseExcel(ab, { documento_id: job.documento_id });
    contenido = parsed.content;
    preExtracted = parsed.preExtracted;
  } else if (job.tipo === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const pdfParser = new PDFParse(new Uint8Array(fileBuffer));
    const pdfData = await pdfParser.getText();
    contenido = pdfData.text;
  } else if (job.tipo === "imagen") {
    const { groupedText } = await ocrAndGroupImages([{
      base64: fileBuffer.toString("base64"),
      mimeType: typeof metadata.mime === "string" ? metadata.mime : "image/jpeg",
      fileName: job.storage_path.split("/").pop() || "imagen",
    }]);
    contenido = groupedText;
  } else {
    contenido = fileBuffer.toString("utf-8");
  }

  return { contenido, preExtracted };
}

async function markJobFailedOrRetryable(sb: Sb, job: DocumentProcessingJob, error: unknown, now = new Date()) {
  const attempts = job.attempts + 1;
  const retryable = attempts < job.max_attempts;
  const status: DocumentJobStatus = retryable ? "retryable" : "failed";
  const message = safeJobError(error);

  await sb
    .from("documentos_subidos")
    .update({
      estado: retryable ? "procesando" : "error",
      progreso_ia: safeJson({
        estado: retryable ? "retryable" : "error",
        error: message,
        attempts,
        max_attempts: job.max_attempts,
        next_run_at: retryable ? nextRetryAt(attempts, now) : null,
      }),
    })
    .eq("id", job.documento_id);

  const { error: updateError } = await sb
    .from("document_processing_jobs")
    .update({
      status,
      attempts,
      last_error: message,
      locked_at: null,
      locked_by: null,
      next_run_at: retryable ? nextRetryAt(attempts, now) : now.toISOString(),
      completed_at: retryable ? null : now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", job.id);
  if (updateError) throw new Error(`JOB_FAILURE_UPDATE_FAILED:${updateError.message}`);

  await recordOpsError({
    sb,
    severity: retryable ? "error" : "critical",
    source: job.tipo === "imagen" ? "ocr" : "ia",
    eventName: retryable ? "document_processing_retryable" : "document_processing_failed",
    summary: retryable ? "Job de documento falló y quedó para reintento" : "Job de documento agotó reintentos",
    empresaId: job.empresa_id,
    usuarioId: job.usuario_id,
    resourceType: "document_processing_job",
    resourceId: job.id,
    error,
    metadata: { documento_id: job.documento_id, attempts, max_attempts: job.max_attempts, tipo: job.tipo },
  });
}

async function processOneJob(sb: Sb, job: DocumentProcessingJob) {
  const now = new Date();
  try {
    await sb
      .from("documentos_subidos")
      .update({
        estado: "procesando",
        progreso_ia: safeJson({ estado: "queued_worker", job_id: job.id, attempts: job.attempts }),
      })
      .eq("id", job.documento_id);

    const { contenido, preExtracted } = await extractContentFromJob(sb, job);
    if (!contenido.trim()) throw new Error("Documento vacio o sin contenido legible");

    const result = await procesarDocumento(job.documento_id, job.empresa_id, contenido, undefined, preExtracted ?? undefined);
    if (result.error) throw new Error(result.error);

    const completedAt = new Date().toISOString();
    const { error } = await sb
      .from("document_processing_jobs")
      .update({
        status: "completed",
        locked_at: null,
        locked_by: null,
        last_error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", job.id);
    if (error) throw new Error(`JOB_COMPLETE_UPDATE_FAILED:${error.message}`);

    return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: result.movimientos_total };
  } catch (error) {
    await markJobFailedOrRetryable(sb, job, error, now);
    return { ok: false as const, jobId: job.id, documentoId: job.documento_id, error: safeJobError(error) };
  }
}

export async function processDocumentQueue(args: ProcessQueueArgs = {}) {
  const sb = args.sb ?? serviceClient();
  if (!sb) throw new Error("BACKEND_CONFIG_MISSING");
  const limit = cleanLimit(args.limit);
  const lockOwner = args.lockOwner ?? `worker:${process.pid}`;
  const now = args.now ?? new Date();

  const recovered = await recoverStaleJobs(sb, now, lockOwner);
  const claimed = await claimJobs(sb, { limit, now, lockOwner });
  const results = [];
  for (const job of claimed) {
    results.push(await processOneJob(sb, job));
  }

  return {
    ok: true,
    recovered,
    claimed: claimed.length,
    completed: results.filter((r) => r.ok).length,
    failed_or_retryable: results.filter((r) => !r.ok).length,
    results,
  };
}

export async function retryDocumentProcessingJob(sb: Sb, args: { jobId?: string; documentoId?: string; actorUserId?: string }) {
  let query = sb.from("document_processing_jobs").select("*");
  if (args.jobId) query = query.eq("id", args.jobId);
  else if (args.documentoId) query = query.eq("documento_id", args.documentoId);
  else throw new Error("JOB_ID_OR_DOCUMENTO_ID_REQUIRED");

  const { data: job, error } = await query.maybeSingle();
  if (error) throw new Error(`JOB_QUERY_FAILED:${error.message}`);
  if (!job) throw new Error("JOB_NOT_FOUND");
  if (!["failed", "retryable", "cancelled"].includes(job.status)) return job;

  const now = new Date().toISOString();
  const { data, error: updateError } = await sb
    .from("document_processing_jobs")
    .update({
      status: "queued",
      attempts: 0,
      last_error: null,
      locked_at: null,
      locked_by: null,
      next_run_at: now,
      completed_at: null,
      updated_at: now,
    })
    .eq("id", job.id)
    .select("*")
    .single();
  if (updateError) throw new Error(`JOB_RETRY_FAILED:${updateError.message}`);

  await recordOpsEvent({
    sb,
    severity: "info",
    source: "dev-support",
    eventName: "document_processing_job_retry",
    summary: "Operador reagendo job de procesamiento de documento",
    empresaId: job.empresa_id,
    usuarioId: args.actorUserId ?? job.usuario_id,
    resourceType: "document_processing_job",
    resourceId: job.id,
    metadata: { documento_id: job.documento_id },
  });

  return data;
}
