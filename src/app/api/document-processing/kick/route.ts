import { NextResponse, after } from "next/server";
import { drainAndChain } from "@/lib/document-processing/drain";
import { recordOpsError } from "@/lib/ops/events";

/**
 * Eslabón del drenaje encadenado de la cola de documentos.
 *
 * Responde 200 AL INSTANTE y drena dentro de after(): así el eslabón anterior
 * solo espera milisegundos por la respuesta y cada invocación trabaja con sus
 * 300s completos. Auth = CRON_SECRET (mismo guardián que el cron diario).
 */
function requireCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  }

  let depth = 0;
  try {
    const body = (await request.json()) as { depth?: number } | null;
    if (body && typeof body.depth === "number" && Number.isFinite(body.depth)) {
      depth = Math.max(0, Math.floor(body.depth));
    }
  } catch {
    // Sin body o body inválido → depth 0.
  }

  after(async () => {
    try {
      await drainAndChain({ lockOwner: `kick:${depth}`, depth });
    } catch (error) {
      await recordOpsError({
        severity: "critical",
        source: "ia",
        eventName: "document_processing_kick_drain_failed",
        summary: "El drenaje encadenado de la cola falló",
        error,
        metadata: { depth },
      });
    }
  });

  return NextResponse.json({ ok: true, depth });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
