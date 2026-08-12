import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { enqueueDocumentProcessingJob } from "@/lib/document-processing/queue";
import { iniciarDrenaje } from "@/lib/document-processing/drain";
import { recordOpsError } from "@/lib/ops/events";

function cleanGroupedImages(value: unknown, args: { empresaId: string; documentoId: string }) {
  if (!Array.isArray(value)) return [];
  const allowedPrefix = `${args.empresaId}/${args.documentoId}/`;
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path || path.includes("..") || !path.startsWith(allowedPrefix)) return [];
    return [{
      path,
      mime: typeof record.mime === "string" ? record.mime.trim().slice(0, 80) : "image/jpeg",
      name: typeof record.name === "string" ? record.name.trim().slice(0, 120) : "imagen",
    }];
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ ok: false, error: "Usuario sin empresa" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const documentoId = typeof body.documento_id === "string" ? body.documento_id.trim() : "";
  if (!documentoId) return NextResponse.json({ ok: false, error: "documento_id requerido" }, { status: 400 });

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, empresa_id, storage_path, tipo, estado")
    .eq("id", documentoId)
    .eq("empresa_id", usuario.empresa_id)
    .single();
  if (!documento) return NextResponse.json({ ok: false, error: "Documento no encontrado" }, { status: 404 });

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const svc = createServiceClient<Database>(svcUrl, svcKey);

  const groupedImagesInput = Array.isArray(body.grouped_images) ? body.grouped_images : null;
  const groupedImages = cleanGroupedImages(groupedImagesInput, {
    empresaId: usuario.empresa_id,
    documentoId: documento.id,
  });
  if (groupedImagesInput && groupedImagesInput.length > 0 && groupedImages.length === 0) {
    return NextResponse.json({ ok: false, error: "GROUPED_IMAGES_INVALID" }, { status: 400 });
  }
  const storagePath = groupedImages[0]?.path ?? documento.storage_path;
  if (storagePath === "memoria") {
    return NextResponse.json({ ok: false, error: "Archivo original no disponible en almacenamiento — subilo nuevamente desde el escritorio" }, { status: 422 });
  }

  try {
    // force: es un reproceso EXPLÍCITO del usuario. Sin esto, un job ya 'completed'
    // se devolvía tal cual y el reproceso (incluido Deshacer→Reprocesar) era un
    // no-op silencioso que dejaba el documento con 0 movimientos.
    const job = await enqueueDocumentProcessingJob(svc, {
      documentoId: documento.id,
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      tipo: documento.tipo,
      storagePath,
      metadata: groupedImages.length ? { grouped_images: groupedImages } : {},
      force: true,
    });

    if (job.status === "running") {
      return NextResponse.json({
        ok: true,
        documento_id: documento.id,
        job_id: job.id,
        status: job.status,
        message: "El documento se está procesando en este momento.",
      });
    }

    await svc.from("documentos_subidos").update({
      estado: "procesando",
      progreso_ia: { estado: "queued", job_id: job.id },
    }).eq("id", documento.id);

    // Kick protegido con after() + drenaje encadenado (ver drain.ts): si el
    // modelo es lento, el trabajo sigue en invocaciones frescas vía /kick.
    after(async () => {
      try {
        await iniciarDrenaje("manual-reprocess-kick");
      } catch (error) {
        await recordOpsError({
          sb: svc,
          severity: "error",
          source: "ia",
          eventName: "document_processing_reprocess_kick_failed",
          summary: "No se pudo iniciar reprocesamiento oportunista",
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
      documento_id: documento.id,
      job_id: job.id,
      status: job.status,
      message: "Procesamiento encolado.",
    });
  } catch (error) {
    await recordOpsError({
      sb: svc,
      severity: "critical",
      source: "ia",
      eventName: "document_processing_manual_enqueue_failed",
      summary: "No se pudo encolar reprocesamiento de documento",
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      resourceType: "documento_subido",
      resourceId: documento.id,
      error,
    });
    return NextResponse.json({ ok: false, error: "PROCESSING_JOB_FAILED" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

export const maxDuration = 300;
