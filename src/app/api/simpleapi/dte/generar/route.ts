import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { obtenerConfigEmision } from "@/lib/intermediario/client";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { markSimpleApiFolioGenerated, requireSimpleApiFolioReserva } from "@/lib/emission/folio-reservas";
import { requireEmisionJob } from "@/lib/emission/jobs";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import {
  buildSimpleApiGenerarForm,
  isSimpleApiProxyError,
  parseSimpleApiMultipart,
  sanitizeSimpleApiResponse,
  simpleApiAllowedForTipo,
  simpleApiAuthHeaders,
  simpleApiEndpoint,
} from "@/lib/emission/simpleapi";

const ROLES_EMISION = new Set(["owner", "admin", "contador"]);

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[simpleapi-dte-generar] error no controlado", error);
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_PROXY_FAILED", detalle: "No se pudo completar la solicitud SimpleAPI." },
      { status: 500 },
    );
  }
}

async function handlePost(request: Request) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  if (!ROLES_EMISION.has(String(usuario.rol))) return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient<Database>(url, key);
  const acceso = await validarAccesoCuenta(sb, user.id, usuario.empresa_id);
  if (!acceso.ok) return NextResponse.json({ ok: false, error: acceso.codigo }, { status: 403 });
  if (!acceso.planActivo) return NextResponse.json({ ok: false, error: "PLAN_INACTIVO" }, { status: 402 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "MULTIPART_REQUIRED", detalle: "SimpleAPI requiere input + PFX + CAF en multipart/form-data." },
      { status: 415 },
    );
  }

  const formData = await request.formData();
  const jobId = typeof formData.get("job_id") === "string" ? String(formData.get("job_id")).trim() : null;
  const payload = parseSimpleApiMultipart(formData);
  if (!payload.ok) {
    return NextResponse.json({ ok: false, error: payload.error, detalle: payload.detalle }, { status: payload.status });
  }

  const emisionConfig = await obtenerConfigEmision(usuario.empresa_id).catch(() => null);
  if (!emisionConfig) {
    return NextResponse.json(
      { ok: false, error: "EMISION_CONFIG_ERROR", detalle: "No se pudo leer el proveedor de emisión de la empresa." },
      { status: 500 },
    );
  }
  if (!simpleApiAllowedForTipo(emisionConfig, payload.tipoDte)) {
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_NOT_ENABLED", detalle: `SimpleAPI no está configurado para DTE ${payload.tipoDte}.` },
      { status: 409 },
    );
  }

  const jobGate = await requireEmisionJob({ sb, userId: user.id, jobId, provider: "simpleapi" });
  if (!jobGate.ok) return NextResponse.json({ ok: false, error: jobGate.error, detalle: jobGate.detalle }, { status: jobGate.status });
  if (jobGate.job.empresa_id !== usuario.empresa_id) {
    return NextResponse.json({ ok: false, error: "EMISION_JOB_EMPRESA_MISMATCH" }, { status: 409 });
  }

  const reserva = await requireSimpleApiFolioReserva({
    sb,
    empresaId: jobGate.job.empresa_id,
    jobId: jobGate.job.job_id,
    tipoDte: payload.tipoDte,
    folio: payload.folio,
    allowedEstados: ["reservado"],
  });
  if (!reserva.ok) {
    return NextResponse.json({ ok: false, error: reserva.error, detalle: reserva.detalle }, { status: reserva.status });
  }

  const authHeaders = simpleApiAuthHeaders();
  if (isSimpleApiProxyError(authHeaders)) {
    return NextResponse.json({ ok: false, error: authHeaders.error, detalle: authHeaders.detalle }, { status: authHeaders.status });
  }

  const generated = await markSimpleApiFolioGenerated({
    sb,
    jobId: jobGate.job.job_id,
    tipoDte: payload.tipoDte,
    folio: reserva.reserva.folio,
  });
  if (!generated.ok) {
    return NextResponse.json({ ok: false, error: generated.error, detalle: generated.detalle }, { status: generated.status });
  }

  const upstream = await fetch(simpleApiEndpoint("dte/generar"), {
    method: "POST",
    headers: authHeaders,
    body: buildSimpleApiGenerarForm(payload),
    cache: "no-store",
  });
  const upstreamContentType = upstream.headers.get("content-type") || "";
  const data = upstreamContentType.includes("application/json")
    ? await upstream.json().catch(() => null)
    : await upstream.text().catch(() => "");

  return NextResponse.json({ ok: upstream.ok, status: upstream.status, data: sanitizeSimpleApiResponse(data) }, { status: upstream.ok ? 200 : upstream.status });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
