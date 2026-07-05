import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { GLOSA_CADUCADA, RETENCION_ANOS, cutoffRetencionISO } from "@/lib/retencion";

// Purga de retención (auditoría #11, Ley 21.719 — limitación de conservación).
// audit_chunks guarda texto CRUDO de cartolas (PII); parser_logs, diagnósticos.
// Son artefactos de depuración: se conservan 30 días y se borran. Ambos FK a
// documentos_subidos son ON DELETE SET NULL, así que borrarlos no cascada nada.
//
// Además anonimiza la glosa cruda de movimientos_raw a los 6 años (Código
// Tributario): esa glosa puede traer nombre/RUT de terceros no consentidos. Se
// scrubbea el texto (no se borra la fila) para no romper el rastro contable
// hacia la boleta. Ver src/lib/retencion.ts.

const RETENCION_DIAS = 30;

function requireCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  }

  const sb = serviceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });

  const now = Date.now();
  const cutoff = new Date(now - RETENCION_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const cutoffGlosa = cutoffRetencionISO(now);

  try {
    const audit = await sb.from("audit_chunks").delete().lt("created_at", cutoff).select("id");
    const logs = await sb.from("parser_logs").delete().lt("created_at", cutoff).select("id");

    // Anonimización de la glosa cruda a los 6 años. UPDATE (no DELETE) para no
    // cascadear propuestas_ia ni cortar el enlace boleta→movimiento. El neq
    // salta las ya anonimizadas → idempotente y barato en cada corrida.
    const glosa = await sb
      .from("movimientos_raw")
      .update({ descripcion: GLOSA_CADUCADA })
      .lt("created_at", cutoffGlosa)
      .neq("descripcion", GLOSA_CADUCADA)
      .select("id");

    const auditBorrados = audit.error ? -1 : (audit.data?.length ?? 0);
    const logsBorrados = logs.error ? -1 : (logs.data?.length ?? 0);
    const glosasAnonimizadas = glosa.error ? -1 : (glosa.data?.length ?? 0);

    if (audit.error || logs.error || glosa.error) {
      await recordOpsError({
        sb,
        severity: "error",
        source: "audit/cron",
        eventName: "retencion_purge_parcial",
        summary: "La purga de retención falló parcialmente",
        error: audit.error ?? logs.error ?? glosa.error,
      });
    } else {
      await recordOpsEvent({
        sb,
        severity: "info",
        source: "audit/cron",
        eventName: "retencion_purge",
        summary: `Retención: ${auditBorrados} audit_chunks + ${logsBorrados} parser_logs purgados (>${RETENCION_DIAS}d), ${glosasAnonimizadas} glosas anonimizadas (>${RETENCION_ANOS}a)`,
        metadata: { cutoff, cutoffGlosa, auditBorrados, logsBorrados, glosasAnonimizadas },
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: !audit.error && !logs.error && !glosa.error,
      cutoff,
      cutoff_glosa: cutoffGlosa,
      audit_chunks_borrados: auditBorrados,
      parser_logs_borrados: logsBorrados,
      glosas_anonimizadas: glosasAnonimizadas,
    });
  } catch (error) {
    await recordOpsError({
      sb,
      severity: "critical",
      source: "audit/cron",
      eventName: "retencion_cron_failed",
      summary: "El cron de retención falló",
      error,
    });
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
