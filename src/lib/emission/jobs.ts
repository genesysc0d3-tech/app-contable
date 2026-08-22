import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { validarAccesoCuenta } from "@/lib/entitlements";

type Sb = SupabaseClient<Database>;
export type EmisionJob = Tables<"emision_jobs">;

export type EmisionJobGate =
  | { ok: true; job: EmisionJob }
  // En cierre/expiración incluimos `job` (ownership ya verificada): permite el
  // respaldo por evidencia fuerte para no perder un folio ya emitido.
  | { ok: false; status: number; error: string; detalle?: string; job?: EmisionJob };

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
  if (new Date(job.expires_at).getTime() <= Date.now()) return { ok: false, status: 409, error: "EMISION_JOB_EXPIRED", job };
  // 'revision_pendiente' se trata como CERRADO-recuperable: NO es un job vivo, pero
  // sí adjunta `job` para que el rescate (recover_latest → backfill) enganche por
  // la misma rama que un job cerrado/expirado y registre el folio "a medias".
  if (["completed", "failed", "cancelled", "expired", "revision_pendiente"].includes(job.estado)) {
    return { ok: false, status: 409, error: "EMISION_JOB_CLOSED", job };
  }

  // Fallas de CUENTA (empresa desactivada por downgrade, plan vencido) también
  // adjuntan `job`: la ownership ya está verificada arriba (usuario_id) y un
  // folio REAL emitido en el SII durante la ventana del cambio de plan debe
  // poder registrarse por la red de seguridad de evidencia fuerte — "no emitir
  // de nuevo" > "libro sin el folio". Abrir jobs NUEVOS sí queda bloqueado (el
  // gate de apertura vive en requireAccountApiAccess).
  const acceso = await validarAccesoCuenta(args.sb, args.userId, job.empresa_id);
  if (!acceso.ok) return { ok: false, status: 403, error: acceso.codigo, job };
  if (!acceso.planActivo) return { ok: false, status: 402, error: "PLAN_INACTIVO", job };
  if (acceso.cuentaId !== job.cuenta_id) return { ok: false, status: 409, error: "EMISION_JOB_CUENTA_MISMATCH" };

  return { ok: true, job };
}

export async function markEmisionJob(args: {
  sb: Sb;
  jobId: string;
  estado: "running" | "completed" | "failed" | "expired" | "cancelled" | "revision_pendiente";
}) {
  await args.sb
    .from("emision_jobs")
    .update({ estado: args.estado, estado_visible: args.estado, updated_at: new Date().toISOString() })
    .eq("job_id", args.jobId);
}
