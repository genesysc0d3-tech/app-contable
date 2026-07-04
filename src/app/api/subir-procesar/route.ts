import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { validateProcesarUploadPayload } from "@/lib/upload/process-upload-validation";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { enqueueDocumentProcessingJob, processDocumentQueue } from "@/lib/document-processing/queue";
import { defaultStorageProvider, subirDocumentoR2 } from "@/lib/storage";

export async function POST(request: Request) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("subir-procesar", user.id),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  let body: { nombre?: string; base64?: string; tipo?: string; mime?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const validated = validateProcesarUploadPayload(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  const buffer = Buffer.from(validated.base64, "base64");

  const { data: doc, error: docError } = await supabase
    .from("documentos_subidos")
    .insert({
      empresa_id: usuario.empresa_id,
      nombre_archivo: validated.nombre,
      tipo: validated.tipo,
      storage_path: "memoria",
      estado: "subido",
    })
    .select()
    .single();

  if (docError) {
    await recordOpsError({
      severity: "error",
      source: "upload",
      eventName: "upload_document_insert_failed",
      summary: "No se pudo crear el documento subido",
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      error: docError,
      metadata: { tipo: validated.tipo, mime: validated.contentType, nombre: validated.nombre },
    });
    return NextResponse.json({ error: docError.message }, { status: 500 });
  }
  if (!doc) return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createServiceClient<Database>(svcUrl, svcKey);

  // Guardar archivo: R2 si está configurado (no quema storage/egress de Supabase),
  // si no fallback a Supabase Storage. La key/provider quedan en el documento.
  const contentType = validated.contentType;
  let storagePath: string;
  let storageProvider: "r2" | "supabase";
  let storageFailed: string | null = null;
  if (defaultStorageProvider() === "r2") {
    storageProvider = "r2";
    try {
      const up = await subirDocumentoR2(usuario.empresa_id, `${doc.id}__${validated.nombre}`, buffer, contentType);
      storagePath = up.key;
    } catch (e) {
      storagePath = "";
      storageFailed = e instanceof Error ? e.message : "R2_UPLOAD_FAILED";
    }
  } else {
    storageProvider = "supabase";
    storagePath = `${usuario.empresa_id}/${doc.id}/${validated.nombre}`;
    const { error: storageError } = await svc.storage
      .from("documentos")
      .upload(storagePath, buffer, { contentType, upsert: true });
    if (storageError) storageFailed = storageError.message;
  }

  if (!storageFailed) {
    await svc.from("documentos_subidos")
      .update({ storage_path: storagePath, storage_provider: storageProvider, fuente_datos: "panel" })
      .eq("id", doc.id);
  } else {
    await svc.from("documentos_subidos").update({
      estado: "error",
      progreso_ia: { estado: "error", error: "No se pudo guardar archivo en Storage" },
    }).eq("id", doc.id);
    await recordOpsEvent({
      sb: svc,
      severity: "error",
      source: "upload",
      eventName: "upload_storage_failed",
      summary: "No se pudo guardar archivo en Storage; no se encolo procesamiento",
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      resourceType: "documento_subido",
      resourceId: doc.id,
      metadata: { storage_error: storageFailed, tipo: validated.tipo, mime: contentType },
    });
    return NextResponse.json({ ok: false, error: "STORAGE_UPLOAD_FAILED" }, { status: 502 });
  }

  let job;
  try {
    job = await enqueueDocumentProcessingJob(svc, {
      documentoId: doc.id,
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      tipo: validated.tipo,
      storagePath,
      metadata: { mime: contentType, nombre: validated.nombre },
    });
  } catch (error) {
    await svc.from("documentos_subidos").update({
      estado: "error",
      progreso_ia: { estado: "error", error: "No se pudo encolar procesamiento" },
    }).eq("id", doc.id);
    await recordOpsError({
      sb: svc,
      severity: "critical",
      source: "upload",
      eventName: "document_processing_enqueue_failed",
      summary: "No se pudo crear job durable para documento",
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      resourceType: "documento_subido",
      resourceId: doc.id,
      error,
      metadata: { tipo: validated.tipo, mime: contentType },
    });
    return NextResponse.json({ ok: false, error: "PROCESSING_JOB_FAILED" }, { status: 500 });
  }

  await svc.from("documentos_subidos").update({
    estado: "procesando",
    progreso_ia: { estado: "queued", job_id: job.id },
  }).eq("id", doc.id);

  // Kick oportunista: si la funcion serverless muere, el job durable queda y
  // el cron lo retoma. No dependemos de esta promesa para no perder trabajo.
  processDocumentQueue({ sb: svc, limit: 1, lockOwner: "upload-kick" }).catch((error) => {
    void recordOpsError({
      sb: svc,
      severity: "error",
      source: "upload",
      eventName: "document_processing_kick_failed",
      summary: "No se pudo iniciar procesamiento oportunista despues de upload",
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      resourceType: "document_processing_job",
      resourceId: job.id,
      error,
    });
  });

  return NextResponse.json({
    ok: true,
    documento_id: doc.id,
    job_id: job.id,
    status: job.status,
    message: "Procesamiento encolado.",
  });
}
