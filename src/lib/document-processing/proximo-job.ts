import type { SupabaseClient } from "@supabase/supabase-js";
import { STALE_RUNNING_MS } from "./state";

/**
 * Empresas con un job `running` (uno a la vez por empresa: claimJobs las salta).
 * `soloFrescos`: ignora los running más viejos que el reaper (el próximo drenaje los
 * recupera antes de reclamar). null = no se pudo consultar.
 */
export async function empresasOcupadas(
  sb: SupabaseClient,
  opts: { soloFrescos: boolean; now?: Date },
): Promise<string[] | null> {
  let q = sb.from("document_processing_jobs").select("empresa_id").eq("status", "running");
  if (opts.soloFrescos) {
    const staleIso = new Date((opts.now ?? new Date()).getTime() - STALE_RUNNING_MS).toISOString();
    q = q.gte("locked_at", staleIso);
  }
  const { data, error } = await q.limit(500);
  if (error) return null;
  return [...new Set((data ?? []).map((r) => (r as { empresa_id: string }).empresa_id).filter(Boolean))];
}

/**
 * ¿Cuánto falta (ms) para el próximo job pendiente que un drenaje PUEDE TOMAR?
 * - 0 si ya está vencido, null si no hay ninguno tomable dentro del horizonte.
 *
 * Lo usa el drenaje encadenado para NO morir cuando lo único que queda es un
 * reintento con backoff a 1-2 min de futuro (incidente 2026-08-22: la cadena
 * terminaba y la cartola quedaba a medias hasta el cron del día siguiente).
 *
 * TOMABLE (2026-09-28, plan-costo-vercel §6 PR 4): claimJobs salta las empresas que
 * ya tienen un job `running` (uno a la vez por empresa). Antes esta sonda no lo
 * miraba: con la cartola larga de una empresa corriendo en otra invocación, su
 * siguiente documento "vencido" hacía encadenar kicks SIN progreso hasta el tope de
 * 40 eslabones. Esa empresa la retoma su propia invocación al terminar. Un `running`
 * colgado (más viejo que STALE_RUNNING_MS) NO bloquea: el próximo drenaje lo recupera.
 */
export async function msHastaProximoJobTomable(
  sb: SupabaseClient,
  withinMs: number,
  now: Date = new Date(),
): Promise<number | null> {
  // Si no se puede saber quién corre, se comporta como antes (sin filtro): prefiere
  // encadenar de más a dejar una cartola colgada hasta el cron.
  const ocupadas = (await empresasOcupadas(sb, { soloFrescos: true, now })) ?? [];

  let q = sb
    .from("document_processing_jobs")
    .select("next_run_at")
    .in("status", ["queued", "retryable"]);
  if (ocupadas.length > 0) q = q.not("empresa_id", "in", `(${ocupadas.join(",")})`);
  const { data, error } = await q.order("next_run_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data) return null;
  const nextRunAt = (data as { next_run_at: string | null }).next_run_at;
  if (!nextRunAt) return null;
  const delta = new Date(nextRunAt).getTime() - now.getTime();
  if (delta > withinMs) return null;
  return Math.max(0, delta);
}
