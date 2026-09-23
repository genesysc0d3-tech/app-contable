import "server-only";

import { processDocumentQueue, msHastaProximoJobPendiente } from "./queue";
import { DRAIN_BUDGET_MS, MAX_CHAIN_DEPTH, STALE_RUNNING_MS } from "./state";
import { recordOpsError } from "@/lib/ops/events";

/**
 * Drenaje encadenado de la cola de procesamiento.
 *
 * El problema que resuelve: en el plan Hobby de Vercel el cron corre 1 vez al
 * día y cada invocación muere a los 300s. Un "empujón" post-subida que procesa
 * inline muere con la función si el modelo de IA es lento, y el documento
 * queda esperando hasta el cron de mañana.
 *
 * El diseño: cada invocación procesa jobs de a 1 hasta agotar su presupuesto
 * (`DRAIN_BUDGET_MS` para el loop; el job mismo hace yield con checkpoint vía
 * `JOB_TIME_BUDGET_MS`), y si queda trabajo reclamable se re-invoca a sí misma
 * (`/api/document-processing/kick`, que responde al tiro y drena en `after()`).
 * Así la cola siempre avanza, sin importar qué tan lento sea el proveedor.
 */

function appOrigin(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
}

export type DrainResult = {
  rondas: number;
  completados: number;
  yields: number;
  fallidos: number;
  recuperados: number;
  presupuestoAgotado: boolean;
};

type ProcessFn = typeof processDocumentQueue;

export async function drainDocumentQueue(args?: {
  lockOwner?: string;
  budgetMs?: number;
  /** Inyectable para tests. */
  processFn?: ProcessFn;
}): Promise<DrainResult> {
  const budgetMs = args?.budgetMs ?? DRAIN_BUDGET_MS;
  const processFn = args?.processFn ?? processDocumentQueue;
  const t0 = Date.now();
  const out: DrainResult = { rondas: 0, completados: 0, yields: 0, fallidos: 0, recuperados: 0, presupuestoAgotado: false };

  for (;;) {
    if (Date.now() - t0 > budgetMs) {
      out.presupuestoAgotado = true;
      break;
    }
    const r = await processFn({ limit: 1, lockOwner: args?.lockOwner ?? "drain" });
    out.rondas++;
    out.completados += r.completed;
    out.yields += r.yielded ?? 0;
    out.fallidos += r.failed_or_retryable;
    out.recuperados += r.recovered;
    // claimed 0 = no hay nada reclamable AHORA (cola vacía, backoff futuro, o
    // la empresa ya tiene un job corriendo en otra invocación). Paramos; si un
    // yield dejó trabajo re-reclamable, el chequeo de arriba ya lo tomó porque
    // el yield agenda next_run_at = ahora.
    if (r.claimed === 0) break;
  }
  return out;
}

/**
 * Dispara el siguiente eslabón: POST corto a /api/document-processing/kick,
 * que responde de inmediato y drena dentro de after() con presupuesto fresco.
 * El fetch se espera solo lo que tarda la RESPUESTA (milisegundos), no el
 * drenaje — cada eslabón vive en su propia invocación de 300s.
 */
export async function encadenarKick(depth: number): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // dev sin secret: el caller drena inline
  try {
    const res = await fetch(`${appOrigin()}/api/document-processing/kick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ depth }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (error) {
    await recordOpsError({
      severity: "error",
      source: "ia",
      eventName: "document_processing_chain_kick_failed",
      summary: "No se pudo encadenar la siguiente invocación de drenaje",
      error,
      metadata: { depth },
    });
    return false;
  }
}

/**
 * Arranca el drenaje en una invocación FRESCA vía /kick (300s completos para
 * trabajar, sin heredar la edad de la invocación que lo pide). Si el kick no
 * sale (dev sin CRON_SECRET, o el fetch falló), drena inline como fallback.
 * Este es el punto de entrada para los "empujones" post-subida/reproceso/album.
 */
export async function iniciarDrenaje(lockOwner: string): Promise<void> {
  const enviado = await encadenarKick(0);
  if (!enviado) await drainAndChain({ lockOwner, depth: 0 });
}

/**
 * AUTO-DRENAJE (incidente 2026-09-23): un eslabón murió sin rastro (job
 * `running` 80 min, sin checkpoint) y, como el vigilante solo corre dentro de un
 * drenaje y los drenajes solo parten con subidas o con el cron diario, TRES
 * cartolas quedaron congeladas hasta el día siguiente. La clienta refrescó la
 * mesa varias veces: cada una de esas cargas ahora es una oportunidad de
 * rescate. Si hay un job pegado (running viejo, o queued/retryable vencido hace
 * rato), se dispara un kick. Throttle por instancia para no golpear /kick en
 * cada carga; el kick en sí es barato (responde al tiro, drena en after()).
 */
const AUTO_KICK_MIN_MS = 2 * 60 * 1000;
const COLA_VENCIDA_MS = 2 * 60 * 1000;
let ultimoAutoKick = 0;

export async function hayJobsAtascados(now = new Date()): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key);
  const staleIso = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const vencidoIso = new Date(now.getTime() - COLA_VENCIDA_MS).toISOString();
  const [running, pendientes] = await Promise.all([
    sb.from("document_processing_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("locked_at", staleIso),
    sb.from("document_processing_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "retryable"]).lt("next_run_at", vencidoIso),
  ]);
  return (running.count ?? 0) > 0 || (pendientes.count ?? 0) > 0;
}

export async function autoDrenajeSiHayAtascados(args?: {
  now?: number;
  /** Inyectables para tests. */
  probeFn?: () => Promise<boolean>;
  drenarFn?: (lockOwner: string) => Promise<void>;
}): Promise<boolean> {
  const now = args?.now ?? Date.now();
  if (now - ultimoAutoKick < AUTO_KICK_MIN_MS) return false;
  const hay = await (args?.probeFn ?? hayJobsAtascados)();
  if (!hay) return false;
  ultimoAutoKick = now;
  await (args?.drenarFn ?? iniciarDrenaje)("mesa-autodrenaje");
  return true;
}

/** Solo para tests: resetea el throttle del auto-drenaje. */
export function _resetAutoDrenaje() {
  ultimoAutoKick = 0;
}

/**
 * Drena con presupuesto y, si quedó trabajo, encadena la próxima invocación.
 * `depth` corta loops degenerados (MAX_CHAIN_DEPTH); con checkpoint + yield
 * cada eslabón avanza al menos un batch, así que el tope nunca se alcanza en
 * un caso sano.
 */
/** Horizonte de espera por backoff dentro del MISMO eslabón (cabe en los 300s
 *  de la invocación: el drain usa ≤60s y esto ≤210s). */
const BACKOFF_WAIT_MAX_MS = 210_000;

export async function drainAndChain(args: {
  lockOwner: string;
  depth?: number;
  budgetMs?: number;
  processFn?: ProcessFn;
  /** Inyectable para tests. */
  probeFn?: typeof msHastaProximoJobPendiente;
}): Promise<DrainResult & { encadenado: boolean }> {
  const depth = args.depth ?? 0;
  const probeFn = args.probeFn ?? msHastaProximoJobPendiente;
  const r = await drainDocumentQueue(args);
  let encadenado = false;
  let quedaTrabajo = r.presupuestoAgotado || r.yields > 0;

  // Incidente 2026-08-22 (cartola M&E, lote 21/23): un intento fallido agenda
  // su reintento con backoff a 1-2 min de FUTURO → "nada reclamable ahora" →
  // la cadena moría y el documento quedaba a medias hasta el cron del día
  // siguiente. Si lo único pendiente es un backoff cercano, ESPERAMOS dentro
  // de este mismo eslabón (la invocación tiene 300s de sobra) y encadenamos.
  if (!quedaTrabajo && depth < MAX_CHAIN_DEPTH) {
    const esperaMs = await probeFn(BACKOFF_WAIT_MAX_MS);
    if (esperaMs !== null) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(esperaMs + 500, BACKOFF_WAIT_MAX_MS)));
      quedaTrabajo = true;
    }
  }

  if (quedaTrabajo && depth < MAX_CHAIN_DEPTH) {
    // La profundidad corta loops DEGENERADOS, no cartolas grandes: si este
    // eslabón avanzó de verdad (completó, yieldeó o recuperó algo), el
    // contador parte de nuevo. Solo eslabones consecutivos SIN progreso
    // acumulan profundidad hasta el tope.
    const progreso = r.completados + r.yields + r.recuperados > 0;
    encadenado = await encadenarKick(progreso ? 1 : depth + 1);
    if (!encadenado && !process.env.CRON_SECRET) {
      // Dev local sin CRON_SECRET: seguimos inline (sin límite de 300s acá).
      const extra = await drainAndChain({ ...args, depth: depth + 1 });
      return {
        rondas: r.rondas + extra.rondas,
        completados: r.completados + extra.completados,
        yields: r.yields + extra.yields,
        fallidos: r.fallidos + extra.fallidos,
        recuperados: r.recuperados + extra.recuperados,
        presupuestoAgotado: extra.presupuestoAgotado,
        encadenado: extra.encadenado,
      };
    }
  }
  return { ...r, encadenado };
}
