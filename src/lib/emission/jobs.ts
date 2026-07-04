import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { validarAccesoCuenta } from "@/lib/entitlements";

type Sb = SupabaseClient<Database>;
export type EmisionJob = Tables<"emision_jobs">;

export type EmisionJobGate =
  | { ok: true; job: EmisionJob }
  | { ok: false; status: number; error: string; detalle?: string };

export async function requireEmisionJob(args: {
  sb: Sb;
  userId: string;
  jobId: string | null | undefined;
  provider: "sii_local" | "simpleapi";
}): Promise<EmisionJobGate> {
  const jobId = typeof args.jobId === "string" && args.jobId.trim() ? args.jobId.trim() : null;
  if (!jobId) return { ok: false, status: 409, error: "EMISION_JOB_REQUIRED" };

  const { data: job, error } = await args.sb
    .from("emision_jobs")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "EMISION_JOB_QUERY_FAILED", detalle: error.message };
  if (!job) return { ok: false, status: 409, error: "EMISION_JOB_NOT_FOUND" };
  if (job.provider !== args.provider) return { ok: false, status: 409, error: "EMISION_JOB_PROVIDER_MISMATCH" };
  if (job.usuario_id !== args.userId) return { ok: false, status: 403, error: "EMISION_JOB_FORBIDDEN" };
  if (new Date(job.expires_at).getTime() <= Date.now()) return { ok: false, status: 409, error: "EMISION_JOB_EXPIRED" };
  if (["completed", "failed", "cancelled", "expired"].includes(job.estado)) {
    return { ok: false, status: 409, error: "EMISION_JOB_CLOSED" };
  }

  const acceso = await validarAccesoCuenta(args.sb, args.userId, job.empresa_id);
  if (!acceso.ok) return { ok: false, status: 403, error: acceso.codigo };
  if (!acceso.planActivo) return { ok: false, status: 402, error: "PLAN_INACTIVO" };
  if (acceso.cuentaId !== job.cuenta_id) return { ok: false, status: 409, error: "EMISION_JOB_CUENTA_MISMATCH" };

  return { ok: true, job };
}

export async function markEmisionJob(args: {
  sb: Sb;
  jobId: string;
  estado: "running" | "completed" | "failed" | "expired" | "cancelled";
}) {
  await args.sb
    .from("emision_jobs")
    .update({ estado: args.estado, estado_visible: args.estado, updated_at: new Date().toISOString() })
    .eq("job_id", args.jobId);
}
