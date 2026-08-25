import "server-only";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { parseExcel } from "@/lib/parsers";
import { PlantillaFacturasEnCartolaError } from "@/lib/parsers/orchestrator";
import { ocrAndGroupImages } from "@/lib/ai/ocr";
import { descargarDocumento } from "@/lib/storage";
import { procesarDocumento, ProcessorYieldError } from "@/lib/ai/processor";
import { PdfProtegidoError, esErrorDeClavePdf, variantesClaveDesdeRut } from "./pdf-protegido";
import { sanitizeOpsMetadata } from "@/lib/ops/sanitize";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_QUEUE_LIMIT,
  DOCUMENT_PIPELINE_VERSION,
  JOB_TIME_BUDGET_MS,
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
  /** Reproceso explícito del usuario: re-encola aunque el job ya esté 'completed'.
   *  Nunca interrumpe un job 'running' (evita doble procesamiento en vuelo). */
  force?: boolean;
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
    // 'running' = worker en vuelo: jamás lo re-encolamos (doble procesamiento).
    if (existing.data.status === "running") return existing.data;
    // Sin force, un job ya resuelto/encolado no se reinicia. Con force (reproceso
    // explícito, p. ej. tras Deshacer), reiniciamos aunque esté 'completed' —
    // así Deshacer→Reprocesar deja de ser un no-op silencioso.
    if (!args.force && ["queued", "retryable", "completed"].includes(existing.data.status)) {
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
    const parsed = await parseExcel(ab, { documento_id: job.documento_id, empresa_id: job.empresa_id });
    contenido = parsed.content;
    preExtracted = parsed.preExtracted;
  } else if (job.tipo === "pdf") {
    contenido = await leerTextoPdf(sb, job, fileBuffer);
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

/**
 * Lee el texto de un PDF. Si está protegido con clave, prueba automáticamente
 * variantes del RUT de la empresa (lo usual en bancos chilenos). Si ninguna
 * abre el PDF, lanza PdfProtegidoError (definitivo, sin reintentos, mensaje
 * humano). La clave solo vive en memoria durante la lectura.
 */
async function leerTextoPdf(sb: Sb, job: DocumentProcessingJob, fileBuffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  // pdf.js TRANSFIERE el buffer al worker (queda desprendido tras el 1er intento):
  // cada intento necesita una copia fresca, si no el 2º tira DataCloneError.
  const intentar = async (password?: string) => {
    const data = new Uint8Array(fileBuffer); // copia por intento
    const parser = new PDFParse(password ? { data, password } : { data });
    try { return (await parser.getText()).text; } finally { await parser.destroy().catch(() => {}); }
  };
  try {
    return await intentar();
  } catch (error) {
    if (!esErrorDeClavePdf(error)) throw error;
  }
  // PDF con clave: probar variantes del RUT de la empresa (nunca se persisten).
  const { data: empresa } = await sb.from("empresas").select("rut").eq("id", job.empresa_id).maybeSingle();
  for (const clave of variantesClaveDesdeRut(empresa?.rut)) {
    try {
      const texto = await intentar(clave);
      await recordOpsEvent({
        sb,
        severity: "info",
        source: "ia",
        eventName: "pdf_protegido_abierto_con_rut",
        summary: "Cartola PDF con clave abierta automáticamente con el RUT de la empresa",
        empresaId: job.empresa_id,
        usuarioId: job.usuario_id,
        resourceType: "document_processing_job",
        resourceId: job.id,
        metadata: { documento_id: job.documento_id },
      });
      return texto;
    } catch (error) {
      if (!esErrorDeClavePdf(error)) throw error;
    }
  }
  throw new PdfProtegidoError();
}

/**
 * Yield por presupuesto de tiempo: NO es un fallo. El job vuelve a la cola AL
 * TIRO (sin backoff) y SIN gastar intento — el checkpoint en progreso_ia (que
 * acá no se toca) garantiza que la próxima invocación avanza en vez de repetir.
 */
async function markJobYielded(sb: Sb, job: DocumentProcessingJob, yieldInfo: ProcessorYieldError, now = new Date()) {
  const { error } = await sb
    .from("document_processing_jobs")
    .update({
      status: "retryable",
      last_error: yieldInfo.message,
      locked_at: null,
      locked_by: null,
      next_run_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "running");
  if (error) throw new Error(`JOB_YIELD_UPDATE_FAILED:${error.message}`);
}

async function markJobFailedOrRetryable(sb: Sb, job: DocumentProcessingJob, error: unknown, now = new Date()) {
  const attempts = job.attempts + 1;
  const retryable = attempts < job.max_attempts;
  const status: DocumentJobStatus = retryable ? "retryable" : "failed";
  const message = safeJobError(error);

  // El checkpoint NO se toca acá: vive en document_processing_jobs.checkpoint,
  // así un error transitorio (red, upstream) no obliga a repartir de cero.

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

/**
 * Fallo DEFINITIVO (p. ej. PDF con clave que no pudimos abrir): el job queda
 * failed de inmediato, sin reintentos, y el documento en "error" con un mensaje
 * humano que la UI muestra tal cual (MesaTab lee progreso_ia.error).
 */
async function markJobFailedDefinitivo(sb: Sb, job: DocumentProcessingJob, error: Error, now = new Date()) {
  const message = error.message;
  await sb
    .from("documentos_subidos")
    .update({
      estado: "error",
      progreso_ia: safeJson({ estado: "error", error: message, definitivo: true, attempts: job.attempts + 1, max_attempts: job.max_attempts }),
    })
    .eq("id", job.documento_id);
  const { error: updateError } = await sb
    .from("document_processing_jobs")
    .update({
      status: "failed",
      attempts: job.attempts + 1,
      last_error: message,
      locked_at: null,
      locked_by: null,
      next_run_at: now.toISOString(),
      completed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", job.id);
  if (updateError) throw new Error(`JOB_FAILURE_UPDATE_FAILED:${updateError.message}`);
  await recordOpsEvent({
    sb,
    severity: "warn",
    source: "ia",
    eventName: "document_processing_failed_definitivo",
    summary: "Job de documento falló de forma definitiva (no reintentable)",
    empresaId: job.empresa_id,
    usuarioId: job.usuario_id,
    resourceType: "document_processing_job",
    resourceId: job.id,
    metadata: { documento_id: job.documento_id, tipo: job.tipo, motivo: error.name },
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

    const meta = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? job.metadata as Record<string, Json>
      : {};
    let movimientosTotal: number;
    if (meta.origen === "telegram") {
      // Telegram (álbum o foto suelta vía cola): determinístico-primero + boleta al chat.
      const { clasificarComprobanteTelegram } = await import("@/lib/telegram/ingesta");
      const chatId = typeof meta.chat_id === "number" ? meta.chat_id : undefined;
      // Álbum (multi-imagen) → IA (el parser determinístico es de 1 comprobante y se
      // confunde con varios montos). Foto suelta vía cola → determinístico-primero.
      const esAlbum = Array.isArray(meta.grouped_images) && meta.grouped_images.length > 1;
      const r = await clasificarComprobanteTelegram({ documentoId: job.documento_id, empresaId: job.empresa_id, groupedText: contenido, chatId, soloIA: esAlbum });
      movimientosTotal = r.movimientos_total;
    } else {
      // Presupuesto de tiempo: si el modelo de turno es lento y no alcanza,
      // el processor hace yield con checkpoint y seguimos en otra invocación.
      const deadline = Date.now() + JOB_TIME_BUDGET_MS;
      const result = await procesarDocumento(job.documento_id, job.empresa_id, contenido, undefined, preExtracted ?? undefined, { deadline });
      if (result.error) throw new Error(result.error);
      movimientosTotal = result.movimientos_total;
    }

    const completedAt = new Date().toISOString();
    // Compare-and-set: solo completamos si el job SIGUE 'running'. Si el usuario
    // canceló en vuelo (status → 'cancelled'), el update no toca ninguna fila y el
    // job queda cancelado en vez de revivir como 'completed'.
    const { data: completado, error } = await sb
      .from("document_processing_jobs")
      .update({
        status: "completed",
        locked_at: null,
        locked_by: null,
        last_error: null,
        // Trabajo terminado: el checkpoint ya no sirve y ocupa cientos de KB.
        checkpoint: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", job.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`JOB_COMPLETE_UPDATE_FAILED:${error.message}`);
    if (!completado) {
      // El job dejó de estar 'running' (cancelado mientras procesaba): dejamos el
      // documento en 'error' para que no aparezca como procesado.
      await sb
        .from("documentos_subidos")
        .update({ estado: "error", progreso_ia: safeJson({ estado: "error", error: "Cancelado por el usuario" }) })
        .eq("id", job.documento_id);
      return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: 0, cancelled: true };
    }

    return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: movimientosTotal };
  } catch (error) {
    if (error instanceof ProcessorYieldError) {
      await markJobYielded(sb, job, error, new Date());
      return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: 0, yielded: true };
    }
    if (error instanceof PlantillaFacturasEnCartolaError) {
      // Definitivo: reintentar no cambia el archivo. El mensaje ya le dice al
      // usuario dónde subirlo.
      await markJobFailedDefinitivo(sb, job, error, now);
      return { ok: false as const, jobId: job.id, documentoId: job.documento_id, error: error.message };
    }
    if (error instanceof PdfProtegidoError) {
      // Definitivo: reintentar no sirve (la clave no va a aparecer sola). Se marca
      // failed de una, con el mensaje humano, sin gastar intentos ni esperar backoff.
      await markJobFailedDefinitivo(sb, job, error, now);
      return { ok: false as const, jobId: job.id, documentoId: job.documento_id, error: error.message };
    }
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
    completed: results.filter((r) => r.ok && !("yielded" in r && r.yielded)).length,
    yielded: results.filter((r) => r.ok && "yielded" in r && r.yielded).length,
    failed_or_retryable: results.filter((r) => !r.ok).length,
    results,
  };
}

/**
 * Marca como 'cancelled' el job de un documento (si no está en un estado terminal).
 * Un job 'cancelled' no lo reclama el worker (claimJobs solo toma queued/retryable)
 * ni lo revive el watchdog (solo mira 'running'), y el compare-and-set de
 * processOneJob impide que un job cancelado en vuelo termine como 'completed'.
 * Devuelve true si había un job vivo (queued/running/retryable) que se canceló.
 */
/**
 * ¿Cuánto falta (ms) para el próximo job pendiente (queued/retryable)?
 * - 0 si ya está vencido, null si no hay ninguno dentro del horizonte.
 * Lo usa el drenaje encadenado para NO morir cuando lo único que queda es un
 * reintento con backoff a 1-2 min de futuro (incidente 2026-08-22: la cadena
 * terminaba y la cartola quedaba a medias hasta el cron del día siguiente).
 */
export async function msHastaProximoJobPendiente(withinMs: number, sbArg?: Sb): Promise<number | null> {
  const sb = sbArg ?? serviceClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("document_processing_jobs")
    .select("next_run_at")
    .in("status", ["queued", "retryable"])
    .order("next_run_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.next_run_at) return null;
  const delta = new Date(data.next_run_at).getTime() - Date.now();
  if (delta > withinMs) return null;
  return Math.max(0, delta);
}

export async function cancelDocumentProcessingJob(sb: Sb, documentoId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await sb
    .from("document_processing_jobs")
    .update({ status: "cancelled", locked_at: null, locked_by: null, updated_at: now })
    .eq("documento_id", documentoId)
    .in("status", ["queued", "running", "retryable"])
    .select("id");
  return (data?.length ?? 0) > 0;
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
