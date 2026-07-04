import { NextResponse } from "next/server";
import { processDocumentQueue } from "@/lib/document-processing/queue";
import { recordOpsError } from "@/lib/ops/events";

function requireCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  }

  try {
    const limit = Number(process.env.DOCUMENT_PROCESSING_QUEUE_LIMIT ?? "3");
    const result = await processDocumentQueue({ limit, lockOwner: "vercel-cron" });
    return NextResponse.json(result);
  } catch (error) {
    await recordOpsError({
      severity: "critical",
      source: "ops/cron",
      eventName: "document_processing_cron_failed",
      summary: "Cron de procesamiento durable fallo",
      error,
    });
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
