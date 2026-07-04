import { NextResponse } from "next/server";
import { getDevOperatorContext } from "@/lib/dev/support-mode";
import { processDocumentQueue, retryDocumentProcessingJob } from "@/lib/document-processing/queue";
import { recordOpsError } from "@/lib/ops/events";

function cleanUuid(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export async function POST(request: Request) {
  const operator = await getDevOperatorContext();
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.error === "NO_AUTH" ? 401 : 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const jobId = cleanUuid(body.job_id);
  const documentoId = cleanUuid(body.documento_id);
  if (!jobId && !documentoId) {
    return NextResponse.json({ ok: false, error: "JOB_ID_OR_DOCUMENTO_ID_REQUIRED" }, { status: 400 });
  }

  try {
    const job = await retryDocumentProcessingJob(operator.sb, {
      jobId: jobId ?? undefined,
      documentoId: documentoId ?? undefined,
      actorUserId: operator.userId,
    });
    const run = await processDocumentQueue({ sb: operator.sb, limit: 1, lockOwner: `dev-retry:${operator.userId}` });
    return NextResponse.json({ ok: true, job_id: job.id, status: job.status, run });
  } catch (error) {
    await recordOpsError({
      sb: operator.sb,
      severity: "error",
      source: "dev-support",
      eventName: "document_processing_retry_failed",
      summary: "No se pudo reintentar job de procesamiento de documento",
      usuarioId: operator.userId,
      resourceType: jobId ? "document_processing_job" : "documento_subido",
      resourceId: jobId ?? documentoId,
      error,
    });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ERROR_INTERNO" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
