import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { finalizeFolioReservaForJob } from "@/lib/emission/folio-reservas";

type Sb = SupabaseClient<Database>;
type Provider = "mock" | "sii_local" | "simpleapi";

export type CuentaEmissionLock =
  | { ok: true; jobId: string; lockedUntil: string }
  | { ok: false; error: "EMISION_BLOQUEADA" | "LOCK_ERROR"; detalle?: string };

export async function acquireCuentaEmissionLock(args: {
  sb: Sb;
  cuentaId: string;
  empresaId: string;
  userId: string;
  provider: Provider;
  origin?: string;
  expectedEmisorRut?: string | null;
  ttlSeconds?: number;
}): Promise<CuentaEmissionLock> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + (args.ttlSeconds ?? 300) * 1000).toISOString();
  const jobId = `server:${args.provider}:${randomUUID()}`;

  await args.sb
    .from("emision_locks")
    .delete()
    .eq("cuenta_id", args.cuentaId)
    .lt("locked_until", now.toISOString());

  const { error: jobError } = await args.sb.from("emision_jobs").insert({
    job_id: jobId,
    cuenta_id: args.cuentaId,
    empresa_id: args.empresaId,
    usuario_id: args.userId,
    provider: args.provider,
    origin: args.origin ?? "server_lock",
    expected_emisor_rut: args.expectedEmisorRut ?? null,
    estado: "running",
    estado_visible: "running",
    expires_at: lockedUntil,
    locked_until: lockedUntil,
    heartbeat_at: now.toISOString(),
  });
  if (jobError) return { ok: false, error: "LOCK_ERROR", detalle: jobError.message };

  const { error: lockError } = await args.sb.from("emision_locks").insert({
    cuenta_id: args.cuentaId,
    job_id: jobId,
    usuario_id: args.userId,
    provider: args.provider,
    estado_visible: "running",
    locked_until: lockedUntil,
    heartbeat_at: now.toISOString(),
  });

  if (lockError) {
    await args.sb.from("emision_jobs").update({ estado: "cancelled", updated_at: new Date().toISOString() }).eq("job_id", jobId);
    if (lockError.code === "23505") return { ok: false, error: "EMISION_BLOQUEADA" };
    return { ok: false, error: "LOCK_ERROR", detalle: lockError.message };
  }

  return { ok: true, jobId, lockedUntil };
}

export async function releaseCuentaEmissionLock(args: {
  sb: Sb;
  cuentaId: string;
  jobId: string;
  estado?: "completed" | "failed" | "cancelled" | "expired";
}) {
  const estado = args.estado ?? "completed";
  await finalizeFolioReservaForJob({ sb: args.sb, jobId: args.jobId, estado });
  await args.sb.from("emision_locks").delete().eq("cuenta_id", args.cuentaId).eq("job_id", args.jobId);
  await args.sb
    .from("emision_jobs")
    .update({
      estado,
      estado_visible: estado,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", args.jobId);
}
