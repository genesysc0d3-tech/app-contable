import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obtenerConfigEmision } from "@/lib/intermediario/client";
import {
  buildSimpleApiGenerarForm,
  isSimpleApiProxyError,
  parseSimpleApiMultipart,
  sanitizeSimpleApiResponse,
  simpleApiAllowedForTipo,
  simpleApiAuthHeaders,
  simpleApiEndpoint,
} from "@/lib/emission/simpleapi";

const SIMPLEAPI_SECOND_LIMIT = 3;
const SIMPLEAPI_MINUTE_LIMIT = 40;

type RateBucket = {
  secondWindow: number;
  secondCount: number;
  minuteWindow: number;
  minuteCount: number;
};

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; detalle: string };

const globalRateLimiter = globalThis as typeof globalThis & {
  __appContableSimpleApiRateBuckets?: Map<string, RateBucket>;
};

const rateBuckets = globalRateLimiter.__appContableSimpleApiRateBuckets ?? new Map<string, RateBucket>();
globalRateLimiter.__appContableSimpleApiRateBuckets = rateBuckets;

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "MULTIPART_REQUIRED", detalle: "SimpleAPI requiere input + PFX + CAF en multipart/form-data." },
      { status: 415 },
    );
  }

  const authHeaders = simpleApiAuthHeaders();
  if (isSimpleApiProxyError(authHeaders)) {
    return NextResponse.json({ ok: false, error: authHeaders.error, detalle: authHeaders.detalle }, { status: authHeaders.status });
  }

  const payload = parseSimpleApiMultipart(await request.formData());
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

  const rateLimit = checkSimpleApiRateLimit(usuario.empresa_id);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_RATE_LIMITED", detalle: rateLimit.detalle },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const upstream = await fetch(simpleApiEndpoint(), {
    method: "POST",
    headers: authHeaders,
    body: buildSimpleApiGenerarForm(payload),
    cache: "no-store",
  });

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  const body = upstreamContentType.includes("application/json")
    ? await upstream.json().catch(() => null)
    : await upstream.text().catch(() => "");
  const sanitizedBody = sanitizeSimpleApiResponse(body);

  return NextResponse.json(
    {
      ok: upstream.ok,
      proveedor: "simpleapi",
      tipo_dte: payload.tipoDte,
      upstream_status: upstream.status,
      data: sanitizedBody,
    },
    { status: upstream.ok ? 200 : upstream.status },
  );
}

function checkSimpleApiRateLimit(empresaId: string): RateLimitResult {
  const now = Date.now();
  const secondWindow = Math.floor(now / 1000);
  const minuteWindow = Math.floor(now / 60000);
  const key = `dte/generar:${empresaId}`;
  const bucket = rateBuckets.get(key);

  const nextBucket: RateBucket = bucket
    ? {
        secondWindow,
        secondCount: bucket.secondWindow === secondWindow ? bucket.secondCount : 0,
        minuteWindow,
        minuteCount: bucket.minuteWindow === minuteWindow ? bucket.minuteCount : 0,
      }
    : { secondWindow, secondCount: 0, minuteWindow, minuteCount: 0 };

  if (nextBucket.secondCount >= SIMPLEAPI_SECOND_LIMIT) {
    return { ok: false, retryAfterSeconds: 1, detalle: "SimpleAPI permite hasta 3 solicitudes DTE por segundo." };
  }

  if (nextBucket.minuteCount >= SIMPLEAPI_MINUTE_LIMIT) {
    const retryAfterSeconds = Math.max(1, 60 - Math.floor((now % 60000) / 1000));
    return { ok: false, retryAfterSeconds, detalle: "SimpleAPI permite hasta 40 solicitudes DTE por minuto." };
  }

  nextBucket.secondCount += 1;
  nextBucket.minuteCount += 1;
  rateBuckets.set(key, nextBucket);
  pruneRateBuckets(now);
  return { ok: true };
}

function pruneRateBuckets(now: number) {
  if (rateBuckets.size < 1000) return;
  const staleMinuteWindow = Math.floor(now / 60000) - 2;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.minuteWindow < staleMinuteWindow) rateBuckets.delete(key);
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
