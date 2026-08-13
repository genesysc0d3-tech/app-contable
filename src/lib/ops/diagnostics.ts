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
  metadata: Record<string, unknown> | null;
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
    documentJobsQueued: number;
    documentJobsRunning: number;
    documentJobsFailed24h: number;
    documentJobsStale: number;
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
    documentJobsQueuedResult,
    documentJobsRunningResult,
    documentJobsFailedResult,
    documentJobsStaleResult,
    latestEventsResult,
    listasSinAprobarResult,
    aprobadasResult,
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
      .from("document_processing_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "retryable"])
      .lte("next_run_at", checkedAt),
    sb
      .from("document_processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running"),
    sb
      .from("document_processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("updated_at", since24h),
    sb
      .from("document_processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running")
      .lt("locked_at", new Date(now.getTime() - 15 * 60 * 1000).toISOString()),
    sb
      .from("ops_events")
      .select("id, severity, source, event_name, summary, resource_type, resource_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    // Embudo: boletas "listo" creadas hace >30 min (sin updated_at en la tabla,
    // created_at es el proxy disponible). Cruzado contra las aprobadas: una
    // empresa con listas y CERO aprobadas probablemente no encontró el botón
    // Aprobar (caso real de beta 2026-08-12: "Emitir dice que no hay ninguna
    // propuesta" con 73 listas esperando).
    sb
      .from("propuestas_ia")
      .select("empresa_id")
      .eq("estado", "listo")
      .lt("created_at", new Date(now.getTime() - 30 * 60 * 1000).toISOString())
      .limit(2000),
    sb
      .from("propuestas_ia")
      .select("empresa_id")
      .eq("estado", "aprobado")
      .limit(2000),
  ]);

  const metrics = {
    documentosAtascados: countFrom(documentosAtascadosResult, "documentos_subidos", queryErrors),
    locksExpirados: countFrom(locksExpiradosResult, "emision_locks", queryErrors),
    jobsEmisionFallidos24h: countFrom(jobsFallidosResult, "emision_jobs", queryErrors),
    opsErrores24h: countFrom(opsErroresResult, "ops_events_error", queryErrors),
    opsCriticos24h: countFrom(opsCriticosResult, "ops_events_critical", queryErrors),
    documentJobsQueued: countFrom(documentJobsQueuedResult, "document_processing_jobs_queued", queryErrors),
    documentJobsRunning: countFrom(documentJobsRunningResult, "document_processing_jobs_running", queryErrors),
    documentJobsFailed24h: countFrom(documentJobsFailedResult, "document_processing_jobs_failed", queryErrors),
    documentJobsStale: countFrom(documentJobsStaleResult, "document_processing_jobs_stale", queryErrors),
  };

  if (latestEventsResult.error) queryErrors.push(`ops_events_latest: ${latestEventsResult.error.message}`);
  if (listasSinAprobarResult.error) queryErrors.push(`propuestas_listas: ${listasSinAprobarResult.error.message}`);
  if (aprobadasResult.error) queryErrors.push(`propuestas_aprobadas: ${aprobadasResult.error.message}`);

  // Empresas con boletas listas hace >30 min y ni UNA aprobada: señal de que el
  // usuario quedó pegado en el paso Aprobar (Emitir le muestra vacío).
  const listasPorEmpresa = new Map<string, number>();
  for (const row of listasSinAprobarResult.data ?? []) {
    if (row.empresa_id) listasPorEmpresa.set(row.empresa_id, (listasPorEmpresa.get(row.empresa_id) ?? 0) + 1);
  }
  const empresasConAprobadas = new Set((aprobadasResult.data ?? []).map((r) => r.empresa_id));
  const empresasAtascadas = [...listasPorEmpresa.entries()]
    .filter(([empresaId]) => !empresasConAprobadas.has(empresaId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  let nombresAtascadas = new Map<string, string>();
  if (empresasAtascadas.length > 0) {
    const { data: empRows } = await sb
      .from("empresas")
      .select("id, razon_social")
      .in("id", empresasAtascadas.map(([id]) => id));
    nombresAtascadas = new Map((empRows ?? []).map((e) => [e.id, e.razon_social]));
  }

  const findings: OpsFinding[] = [];
  for (const [empresaId, listas] of empresasAtascadas) {
    findings.push({
      severity: "warn",
      eventName: "embudo_listas_sin_aprobar",
      summary: `${nombresAtascadas.get(empresaId) ?? empresaId} tiene ${listas} boleta(s) lista(s) hace más de 30 min y ninguna aprobada — probable atasco en el paso Aprobar (Emitir se le ve vacío)`,
      metadata: { empresa_id: empresaId, listas, threshold_minutes: 30 },
    });
  }
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
  if (metrics.documentJobsStale > 0) {
    findings.push({
      severity: "critical",
      eventName: "document_processing_jobs_atascados",
      summary: `${metrics.documentJobsStale} job(s) de documentos llevan mas de 15 minutos running`,
      metadata: { count: metrics.documentJobsStale, threshold_minutes: 15 },
    });
  }
  if (metrics.documentJobsFailed24h > 0) {
    findings.push({
      severity: "warn",
      eventName: "document_processing_jobs_failed_24h",
      summary: `${metrics.documentJobsFailed24h} job(s) de documentos fallidos en 24 horas`,
      metadata: { count: metrics.documentJobsFailed24h },
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
    // metadata llega como Json (puede ser string/number); el panel solo sabe leer
    // objetos, así que normalizamos lo demás a null.
    latestEvents: (latestEventsResult.data ?? []).map((e) => ({
      ...e,
      metadata: e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
        ? (e.metadata as Record<string, unknown>)
        : null,
    })),
    queryErrors,
  };
}
