import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OpsSeverity } from "@/lib/ops/events";
import { isR2Configured, r2ObjetoMasNuevo } from "@/lib/r2";

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

/**
 * Vigila que los respaldos de la base sigan llegando a R2.
 *
 * El respaldo lo hace un Mac mini en la casa del fundador (Supabase Free no
 * trae respaldos: ni diarios ni PITR). Ese guión se avisa a sí mismo cuando
 * falla, pero NO puede avisar de lo único que de verdad importa: que no haya
 * corrido. Si el mini se apaga, se queda sin internet o alguien desinstala la
 * tarea, el silencio se ve idéntico a "todo bien".
 *
 * Por eso el vigilante corre acá, en Vercel: fuera de la casa, fuera de la
 * máquina, y sin nada en común con lo que vigila.
 *
 * Un respaldo diario sano tiene menos de 26 horas (24 + margen). Sobre 48
 * significa que se saltó al menos un día entero.
 *
 * LO QUE NO SALE AL PANEL: el nombre del archivo, el prefijo, el proveedor ni
 * la máquina. Antes el resumen imprimía la ruta completa y la metadata llevaba
 * el prefijo del bucket. El panel es god-mode pero sigue siendo una página web
 * que se ve en capturas, y el respaldo es lo último que queda si todo lo demás
 * se cae: saber que anda no exige saber dónde está. Lo que sí sale es el
 * tiempo, que es lo único accionable.
 */
const RESPALDO_PREFIJO = "respaldos-db/";
const RESPALDO_HORAS_WARN = 26;
const RESPALDO_HORAS_CRITICO = 48;

/**
 * El mensaje de un error de red trae host, URL firmada o nombre del bucket.
 * Para el panel basta con saber QUÉ falló, no contra qué: se recorta y se le
 * borra cualquier cosa que parezca una dirección.
 */
function errorSinUbicacion(error: unknown): string {
  const crudo = error instanceof Error ? error.message : "error desconocido";
  return crudo
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\w.-]*\b(r2|cloudflarestorage|amazonaws|s3)\b[\w.-]*/gi, "")
    .replace(/respaldos?-db\S*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120) || "error desconocido";
}

export async function revisarRespaldos(): Promise<OpsFinding[]> {
  // Sin R2 configurado no hay nada que vigilar (entornos locales, previews).
  if (!isR2Configured()) return [];
  let ultimo: Awaited<ReturnType<typeof r2ObjetoMasNuevo>>;
  try {
    ultimo = await r2ObjetoMasNuevo(RESPALDO_PREFIJO);
  } catch (error) {
    return [{
      severity: "warn",
      eventName: "respaldo_db_no_verificable",
      // El mensaje del error se recorta y se limpia: puede traer el host o la
      // URL firmada del almacenamiento, que es justo lo que no debe aparecer.
      summary: `No se pudo verificar el estado de los respaldos: ${errorSinUbicacion(error)}`,
    }];
  }

  if (!ultimo) {
    return [{
      severity: "critical",
      eventName: "respaldo_db_inexistente",
      summary: "No hay NINGÚN respaldo de la base. El plan que tenemos no trae respaldos propios, así que ahora mismo no hay de dónde restaurar.",
    }];
  }

  const horas = (Date.now() - ultimo.modificado.getTime()) / 3_600_000;
  if (horas < RESPALDO_HORAS_WARN) return [];

  const critico = horas >= RESPALDO_HORAS_CRITICO;
  return [{
    severity: critico ? "critical" : "warn",
    eventName: "respaldo_db_atrasado",
    summary: `El último respaldo de la base tiene ${Math.floor(horas)} horas. ${critico ? "Se saltó al menos un día completo — revisar la máquina que respalda." : "Debería llegar uno cada 24 h."}`,
    metadata: {
      horas: Math.floor(horas),
      bytes: ultimo.bytes,
      modificado: ultimo.modificado.toISOString(),
    },
  }];
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
  // El vigilante de respaldos entra acá para reutilizar el mismo cron, la misma
  // autenticación y el mismo canal de alerta que el resto de operaciones.
  findings.push(...(await revisarRespaldos()));
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
