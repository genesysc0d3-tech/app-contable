import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OpsSeverity } from "@/lib/ops/events";

type Sb = SupabaseClient<Database>;

export type OpsFinding = {
  severity: Exclude<OpsSeverity, "info">;
  eventName: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type OpsLatestEvent = {
  id: string;
  severity: string;
  source: string;
  event_name: string;
  summary: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
};

export type OpsSnapshot = {
  ok: boolean;
  status: "ok" | "degraded" | "critical";
  checkedAt: string;
  metrics: {
    documentosAtascados: number;
    locksExpirados: number;
    jobsEmisionFallidos24h: number;
    opsErrores24h: number;
    opsCriticos24h: number;
  };
  findings: OpsFinding[];
  latestEvents: OpsLatestEvent[];
  queryErrors: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_DOC_MS = 20 * 60 * 1000;

function countFrom(result: { count: number | null; error: { message: string } | null }, label: string, errors: string[]) {
  if (result.error) {
    errors.push(`${label}: ${result.error.message}`);
    return 0;
  }
  return result.count ?? 0;
}

export async function collectOpsSnapshot(sb: Sb, now = new Date()): Promise<OpsSnapshot> {
  const checkedAt = now.toISOString();
  const since24h = new Date(now.getTime() - DAY_MS).toISOString();
  const staleDocs = new Date(now.getTime() - STUCK_DOC_MS).toISOString();
  const queryErrors: string[] = [];

  const [
    documentosAtascadosResult,
    locksExpiradosResult,
    jobsFallidosResult,
    opsErroresResult,
    opsCriticosResult,
    latestEventsResult,
  ] = await Promise.all([
    sb
      .from("documentos_subidos")
      .select("id", { count: "exact", head: true })
      .eq("estado", "procesando")
      .lt("created_at", staleDocs),
    sb
      .from("emision_locks")
      .select("cuenta_id", { count: "exact", head: true })
      .lt("locked_until", checkedAt),
    sb
      .from("emision_jobs")
      .select("job_id", { count: "exact", head: true })
      .in("estado", ["failed", "expired"])
      .gte("created_at", since24h),
    sb
      .from("ops_events")
      .select("id", { count: "exact", head: true })
      .in("severity", ["error", "critical"])
      .gte("created_at", since24h),
    sb
      .from("ops_events")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical")
      .gte("created_at", since24h),
    sb
      .from("ops_events")
      .select("id, severity, source, event_name, summary, resource_type, resource_id, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const metrics = {
    documentosAtascados: countFrom(documentosAtascadosResult, "documentos_subidos", queryErrors),
    locksExpirados: countFrom(locksExpiradosResult, "emision_locks", queryErrors),
    jobsEmisionFallidos24h: countFrom(jobsFallidosResult, "emision_jobs", queryErrors),
    opsErrores24h: countFrom(opsErroresResult, "ops_events_error", queryErrors),
    opsCriticos24h: countFrom(opsCriticosResult, "ops_events_critical", queryErrors),
  };

  if (latestEventsResult.error) queryErrors.push(`ops_events_latest: ${latestEventsResult.error.message}`);

  const findings: OpsFinding[] = [];
  if (metrics.documentosAtascados > 0) {
    findings.push({
      severity: "critical",
      eventName: "documentos_procesando_atascados",
      summary: `${metrics.documentosAtascados} documento(s) llevan mas de 20 minutos en estado procesando`,
      metadata: { count: metrics.documentosAtascados, threshold_minutes: 20 },
    });
  }
  if (metrics.opsCriticos24h > 0) {
    findings.push({
      severity: "critical",
      eventName: "ops_critical_events_24h",
      summary: `${metrics.opsCriticos24h} evento(s) criticos en las ultimas 24 horas`,
      metadata: { count: metrics.opsCriticos24h },
    });
  }
  if (metrics.jobsEmisionFallidos24h > 0) {
    findings.push({
      severity: "warn",
      eventName: "emision_jobs_fallidos_24h",
      summary: `${metrics.jobsEmisionFallidos24h} job(s) de emision fallidos o expirados en 24 horas`,
      metadata: { count: metrics.jobsEmisionFallidos24h },
    });
  }
  if (metrics.locksExpirados > 0) {
    findings.push({
      severity: "warn",
      eventName: "emision_locks_expirados",
      summary: `${metrics.locksExpirados} lock(s) de emision expirados siguen en la tabla`,
      metadata: { count: metrics.locksExpirados },
    });
  }
  if (queryErrors.length > 0) {
    findings.push({
      severity: "warn",
      eventName: "ops_snapshot_partial",
      summary: "La lectura de salud operacional fue parcial",
      metadata: { query_errors: queryErrors },
    });
  }

  const status = findings.some((finding) => finding.severity === "critical")
    ? "critical"
    : findings.length > 0
      ? "degraded"
      : "ok";

  return {
    ok: queryErrors.length === 0,
    status,
    checkedAt,
    metrics,
    findings,
    latestEvents: latestEventsResult.data ?? [],
    queryErrors,
  };
}
