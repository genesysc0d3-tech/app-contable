import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { eleccionEmpresaPendiente } from "@/lib/entitlements";
import { validateProcesarUploadPayload } from "@/lib/upload/process-upload-validation";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { enqueueDocumentProcessingJob } from "@/lib/document-processing/queue";
import { iniciarDrenaje } from "@/lib/document-processing/drain";
import { defaultStorageProvider, subirDocumentoR2 } from "@/lib/storage";
import { createHash } from "crypto";

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

  // Downgrade con elección de empresa operativa pendiente: la operación queda
  // en pausa hasta que el titular elija (si no, esta API sería un Business
  // gratis para quien le pegue con la cookie directo, saltándose el modal).
  if (await eleccionEmpresaPendiente(supabase, usuario.empresa_id)) {
    return NextResponse.json(
      { error: "Tu cuenta cambió de plan y debe elegir su empresa operativa. Entra al escritorio para elegirla." },
      { status: 403 },
    );
  }

  let body: { nombre?: string; base64?: string; tipo?: string; mime?: string; contexto?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const validated = validateProcesarUploadPayload(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  const buffer = Buffer.from(validated.base64, "base64");

  // Dedup por hash: re-subir la MISMA cartola (error humano común) duplicaba el
  // 100% de los movimientos — el carril bypass salta el dedup por-movimiento y no
  // había chequeo de hash de archivo. Si este archivo EXACTO ya se procesó para
  // esta empresa, devolvemos el documento existente (idempotente) en vez de crear
  // otro y re-procesar → cero duplicados. Solo bloquea los estados DONE: un upload
  // en error / en curso / stuck se puede re-subir sin problema.
  const archivoHash = createHash("sha256").update(buffer).digest("hex");
  // 2026-08-22 (incidente clienta M&E): el bloqueo era solo para estados DONE, así
  // que ante un error de IA la gente re-subía el mismo archivo una y otra vez → 4
  // copias del mismo documento en la mesa. Ahora se bloquea CUALQUIER duplicado
  // vivo: si está en curso se espera, si está en error se usa ↻ Reintentar en su
  // tarjeta. Única excepción: un doc en error SIN archivo guardado (falló el
  // storage) es un cascarón — ahí sí se permite subir de nuevo.
  const { data: yaExiste } = await supabase
    .from("documentos_subidos")
    .select("id, estado, storage_path")
    .eq("empresa_id", usuario.empresa_id)
    .eq("archivo_hash", archivoHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const esCascaron = yaExiste?.estado === "error" &&
    (!yaExiste.storage_path || yaExiste.storage_path === "memoria");
  if (yaExiste && !esCascaron) {
    const enCurso = yaExiste.estado === "procesando" || yaExiste.estado === "subido";
    return NextResponse.json({
      ok: true,
      documento_id: yaExiste.id,
      ya_procesado: true,
      estado_previo: yaExiste.estado,
      message: enCurso
        ? "Este archivo ya se está procesando; no se subió de nuevo."
        : yaExiste.estado === "error"
          ? "Este archivo ya está en la mesa con error; usa ↻ Reintentar en su tarjeta."
          : "Este archivo ya se subió y procesó antes; no se volvió a subir (evita duplicar movimientos).",
    });
  }

  const { data: doc, error: docError } = await supabase
    .from("documentos_subidos")
    .insert({
      empresa_id: usuario.empresa_id,
      nombre_archivo: validated.nombre,
      tipo: validated.tipo,
      contexto_usuario: validated.contexto,
      storage_path: "memoria",
      estado: "subido",
      archivo_hash: archivoHash,
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

  // Kick protegido con after(): la plataforma mantiene viva la invocación
  // hasta que el drenaje termine o se encadene a una invocación fresca vía
  // /kick. Si aun así algo muere, el job durable queda y el cron lo retoma.
  after(async () => {
    try {
      await iniciarDrenaje("upload-kick");
    } catch (error) {
      await recordOpsError({
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
    }
  });

  return NextResponse.json({
    ok: true,
    documento_id: doc.id,
    job_id: job.id,
    status: job.status,
    message: "Procesamiento encolado.",
  });
}

export const maxDuration = 300;
