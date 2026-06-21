import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { reserveSimpleApiFolio } from "@/lib/emission/folio-reservas";
import { acquireCuentaEmissionLock, releaseCuentaEmissionLock } from "@/lib/emission/locks";
import { buildVisibleEmissionLock, type ActiveEmissionLock } from "@/lib/emission/lock-visibility";
import { obtenerConfigEmision, providerForTipoDte } from "@/lib/intermediario/client";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

type Provider = "sii_local" | "simpleapi";
type CloseEstado = "failed" | "cancelled";
type ServiceDb = SupabaseClient<Database>;

const TIPOS_SII_LOCAL = new Set([39, 41]);
const TIPOS_SIMPLEAPI = new Set([33, 34, 39, 41]);

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanProvider(value: unknown): Provider | null {
  return value === "sii_local" || value === "simpleapi" ? value : null;
}

function cleanTipoDte(value: unknown) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : null;
}

function cleanCloseEstado(value: unknown): CloseEstado {
  return value === "failed" ? "failed" : "cancelled";
}

function cleanStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9_:-]{1,48}$/i.test(status)) return "running";
  return status;
}

async function businessModeForPlan(sb: ServiceDb, plan: string | null) {
  if (!plan) return false;
  const { data, error } = await sb
    .from("planes_config")
    .select("equipo")
    .eq("codigo", plan)
    .maybeSingle();
  if (error) throw new Error(`PLAN_QUERY_FAILED:${error.message}`);
  return data?.equipo === true;
}

async function bloqueoActual(sb: ServiceDb, cuentaId: string, businessMode: boolean, currentUserId: string) {
  const now = new Date().toISOString();
  const { data: lock } = await sb
    .from("emision_locks")
    .select("job_id, usuario_id, provider, locked_until, heartbeat_at, estado_visible")
    .eq("cuenta_id", cuentaId)
    .gt("locked_until", now)
    .maybeSingle();
  if (!lock) return null;

  const usuario = businessMode
    ? (await sb.from("usuarios").select("nombre, email").eq("id", lock.usuario_id).maybeSingle()).data
    : null;

  return buildVisibleEmissionLock({
    lock: lock as ActiveEmissionLock,
    businessMode,
    currentUserId,
    usuario,
  });
}

async function serviceClientOrResponse() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false as const, response: NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 }) };
  return { ok: true as const, service: createServiceClient<Database>(url, key) };
}

export async function POST(request: Request) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  const guard = await requireAccountApiAccess({ requirePlan: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-post", guard.userId),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let businessMode = false;
  try {
    businessMode = await businessModeForPlan(guard.service, guard.plan);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "PLAN_QUERY_FAILED", detalle: error instanceof Error ? error.message : undefined }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const provider = cleanProvider(payload.provider);
  const tipoDte = cleanTipoDte(payload.tipo_dte);
  if (!provider) return NextResponse.json({ ok: false, error: "PROVIDER_INVALID" }, { status: 400 });
  if (!tipoDte) return NextResponse.json({ ok: false, error: "TIPO_DTE_REQUIRED" }, { status: 400 });
  if (provider === "sii_local" && !TIPOS_SII_LOCAL.has(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_SII_LOCAL_INVALID" }, { status: 422 });
  }
  if (provider === "simpleapi" && !TIPOS_SIMPLEAPI.has(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_SIMPLEAPI_INVALID" }, { status: 422 });
  }

  const config = await obtenerConfigEmision(guard.empresaId).catch((error) => ({ error }));
  if ("error" in config) {
    return NextResponse.json({ ok: false, error: "EMISION_CONFIG_ERROR" }, { status: 500 });
  }
  if (providerForTipoDte(config, tipoDte) !== provider) {
    return NextResponse.json({ ok: false, error: "PROVIDER_NOT_ENABLED" }, { status: 409 });
  }

  const { data: empresa, error: empresaError } = await guard.service
    .from("empresas")
    .select("rut")
    .eq("id", guard.empresaId)
    .maybeSingle();
  if (empresaError) return NextResponse.json({ ok: false, error: "EMPRESA_QUERY_FAILED", detalle: empresaError.message }, { status: 500 });

  const expectedEmisorRut = cleanText(empresa?.rut) ?? cleanText(payload.expected_emisor_rut);
  if (provider === "sii_local" && !expectedEmisorRut) {
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_RUT" }, { status: 422 });
  }

  const lock = await acquireCuentaEmissionLock({
    sb: guard.service,
    cuentaId: guard.cuentaId,
    empresaId: guard.empresaId,
    userId: guard.userId,
    provider,
    origin: cleanText(payload.origin) ?? "emision_directa",
    expectedEmisorRut,
    ttlSeconds: provider === "sii_local" ? 15 * 60 : 5 * 60,
  });

  if (!lock.ok) {
    if (lock.error === "EMISION_BLOQUEADA") {
      return NextResponse.json(
        {
          ok: false,
          error: lock.error,
          business_mode: businessMode,
          bloqueo: await bloqueoActual(guard.service, guard.cuentaId, businessMode, guard.userId),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: lock.error, detalle: lock.detalle }, { status: 500 });
  }

  let reservedFolio: number | null = null;
  if (provider === "simpleapi") {
    const reserva = await reserveSimpleApiFolio({
      sb: guard.service,
      empresaId: guard.empresaId,
      tipoDte,
      jobId: lock.jobId,
      expiresAt: lock.lockedUntil,
    });
    if (!reserva.ok) {
      await releaseCuentaEmissionLock({ sb: guard.service, cuentaId: guard.cuentaId, jobId: lock.jobId, estado: "cancelled" });
      return NextResponse.json(
        { ok: false, error: reserva.error, detalle: reserva.detalle ?? "No se pudo reservar folio SimpleAPI." },
        { status: 409 },
      );
    }
    reservedFolio = reserva.folio;
  }

  return NextResponse.json({
    ok: true,
    job_id: lock.jobId,
    expires_at: lock.lockedUntil,
    locked_until: lock.lockedUntil,
    cuenta_id: guard.cuentaId,
    empresa_id: guard.empresaId,
    provider,
    expected_emisor_rut: expectedEmisorRut,
    business_mode: businessMode,
    reserved_folio: reservedFolio,
    reserved_tipo_dte: provider === "simpleapi" ? tipoDte : null,
  });
}

export async function GET() {
  const guard = await requireAccountApiAccess({ requirePlan: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  let businessMode = false;
  try {
    businessMode = await businessModeForPlan(guard.service, guard.plan);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "PLAN_QUERY_FAILED", detalle: error instanceof Error ? error.message : undefined }, { status: 500 });
  }

  const bloqueo = await bloqueoActual(guard.service, guard.cuentaId, businessMode, guard.userId);
  return NextResponse.json({
    ok: true,
    locked: Boolean(bloqueo),
    business_mode: businessMode,
    bloqueo,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-delete", user.id),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const service = await serviceClientOrResponse();
  if (!service.ok) return service.response;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const jobId = cleanText(payload.job_id);
  if (!jobId) return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });

  const { data: job, error } = await service.service
    .from("emision_jobs")
    .select("job_id, cuenta_id, usuario_id, estado")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  if (["completed", "failed", "cancelled", "expired"].includes(job.estado)) return NextResponse.json({ ok: true, estado: job.estado });

  const estado = cleanCloseEstado(payload.estado);
  await releaseCuentaEmissionLock({ sb: service.service, cuentaId: job.cuenta_id, jobId: job.job_id, estado });
  return NextResponse.json({ ok: true, estado });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-patch", user.id),
    limit: 240,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const service = await serviceClientOrResponse();
  if (!service.ok) return service.response;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const jobId = cleanText(payload.job_id);
  if (!jobId) return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });

  const { data: job, error } = await service.service
    .from("emision_jobs")
    .select("job_id, cuenta_id, usuario_id, estado")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  if (["completed", "failed", "cancelled", "expired"].includes(job.estado)) return NextResponse.json({ ok: true, estado: job.estado, closed: true });

  const now = new Date().toISOString();
  const estado = cleanStatus(payload.estado ?? payload.status);

  const { error: updateJobError } = await service.service
    .from("emision_jobs")
    .update({ estado: "running", estado_visible: estado, heartbeat_at: now, updated_at: now })
    .eq("job_id", job.job_id);
  if (updateJobError) return NextResponse.json({ ok: false, error: "JOB_UPDATE_FAILED", detalle: updateJobError.message }, { status: 500 });

  const { error: updateLockError } = await service.service
    .from("emision_locks")
    .update({ estado_visible: estado, heartbeat_at: now })
    .eq("cuenta_id", job.cuenta_id)
    .eq("job_id", job.job_id);
  if (updateLockError) return NextResponse.json({ ok: false, error: "LOCK_UPDATE_FAILED", detalle: updateLockError.message }, { status: 500 });

  return NextResponse.json({ ok: true, estado, heartbeat_at: now });
}

export const dynamic = "force-dynamic";
