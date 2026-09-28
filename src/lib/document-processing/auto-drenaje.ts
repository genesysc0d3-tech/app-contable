import "server-only";

import { STALE_RUNNING_MS } from "./state";
import { recordOpsError } from "@/lib/ops/events";

// Arranque del drenaje de la cola, SIN la cola (plan-costo-vercel §6, PR 2).
//
// /api/mesa llama autoDrenajeSiHayAtascados en CADA carga (after()); antes lo
// importaba desde ./drain, que arrastra ./queue → processor, parsers, OCR, IA:
// la función de la mesa cargaba todo eso en memoria (436 MB promedio medidos el
// 2026-09-27) para hacer dos COUNT y, a veces, un fetch. Este archivo solo usa
// supabase-js y fetch; ./drain se carga dinámico solo en el fallback inline.

function appOrigin(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
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
  if (!enviado) {
    // Fallback inline (dev sin CRON_SECRET, o el kick no salió): recién ACÁ se carga
    // la cola + el processor, que pesan. La ruta normal (kick) no los necesita.
    const { drainAndChain } = await import("./drain");
    await drainAndChain({ lockOwner, depth: 0 });
  }
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

