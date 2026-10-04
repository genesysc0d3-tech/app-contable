import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { GLOSA_CADUCADA, RETENCION_ANOS, RETENCION_DECISIONES_DIAS, cutoffRetencionISO } from "@/lib/retencion";
import { recalcularEstadoReglas } from "@/lib/ai/reglas-historial";

/**
 * Reglas con historial (Fase 3 del clasificador): una vez por noche se recalcula el
 * estado derivado de la evidencia (a_prueba → firme con cartolas emitidas; en_disputa
 * por correcciones) de las empresas con reglas de usuario. Best-effort: nunca tumba la
 * purga de retención. También corre al abrir "Lo que aprendí".
 */
async function recalcularReglasDeTodas(sb: NonNullable<ReturnType<typeof serviceClient>>) {
  const empresas = new Set<string>();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("clasificacion_reglas")
      .select("empresa_id")
      .not("empresa_id", "is", null)
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) return { empresas: 0, revisadas: 0, cambiadas: 0, errores: 1 };
    for (const r of data ?? []) if (r.empresa_id) empresas.add(r.empresa_id);
    if (!data || data.length < 1000) break;
  }
  let revisadas = 0, cambiadas = 0, errores = 0;
  for (const empresaId of empresas) {
    try {
      const r = await recalcularEstadoReglas(sb, empresaId);
      revisadas += r.revisadas;
      cambiadas += r.cambiadas;
      if (r.error) errores += 1;
    } catch {
      errores += 1;
    }
  }
  return { empresas: empresas.size, revisadas, cambiadas, errores };
}

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
  const cutoffDecisiones = new Date(now - RETENCION_DECISIONES_DIAS * 24 * 60 * 60 * 1000).toISOString();

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

    // Log de decisiones del clasificador (Fase 1 medición): misma retención que
    // las boletas. count, no select: pueden ser muchas filas.
    const decisiones = await sb
      .from("propuesta_decisiones")
      .delete({ count: "exact" })
      .lt("created_at", cutoffDecisiones);

    const auditBorrados = audit.error ? -1 : (audit.data?.length ?? 0);
    const decisionesBorradas = decisiones.error ? -1 : (decisiones.count ?? 0);
    const logsBorrados = logs.error ? -1 : (logs.data?.length ?? 0);
    const glosasAnonimizadas = glosa.error ? -1 : (glosa.data?.length ?? 0);

    if (audit.error || logs.error || glosa.error || decisiones.error) {
      await recordOpsError({
        sb,
        severity: "error",
        source: "audit/cron",
        eventName: "retencion_purge_parcial",
        summary: "La purga de retención falló parcialmente",
        error: audit.error ?? logs.error ?? glosa.error ?? decisiones.error,
      });
    } else {
      await recordOpsEvent({
        sb,
        severity: "info",
        source: "audit/cron",
        eventName: "retencion_purge",
        summary: `Retención: ${auditBorrados} audit_chunks + ${logsBorrados} parser_logs purgados (>${RETENCION_DIAS}d), ${glosasAnonimizadas} glosas anonimizadas (>${RETENCION_ANOS}a), ${decisionesBorradas} decisiones purgadas (>${RETENCION_DECISIONES_DIAS}d)`,
        metadata: { cutoff, cutoffGlosa, cutoffDecisiones, auditBorrados, logsBorrados, glosasAnonimizadas, decisionesBorradas },
      }).catch(() => {});
    }

    // Separado de la purga: si falla, la purga ya quedó hecha y reportada.
    let reglas: Awaited<ReturnType<typeof recalcularReglasDeTodas>> | null = null;
    try {
      reglas = await recalcularReglasDeTodas(sb);
      await recordOpsEvent({
        sb,
        severity: reglas.errores > 0 ? "warn" : "info",
        source: "audit/cron",
        eventName: "reglas_estado_recalculado",
        summary: `Reglas con historial: ${reglas.cambiadas} cambiaron de estado (${reglas.revisadas} revisadas en ${reglas.empresas} empresas, ${reglas.errores} con error)`,
        metadata: reglas,
      }).catch(() => {});
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: !audit.error && !logs.error && !glosa.error && !decisiones.error,
      reglas_recalculadas: reglas,
      cutoff,
      cutoff_glosa: cutoffGlosa,
      audit_chunks_borrados: auditBorrados,
      parser_logs_borrados: logsBorrados,
      glosas_anonimizadas: glosasAnonimizadas,
      decisiones_purgadas: decisionesBorradas,
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
