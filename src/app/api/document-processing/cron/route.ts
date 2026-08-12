import { NextResponse } from "next/server";
import { drainAndChain } from "@/lib/document-processing/drain";
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
    // Backstop diario (Hobby: crons 1 vez/día): drena con presupuesto y se
    // encadena vía /kick si queda trabajo — no procesa todo en ESTA invocación.
    const result = await drainAndChain({ lockOwner: "vercel-cron", depth: 0 });
    return NextResponse.json({ ok: true, ...result });
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
export const maxDuration = 300;
