import "server-only";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { empresasOcupadas, msHastaProximoJobTomable } from "./proximo-job";
import type { Database, Json } from "@/lib/database.types";
import { parseExcel, parsePdfCartola, type DiagnosticoPdf } from "@/lib/parsers";
import { PlantillaFacturasEnCartolaError } from "@/lib/parsers/orchestrator";
import { ocrAndGroupImages } from "@/lib/ai/ocr";
import { conCanalIA } from "@/lib/ai/canal";
import { leerComprobante } from "@/lib/lectura/comprobante";
import { cargarIdentidadesEmpresa } from "@/lib/lectura/identidades";
import { chileDateString } from "@/lib/chile-date";
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

/**
 * Al REPROCESAR un job existente, la metadata nueva se monta sobre la que ya
 * tenía, conservando lo que describe al documento: su origen (Telegram), las
 * imágenes del álbum, la mesa y el tipo de imagen. Antes se reemplazaba entera y
 * la app manda `{}` → un doc de Telegram reprocesado desde la app perdía
 * `origen: "telegram"` y todas las imágenes del álbum menos la primera, y se iba
 * directo a la IA (revisión adversarial 2026-09-27). `chat_id` NO se conserva:
 * un reproceso pedido desde la app no le vuelve a escribir a la clienta por
 * Telegram; el resultado se ve en la app.
 */
const METADATA_DEL_DOCUMENTO = ["origen", "grouped_images", "album", "mesa", "mime"] as const;

export function metadataDeReproceso(anterior: unknown, nueva: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (anterior && typeof anterior === "object" && !Array.isArray(anterior)) {
    for (const k of METADATA_DEL_DOCUMENTO) {
      const v = (anterior as Record<string, unknown>)[k];
      if (v !== undefined) base[k] = v;
    }
  }
  const extra = nueva && typeof nueva === "object" && !Array.isArray(nueva) ? (nueva as Record<string, unknown>) : {};
  return { ...base, ...extra };
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
        metadata: metadataDeReproceso(existing.data.metadata, metadata) as Json,
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

/** Exportada para tests (compare-and-set contra jobs cancelados). */
export async function recoverStaleJobs(sb: Sb, now: Date, lockOwner: string) {
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
    // Compare-and-set (auditoría 2026-10-01): solo si SIGUE 'running'. Entre el
    // SELECT de arriba y este UPDATE el usuario pudo cancelarlo (o el worker
    // terminarlo): sin la condición, un job 'cancelled' revivía como 'retryable'
    // y el worker lo volvía a tomar.
    const { data: recuperado, error: casError } = await sb
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
      .eq("id", job.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    // Nadie tocado (o error): el job ya no es nuestro → el documento tampoco.
    if (casError || !recuperado) continue;
    // Incidente 2026-09-23: el vigilante daba el job por fallido pero NO tocaba
    // el documento → la UI mostraba "procesando" para siempre (una cartola de
    // MH Solutions quedó así 16 horas). Ahora el documento queda en error con
    // un mensaje humano, igual que markJobFailedDefinitivo.
    if (!retryable) {
      await sb
        .from("documentos_subidos")
        .update({
          estado: "error",
          progreso_ia: safeJson({
            estado: "error",
            error: `El procesamiento se cortó ${attempts} veces sin terminar. Vuelve a subir la cartola; si se repite, avísanos.`,
            definitivo: true,
            attempts,
            max_attempts: job.max_attempts,
            recuperado_por_vigilante: true,
          }),
        })
        .eq("id", job.documento_id);
    }

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
  // Candidatos SOLO de empresas libres (2026-09-28): antes se traían los limit*4 más
  // antiguos y recién después se descartaban los de empresas con un job corriendo;
  // si esos 4 eran todos de una empresa ocupada (5 cartolas subidas juntas), el job
  // tomable de OTRA empresa quedaba fuera → claimed 0 → kicks sin progreso y esa otra
  // empresa esperando toda la cola de la primera. Mismo criterio que la sonda
  // (proximo-job.ts); el chequeo por job de abajo se mantiene contra carreras.
  const ocupadas = await empresasOcupadas(sb as unknown as SupabaseClient, { soloFrescos: false });
  let consulta = sb
    .from("document_processing_jobs")
    .select("*")
    .in("status", ["queued", "retryable"])
    .lte("next_run_at", args.now.toISOString());
  if (ocupadas && ocupadas.length > 0) consulta = consulta.not("empresa_id", "in", `(${ocupadas.join(",")})`);
  const { data: candidates, error } = await consulta
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

export async function extractContentFromJob(sb: Sb, job: DocumentProcessingJob) {
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
    // storagePath/Provider van al OCR: la mini baja la imagen con una URL firmada
    // de vida corta en vez de recibirla como base64 DENTRO de ocr_jobs (la fila
    // quedaba con el comprobante completo si la función moría a mitad de camino).
    const images: { base64: string; mimeType: string; fileName: string; storagePath: string; storageProvider: string }[] = [];
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
        storagePath: path,
        storageProvider: provider,
      });
    }
    if (images.length === 0) throw new Error("No se pudieron descargar las imagenes agrupadas");
    // Telegram = 1 venta: salta la 2ª pasada IA de agrupado y acorta el timeout OCR.
    const esTelegram = metadata.origen === "telegram";
    const contexto = { empresaId: job.empresa_id, documentoId: job.documento_id };
    const { groupedText, textos } = await ocrAndGroupImages(images, esTelegram ? { skipGrouping: true, ocrTimeoutMs: 60_000, contexto } : { contexto });
    return { contenido: groupedText, preExtracted: null, plantilla: false, censo: null, textosPorImagen: textos };
  }

  const fileBuffer = await descargarDocumento(provider, job.storage_path, bajar);

  let contenido: string;
  let preExtracted: import("@/lib/parsers/types").PreExtractedMovimiento[] | null = null;
  let plantilla = false;
  let censo: import("@/lib/parsers/types").CensoCartola | null = null;

  if (job.tipo === "excel") {
    const ab = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const parsed = await parseExcel(ab, { documento_id: job.documento_id, empresa_id: job.empresa_id });
    contenido = parsed.content;
    preExtracted = parsed.preExtracted;
    plantilla = parsed.plantilla;
    censo = parsed.censo;
  } else if (job.tipo === "csv") {
    // CSV = cartola: mismo lector determinístico que el Excel (XLSX lee CSV).
    // Antes iba como texto directo a la IA, sin alarma (plan PR 5/8).
    const ab = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const parsed = await parseExcel(ab, { documento_id: job.documento_id, empresa_id: job.empresa_id });
    contenido = parsed.content;
    preExtracted = parsed.preExtracted;
    plantilla = parsed.plantilla;
    censo = parsed.censo;
  } else if (job.tipo === "pdf") {
    const pdf = await leerTextoPdf(sb, job, fileBuffer);
    contenido = pdf.texto;
    // Cartola en PDF (2026-10-02): el ROUTER (parsers/pdf-router.ts) decide por
    // evidencia positiva; SOLO una cartola entra al MISMO lector determinístico
    // que el Excel (grilla por posiciones, juez + sello). Lo demás, como antes. Antes
    // iba a la IA como texto plano (sin columnas ni sello) y una cartola corta
    // (≤3000 caracteres, p. ej. Itaú de 1-2 páginas) se probaba como comprobante.
    const cartola = await leerCartolaPdf(sb, job, fileBuffer, pdf.clave);
    if (cartola) {
      contenido = cartola.content;
      preExtracted = cartola.preExtracted;
      plantilla = cartola.plantilla;
      censo = cartola.censo;
    } else if (contenido.length <= PDF_COMPROBANTE_MAX_CHARS) {
      // Un PDF corto que no es cartola es un comprobante: primero el determinístico.
      // Lo demás sigue a la IA.
      preExtracted = await comprobanteDeterministico(sb, job, contenido);
    }
  } else if (job.tipo === "imagen") {
    const { groupedText } = await ocrAndGroupImages([{
      base64: fileBuffer.toString("base64"),
      mimeType: typeof metadata.mime === "string" ? metadata.mime : "image/jpeg",
      fileName: job.storage_path.split("/").pop() || "imagen",
      storagePath: job.storage_path,
      storageProvider: provider,
    }], { contexto: { empresaId: job.empresa_id, documentoId: job.documento_id } });
    contenido = groupedText;
    preExtracted = await comprobanteDeterministico(sb, job, groupedText);
  } else {
    contenido = fileBuffer.toString("utf-8");
  }

  return { contenido, preExtracted, plantilla, censo, textosPorImagen: undefined as string[] | undefined };
}

/**
 * Cartola PDF por el lector determinístico. null = no parece cartola o el lector
 * no la pudo leer → el flujo de antes (comprobante si es corto, IA si es largo).
 * Una plantilla de facturas sigue siendo error definitivo, igual que en Excel.
 */
async function leerCartolaPdf(sb: Sb, job: DocumentProcessingJob, fileBuffer: Buffer, clave: string | undefined) {
  let diag: DiagnosticoPdf | null = null;
  let r: Awaited<ReturnType<typeof parsePdfCartola>> = null;
  try {
    r = await parsePdfCartola(new Uint8Array(fileBuffer), {
      documento_id: job.documento_id, empresa_id: job.empresa_id, clave, diagnostico: (d) => { diag = d; },
    });
  } catch (error) {
    // Un PDF nunca corta la subida por el lector: sigue el flujo de texto.
    console.warn("[queue] cartola PDF: el lector determinístico falló, sigue el flujo de texto", (error as Error)?.message);
    r = null;
  }
  // Camino elegido para cada PDF (sin datos del documento): tipo, motivo, sello, filas, ms.
  const d = diag as DiagnosticoPdf | null;
  await recordOpsEvent({
    sb,
    severity: "info",
    source: "upload",
    eventName: "pdf_ruta",
    summary: d ? `PDF → ${d.tipo}${d.sello ? ` (${d.sello})` : ""}` : "PDF → error del lector, sigue el flujo de texto",
    empresaId: job.empresa_id,
    usuarioId: job.usuario_id,
    resourceType: "document_processing_job",
    resourceId: job.id,
    metadata: d
      ? { tipo: d.tipo, motivo: d.motivo, senales: d.senales.slice(0, 12), sello: d.sello ?? null, filas: d.filas ?? null, capa: d.capa ?? null, paginas: d.paginas, ms: d.ms, al_lector: !!r }
      : { tipo: "error", al_lector: false },
  }).catch(() => {});
  return r;
}

/** Sobre este largo, el texto de un PDF que NO es cartola va a la IA, no al lector de comprobantes. */
const PDF_COMPROBANTE_MAX_CHARS = 3_000;

/**
 * Comprobante de la app (imagen suelta o PDF corto): OCR → determinístico. Si la
 * lectura es SEGURA, sale como movimiento pre-extraído — igual que una fila de
 * cartola: reglas primero, IA solo para clasificar lo que ninguna regla calce.
 * Si es ambigua o no se reconoce, null → sigue la IA como hasta ahora (la
 * pregunta a la clienta para los ambiguos es el PR 7/8). Plan PR 5/8.
 */
async function comprobanteDeterministico(
  sb: Sb,
  job: DocumentProcessingJob,
  texto: string,
): Promise<import("@/lib/parsers/types").PreExtractedMovimiento[] | null> {
  if (!texto.trim()) return null;
  const identidades = await cargarIdentidadesEmpresa(sb, job.empresa_id);
  const r = leerComprobante(texto, {
    identidades,
    fechaFallback: chileDateString(job.created_at ? new Date(job.created_at) : new Date()),
  });
  if (r.kind !== "parsed") return null;
  return [{
    fecha: r.parsed.fecha,
    descripcion: r.parsed.descripcion,
    monto: r.parsed.monto,
    tipo_flujo: r.parsed.tipo_flujo,
    origen: "comprobante_deterministico",
    n_documento: r.parsed.n_documento,
  }];
}

/**
 * Lee el texto de un PDF. Si está protegido con clave, prueba automáticamente
 * variantes del RUT de la empresa (lo usual en bancos chilenos). Si ninguna
 * abre el PDF, lanza PdfProtegidoError (definitivo, sin reintentos, mensaje
 * humano). La clave solo vive en memoria durante la lectura.
 */
async function leerTextoPdf(sb: Sb, job: DocumentProcessingJob, fileBuffer: Buffer): Promise<{ texto: string; clave?: string }> {
  const { PDFParse } = await import("pdf-parse");
  // pdf.js TRANSFIERE el buffer al worker (queda desprendido tras el 1er intento):
  // cada intento necesita una copia fresca, si no el 2º tira DataCloneError.
  const intentar = async (password?: string) => {
    const data = new Uint8Array(fileBuffer); // copia por intento
    const parser = new PDFParse(password ? { data, password } : { data });
    try { return (await parser.getText()).text; } finally { await parser.destroy().catch(() => {}); }
  };
  try {
    return { texto: await intentar() };
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
      return { texto, clave };
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
/**
 * Lease del worker (auditoría 2026-10-01): status='running' no basta para saber que
 * el job sigue siendo NUESTRO. Si este worker se colgó, el vigilante lo recuperó y
 * OTRO worker lo re-tomó, el job vuelve a estar 'running' — y el worker viejo, al
 * despertar, lo marcaba fallido/cedido/completado encima del nuevo. claimJobs estampa locked_by +
 * locked_at (nadie los renueva en vuelo), así que ese par identifica la toma. El
 * `lockOwner` (`worker:${pid}`) puede repetirse entre instancias serverless; el
 * locked_at de la toma no. Si el job no trae lease (no salió de claimJobs) se omite.
 */
type FiltroLease<Q> = { eq: (col: string, v: string) => Q };
function conLease<Q extends FiltroLease<Q>>(q: Q, job: Pick<DocumentProcessingJob, "locked_by" | "locked_at">): Q {
  let r = q;
  if (job.locked_by) r = r.eq("locked_by", job.locked_by);
  if (job.locked_at) r = r.eq("locked_at", job.locked_at);
  return r;
}

/** Exportada para tests (compare-and-set + lease). */
export async function markJobYielded(sb: Sb, job: DocumentProcessingJob, yieldInfo: ProcessorYieldError, now = new Date()) {
  // Con lease: un worker viejo no devuelve a la cola (retryable) un job que otro
  // worker re-tomó y está procesando — eso lo dejaba tomable por un tercero.
  const { error } = await conLease(sb
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
    .eq("status", "running"), job);
  if (error) throw new Error(`JOB_YIELD_UPDATE_FAILED:${error.message}`);
}

/** Exportada para tests (compare-and-set contra jobs cancelados). */
export async function markJobFailedOrRetryable(sb: Sb, job: DocumentProcessingJob, error: unknown, now = new Date()) {
  const attempts = job.attempts + 1;
  const retryable = attempts < job.max_attempts;
  const status: DocumentJobStatus = retryable ? "retryable" : "failed";
  const message = safeJobError(error);

  // El checkpoint NO se toca acá: vive en document_processing_jobs.checkpoint,
  // así un error transitorio (red, upstream) no obliga a repartir de cero.

  // PRIMERO el job, con compare-and-set (auditoría 2026-10-01): solo si SIGUE
  // 'running' (mismo patrón que completarJob). Antes el UPDATE no miraba el estado
  // y dejaba el documento en "procesando": un job que el usuario CANCELÓ en vuelo
  // revivía como 'retryable' y el worker lo volvía a procesar.
  const { data: marcado, error: updateError } = await conLease(sb
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
    .eq("id", job.id)
    .eq("status", "running"), job)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`JOB_FAILURE_UPDATE_FAILED:${updateError.message}`);
  // Ninguna fila: el job ya no estaba 'running' (cancelado/recuperado) o lo re-tomó
  // otro worker (lease distinto). El documento
  // queda como lo dejó quien lo cambió ("Cancelado por el usuario"): no se revive.
  if (!marcado) return;

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
/** Exportada para tests (compare-and-set + lease). */
export async function markJobFailedDefinitivo(sb: Sb, job: DocumentProcessingJob, error: Error, now = new Date()) {
  const message = error.message;
  // PRIMERO el job, con compare-and-set + lease (auditoría 2026-10-01): antes el
  // documento se pisaba sin mirar el job → un job CANCELADO perdía su "Cancelado por
  // el usuario" y uno re-tomado por otro worker quedaba fallido bajo sus pies.
  const { data: marcado, error: updateError } = await conLease(sb
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
    .eq("id", job.id)
    .eq("status", "running"), job)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`JOB_FAILURE_UPDATE_FAILED:${updateError.message}`);
  if (!marcado) return;
  await sb
    .from("documentos_subidos")
    .update({
      estado: "error",
      progreso_ia: safeJson({ estado: "error", error: message, definitivo: true, attempts: job.attempts + 1, max_attempts: job.max_attempts }),
    })
    .eq("id", job.documento_id);
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

/**
 * Cierre de job con compare-and-set: solo completa si el job SIGUE 'running' Y
 * sigue siendo NUESTRA toma (lease, ver conLease).
 * Si el usuario canceló en vuelo (status → 'cancelled'), el update no toca
 * ninguna fila y el job queda cancelado en vez de revivir como 'completed'.
 * Devuelve false en ese caso (el llamador decide qué hacer con el documento,
 * vía cerrarDocumentoNoCompletado).
 */
export async function completarJob(sb: Sb, job: DocumentProcessingJob): Promise<boolean> {
  const completedAt = new Date().toISOString();
  const { data: completado, error } = await conLease(sb
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
    .eq("status", "running"), job)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`JOB_COMPLETE_UPDATE_FAILED:${error.message}`);
  return Boolean(completado);
}

/**
 * completarJob no cerró: ¿por qué? Solo si el job quedó CANCELADO el documento pasa
 * a "Cancelado por el usuario". Si lo re-tomó otro worker (lease perdida) o lo
 * recuperó el vigilante, el documento es de quien lo tiene ahora: no se toca (antes
 * se escribía "Cancelado por el usuario" encima de un procesamiento vivo).
 */
export async function cerrarDocumentoNoCompletado(sb: Sb, job: DocumentProcessingJob): Promise<void> {
  const { data: actual } = await sb
    .from("document_processing_jobs")
    .select("status")
    .eq("id", job.id)
    .maybeSingle();
  if (actual?.status !== "cancelled") return;
  await sb
    .from("documentos_subidos")
    .update({ estado: "error", progreso_ia: safeJson({ estado: "error", error: "Cancelado por el usuario" }) })
    .eq("id", job.documento_id);
}

async function processOneJob(sb: Sb, job: DocumentProcessingJob) {
  // Un job que nació en Telegram (álbum, reproceso) gasta con la key de Telegram.
  const origen = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
    ? (job.metadata as Record<string, Json>).origen
    : null;
  return conCanalIA(origen === "telegram" ? "telegram" : "app", () => processOneJobEnCanal(sb, job));
}

async function processOneJobEnCanal(sb: Sb, job: DocumentProcessingJob) {
  const now = new Date();
  try {
    await sb
      .from("documentos_subidos")
      .update({
        estado: "procesando",
        progreso_ia: safeJson({ estado: "queued_worker", job_id: job.id, attempts: job.attempts }),
      })
      .eq("id", job.documento_id);

    const meta = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? job.metadata as Record<string, Json>
      : {};

    // Mesa FACTURA por PLANTILLA: pipeline determinístico propio. Va ANTES de
    // extractContentFromJob a propósito (la barrera de cartolas la rechazaría).
    // Telegram queda FUERA: sus fotos de la mesa factura siguen por su propio
    // camino (OCR → propuesta de factura incompleta que se termina en el Check).
    if (meta.mesa === "factura" && meta.origen !== "telegram") {
      if (job.tipo !== "excel") throw new Error("La mesa Facturas solo recibe la plantilla Excel");
      const { data: docRow } = await sb.from("documentos_subidos").select("storage_provider").eq("id", job.documento_id).maybeSingle();
      const provider = docRow?.storage_provider === "r2" ? "r2" : "supabase";
      const bajar = async (p: string): Promise<Buffer> => {
        const { data, error } = await sb.storage.from("documentos").download(p);
        if (error || !data) throw new Error(`Error descargando archivo: ${error?.message ?? "sin archivo"}`);
        return Buffer.from(await data.arrayBuffer());
      };
      const buffer = await descargarDocumento(provider, job.storage_path, bajar);
      const { procesarPlantillaFacturas } = await import("@/lib/facturas/procesar");
      const r = await procesarPlantillaFacturas(sb, { documentoId: job.documento_id, empresaId: job.empresa_id, buffer });
      const cerrado = await completarJob(sb, job);
      if (!cerrado) {
        await cerrarDocumentoNoCompletado(sb, job);
        return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: 0, cancelled: true };
      }
      return { ok: true as const, jobId: job.id, documentoId: job.documento_id, movimientos: r.movimientos_total };
    }

    const { contenido, preExtracted, plantilla, censo, textosPorImagen } = await extractContentFromJob(sb, job);
    if (!contenido.trim()) throw new Error("Documento vacio o sin contenido legible");

    let movimientosTotal: number;
    if (meta.origen === "telegram") {
      // Telegram (álbum o foto suelta vía cola): determinístico-primero + boleta al chat.
      const { clasificarComprobanteTelegram } = await import("@/lib/telegram/ingesta");
      const chatId = typeof meta.chat_id === "number" ? meta.chat_id : undefined;
      // Álbum (multi-imagen) → IA (el parser determinístico es de 1 comprobante y se
      // confunde con varios montos). Foto suelta vía cola → determinístico-primero.
      const esAlbum = Array.isArray(meta.grouped_images) && meta.grouped_images.length > 1;
      const r = await clasificarComprobanteTelegram({ documentoId: job.documento_id, empresaId: job.empresa_id, groupedText: contenido, textosPorImagen, chatId, soloIA: esAlbum, mesa: meta.mesa === "factura" ? "factura" : "boleta" });
      movimientosTotal = r.movimientos_total;
    } else {
      // Presupuesto de tiempo: si el modelo de turno es lento y no alcanza,
      // el processor hace yield con checkpoint y seguimos en otra invocación.
      const deadline = Date.now() + JOB_TIME_BUDGET_MS;
      const result = await procesarDocumento(job.documento_id, job.empresa_id, contenido, undefined, preExtracted ?? undefined, { deadline, esPlantilla: plantilla, censo });
      if (result.error) throw new Error(result.error);
      movimientosTotal = result.movimientos_total;
    }

    const completado = await completarJob(sb, job);
    if (!completado) {
      // El job dejó de ser nuestro: si fue cancelado en vuelo, el documento queda en
      // 'error' para que no aparezca como procesado; si otro worker lo re-tomó, es suyo.
      await cerrarDocumentoNoCompletado(sb, job);
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
 * Próximo job pendiente TOMABLE (excluye empresas con un job corriendo). Ver
 * proximo-job.ts. Se mantiene acá el nombre para no romper a drain.ts.
 */
export async function msHastaProximoJobPendiente(withinMs: number, sbArg?: Sb): Promise<number | null> {
  const sb = sbArg ?? serviceClient();
  if (!sb) return null;
  return msHastaProximoJobTomable(sb as unknown as SupabaseClient, withinMs);
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
