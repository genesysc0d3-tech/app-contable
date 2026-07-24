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
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { CURRENT_EMISSION_AUTHORIZATION_VERSION, getEmissionAuthorizationStatus } from "@/lib/emission/authorizations";
import { validarRut } from "@/lib/sii/validation";
import { guardTipoDteEmisor } from "@/lib/sii/tipo-dte-emisor-guard";

type Provider = "sii_local" | "simpleapi";
type CloseEstado = "failed" | "cancelled" | "revision_pendiente";
type ServiceDb = SupabaseClient<Database>;

const TIPOS_SII_LOCAL = new Set([39, 41]);
const TIPOS_SIMPLEAPI = new Set([33, 34, 39, 41]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // 'revision_pendiente' = boleta "a medias" (posible folio real): sella el job para
  // bloquear la re-emisión. 'failed' = pre-emit seguro. Default 'cancelled'.
  if (value === "failed") return "failed";
  if (value === "revision_pendiente") return "revision_pendiente";
  return "cancelled";
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
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_plan_query_failed",
      summary: "No se pudo resolver modalidad de plan para emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error,
    });
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
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_config_error",
      summary: "No se pudo leer configuracion de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error: config.error,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMISION_CONFIG_ERROR" }, { status: 500 });
  }
  if (providerForTipoDte(config, tipoDte) !== provider) {
    return NextResponse.json({ ok: false, error: "PROVIDER_NOT_ENABLED" }, { status: 409 });
  }

  const { data: empresa, error: empresaError } = await guard.service
    .from("empresas")
    .select("rut, tipo_contribuyente")
    .eq("id", guard.empresaId)
    .maybeSingle();
  if (empresaError) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_empresa_query_failed",
      summary: "No se pudo leer empresa para preparar emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error: empresaError,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMPRESA_QUERY_FAILED", detalle: empresaError.message }, { status: 500 });
  }

  const expectedEmisorRut = cleanText(empresa?.rut) ?? cleanText(payload.expected_emisor_rut);
  if (provider === "sii_local") {
    // Fuente de verdad del emisor: sin RUT no se puede garantizar por cuál empresa se
    // emite. Fail-closed en 2 niveles: ausente, o presente con DV (módulo 11) inválido.
    if (!expectedEmisorRut) {
      return NextResponse.json({ ok: false, error: "EMPRESA_SIN_RUT" }, { status: 422 });
    }
    if (!validarRut(expectedEmisorRut)) {
      return NextResponse.json({ ok: false, error: "EMISOR_RUT_INVALID", detalle: expectedEmisorRut }, { status: 422 });
    }
  }

  try {
    const authorization = await getEmissionAuthorizationStatus({
      sb: guard.service,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      userId: guard.userId,
      provider,
    });
    if (!authorization.authorized) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMISSION_AUTHORIZATION_REQUIRED",
          provider,
          legal_version: CURRENT_EMISSION_AUTHORIZATION_VERSION,
        },
        { status: 428 },
      );
    }
  } catch (error) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_authorization_query_failed",
      summary: "No se pudo validar autorizacion de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMISSION_AUTHORIZATION_QUERY_FAILED" }, { status: 500 });
  }

  // Motor masivo: el job del lote apunta a la propuesta que va a emitir, para que
  // el folio real quede enlazado a ella. Fail-closed: un id ajeno (o inexistente)
  // enlazaría el folio a la propuesta de OTRO contribuyente → integridad rota. La
  // boleta única no manda propuesta_id (queda null, como hoy).
  const propuestaId = cleanText(payload.propuesta_id);
  if (propuestaId) {
    if (!UUID_RE.test(propuestaId)) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_ID_INVALID" }, { status: 422 });
    }
    const { data: prop, error: propErr } = await guard.service
      .from("propuestas_ia")
      .select("id, empresa_id")
      .eq("id", propuestaId)
      .maybeSingle();
    if (propErr) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_QUERY_FAILED", detalle: propErr.message }, { status: 500 });
    }
    if (!prop || prop.empresa_id !== guard.empresaId) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_NO_PERTENECE" }, { status: 422 });
    }

    // CANDADO ANTI-DOBLE-FOLIO — fail-closed ANTES de tocar el portal (defensa
    // temprana; el lock por cuenta y el UNIQUE de boletas_emitidas son las redes
    // duras posteriores). El carril mock ya hace este chequeo; el real faltaba.
    // (a) ¿la propuesta YA tiene boleta vigente? (carrera única↔lote / 2 pestañas)
    const { data: yaBoleta } = await guard.service
      .from("boletas_emitidas")
      .select("id")
      .eq("propuesta_id", propuestaId)
      .neq("estado", "anulada")
      .limit(1)
      .maybeSingle();
    if (yaBoleta) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_YA_EMITIDA", detalle: "Esta boleta ya fue emitida." }, { status: 409 });
    }
    // (b1) ¿quedó "a medias" (lápida)? Bloqueo INCONDICIONAL hasta recuperar el folio.
    const { data: enRevision } = await guard.service
      .from("emision_jobs")
      .select("job_id")
      .eq("propuesta_id", propuestaId)
      .eq("estado", "revision_pendiente")
      .limit(1)
      .maybeSingle();
    if (enRevision) {
      return NextResponse.json({ ok: false, error: "REVISION_PENDIENTE", detalle: "Esta boleta quedó a medias en el SII. Recupera su folio antes de re-emitir." }, { status: 409 });
    }
    // (b2) ¿hay un job aún EN VUELO (no expirado)? Acotado a no-expirados para no
    // bloquear una propuesta para siempre si un intento crasheó pre-emit.
    const { data: enVuelo } = await guard.service
      .from("emision_jobs")
      .select("job_id")
      .eq("propuesta_id", propuestaId)
      .in("estado", ["created", "running"])
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (enVuelo) {
      return NextResponse.json({ ok: false, error: "EMISION_EN_CURSO", detalle: "Ya hay una emisión en curso para esta boleta." }, { status: 409 });
    }
  }

  // GUARD TRIBUTARIO — un emisor exento no puede emitir afecta (39). Fail-closed:
  // rechaza y enruta a Check (NO normaliza en silencio: en el carril real la UI
  // mostraría "Afecta" mientras emite 41 → descuadre). El mock sí normaliza (arma
  // todo el payload, es seguro allá).
  const guardTipo = guardTipoDteEmisor(tipoDte as 39 | 41, empresa?.tipo_contribuyente ?? null);
  if (!guardTipo.ok) {
    return NextResponse.json(
      { ok: false, error: guardTipo.code, detalle: "Tu empresa es exenta: esta venta no puede emitirse como afecta (con IVA). Cámbiala a exenta en Revisar." },
      { status: 422 },
    );
  }

  const lock = await acquireCuentaEmissionLock({
    sb: guard.service,
    cuentaId: guard.cuentaId,
    empresaId: guard.empresaId,
    userId: guard.userId,
    provider,
    origin: cleanText(payload.origin) ?? "emision_directa",
    expectedEmisorRut,
    propuestaId,
    ttlSeconds: provider === "sii_local" ? 15 * 60 : 5 * 60,
  });

  if (!lock.ok) {
    if (lock.error === "EMISION_BLOQUEADA") {
      await recordOpsEvent({
        sb: guard.service,
        severity: "warn",
        source: "emision",
        eventName: "emission_lock_blocked",
        summary: "Emision bloqueada por otro job activo en la cuenta",
        cuentaId: guard.cuentaId,
        empresaId: guard.empresaId,
        usuarioId: guard.userId,
        metadata: { provider, tipo_dte: tipoDte },
      });
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
    await recordOpsEvent({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_lock_acquire_failed",
      summary: "No se pudo crear lock de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      metadata: { provider, tipo_dte: tipoDte, error: lock.error, detalle: lock.detalle },
    });
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
      await recordOpsEvent({
        sb: guard.service,
        severity: "error",
        source: "emision",
        eventName: "simpleapi_folio_reservation_failed",
        summary: "No se pudo reservar folio para emision SimpleAPI",
        cuentaId: guard.cuentaId,
        empresaId: guard.empresaId,
        usuarioId: guard.userId,
        resourceType: "emision_job",
        resourceId: lock.jobId,
        metadata: { tipo_dte: tipoDte, error: reserva.error, detalle: reserva.detalle },
      });
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
  if (error) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_delete_query_failed",
      summary: "No se pudo consultar job para cancelar emision",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobId,
      error,
    });
    return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  }
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  const estado = cleanCloseEstado(payload.estado);
  // Idempotencia + no re-procesar, CON una excepción crítica: la carrera
  // CAPTURE_DEBUG puede sellar 'failed' un job que en verdad emitió (evidencia
  // débil post-EMITIR). Un terminal PERMISIVO ('failed'/'cancelled'/'expired')
  // DEBE poder recibir la lápida 'revision_pendiente' para bloquear la re-emisión
  // (que quemaría el folio). Los estados PROTECTORES (registrada/lápida) no se
  // tocan. El guard de releaseCuentaEmissionLock refuerza esto a nivel DB.
  const yaProtegido = job.estado === "completed" || job.estado === "revision_pendiente";
  const permisivoTerminal = job.estado === "failed" || job.estado === "cancelled" || job.estado === "expired";
  if (yaProtegido || (permisivoTerminal && estado !== "revision_pendiente")) {
    return NextResponse.json({ ok: true, estado: job.estado });
  }
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
    .select("job_id, cuenta_id, usuario_id, estado, provider")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_patch_query_failed",
      summary: "No se pudo consultar job para heartbeat de emision",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobId,
      error,
    });
    return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  }
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  // 'revision_pendiente' (lápida) es un estado terminal PROTECTOR: un heartbeat
  // NUNCA debe resucitarlo. Antes faltaba en esta lista → un latido tardío lo
  // degradaba a 'running' (abajo), reabría su ventana, la lápida expiraba y la
  // propuesta volvía a ser emitible → doble folio. Ahora se trata como cerrado.
  if (["completed", "failed", "cancelled", "expired", "revision_pendiente"].includes(job.estado)) return NextResponse.json({ ok: true, estado: job.estado, closed: true });

  const now = new Date().toISOString();
  const estado = cleanStatus(payload.estado ?? payload.status);
  // El heartbeat renueva la ventana del job: un RPA lento (SII lento, 2FA,
  // reintentos de PDF, cadencia humana del motor masivo) mantiene vivo el job
  // mientras siga latiendo. Sin esto, un job de sii_local muere a los 15 min y
  // el resultado —una boleta REAL ya emitida— se rechaza y se pierde.
  const ttlSeconds = job.provider === "sii_local" ? 15 * 60 : 5 * 60;
  const nuevaExpiracion = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const { error: updateJobError } = await service.service
    .from("emision_jobs")
    .update({ estado: "running", estado_visible: estado, heartbeat_at: now, updated_at: now, expires_at: nuevaExpiracion, locked_until: nuevaExpiracion })
    .eq("job_id", job.job_id)
    // Cinturón y tiradores: aunque el corte de arriba ya cubre los estados
    // terminales, gateamos el UPDATE a solo activos para que ningún estado
    // protector pueda ser degradado a 'running' por un latido que gane una carrera
    // contra el sellado (SELECT :506 y UPDATE no son atómicos).
    .in("estado", ["created", "running"]);
  if (updateJobError) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_heartbeat_failed",
      summary: "No se pudo actualizar heartbeat del job de emision",
      cuentaId: job.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: job.job_id,
      error: updateJobError,
      metadata: { estado_visible: estado },
    });
    return NextResponse.json({ ok: false, error: "JOB_UPDATE_FAILED", detalle: updateJobError.message }, { status: 500 });
  }

  const { error: updateLockError } = await service.service
    .from("emision_locks")
    .update({ estado_visible: estado, heartbeat_at: now, locked_until: nuevaExpiracion })
    .eq("cuenta_id", job.cuenta_id)
    .eq("job_id", job.job_id);
  if (updateLockError) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_lock_heartbeat_failed",
      summary: "No se pudo actualizar heartbeat del lock de emision",
      cuentaId: job.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: job.job_id,
      error: updateLockError,
      metadata: { estado_visible: estado },
    });
    return NextResponse.json({ ok: false, error: "LOCK_UPDATE_FAILED", detalle: updateLockError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, estado, heartbeat_at: now });
}

export const dynamic = "force-dynamic";
