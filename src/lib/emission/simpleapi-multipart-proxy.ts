import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obtenerConfigEmision } from "@/lib/intermediario/client";
import {
  isSimpleApiProxyError,
  sanitizeSimpleApiResponse,
  simpleApiAuthHeaders,
  simpleApiEndpoint,
} from "@/lib/emission/simpleapi";

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const SIMPLEAPI_SECOND_LIMIT = 3;
const SIMPLEAPI_MINUTE_LIMIT = 40;
const ALLOWED_FILE_FIELDS = new Set(["files", "files2", "files3", "fileEnvio", "logo"]);

type RateBucket = {
  secondWindow: number;
  secondCount: number;
  minuteWindow: number;
  minuteCount: number;
};

const globalRateLimiter = globalThis as typeof globalThis & {
  __appContableSimpleApiMultipartRateBuckets?: Map<string, RateBucket>;
};

const rateBuckets = globalRateLimiter.__appContableSimpleApiMultipartRateBuckets ?? new Map<string, RateBucket>();
globalRateLimiter.__appContableSimpleApiMultipartRateBuckets = rateBuckets;

export async function proxySimpleApiMultipart(request: Request, path: string) {
  try {
    return await handleProxy(request, path);
  } catch (error) {
    console.error(`[simpleapi-multipart-proxy:${path}] error no controlado`, error);
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_PROXY_FAILED", detalle: "No se pudo completar la solicitud SimpleAPI." },
      { status: 500 },
    );
  }
}

async function handleProxy(request: Request, path: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });

  const emisionConfig = await obtenerConfigEmision(usuario.empresa_id).catch(() => null);
  if (!emisionConfig) {
    return NextResponse.json(
      { ok: false, error: "EMISION_CONFIG_ERROR", detalle: "No se pudo leer el proveedor de emisión de la empresa." },
      { status: 500 },
    );
  }
  if (emisionConfig.boletasProveedor !== "simpleapi" && emisionConfig.facturasProveedor !== "simpleapi") {
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_NOT_ENABLED", detalle: "SimpleAPI no está configurado para esta empresa." },
      { status: 409 },
    );
  }

  const authHeaders = simpleApiAuthHeaders();
  if (isSimpleApiProxyError(authHeaders)) {
    return NextResponse.json({ ok: false, error: authHeaders.error, detalle: authHeaders.detalle }, { status: authHeaders.status });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "MULTIPART_REQUIRED", detalle: "SimpleAPI requiere multipart/form-data." },
      { status: 415 },
    );
  }

  const formData = await request.formData();
  const upstreamForm = validateAndBuildForm(formData);
  if (!upstreamForm.ok) {
    return NextResponse.json({ ok: false, error: upstreamForm.error, detalle: upstreamForm.detalle }, { status: upstreamForm.status });
  }

  const rateLimit = checkSimpleApiRateLimit(usuario.empresa_id, path);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_RATE_LIMITED", detalle: rateLimit.detalle },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const upstream = await fetch(simpleApiEndpoint(path), {
    method: "POST",
    headers: authHeaders,
    body: upstreamForm.form,
    cache: "no-store",
  });

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  const upstreamBody = upstreamContentType.includes("application/json")
    ? await upstream.json().catch(() => null)
    : await upstream.text().catch(() => "");

  return NextResponse.json(
    {
      ok: upstream.ok,
      proveedor: "simpleapi",
      upstream_path: path,
      upstream_status: upstream.status,
      data: sanitizeSimpleApiResponse(upstreamBody),
    },
    { status: upstream.ok ? 200 : upstream.status },
  );
}

function validateAndBuildForm(formData: FormData):
  | { ok: true; form: FormData }
  | { ok: false; status: number; error: string; detalle?: string } {
  const input = formData.get("input");
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, status: 400, error: "INPUT_REQUIRED", detalle: "El multipart debe incluir input." };
  }
  if (new TextEncoder().encode(input).byteLength > MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: "INPUT_TOO_LARGE", detalle: "El JSON input supera el tamaño permitido." };
  }

  const upstream = new FormData();
  upstream.set("input", input);
  let fileCount = 0;

  for (const [key, value] of formData.entries()) {
    if (key === "input") continue;
    if (!ALLOWED_FILE_FIELDS.has(key)) continue;
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > MAX_FILE_BYTES) {
      return { ok: false, status: 413, error: "FILE_TOO_LARGE", detalle: `El archivo ${key} supera el tamaño permitido.` };
    }
    upstream.set(key, value, value.name || `${key}.bin`);
    fileCount += 1;
  }

  if (fileCount === 0) {
    return { ok: false, status: 400, error: "FILES_REQUIRED", detalle: "El multipart debe incluir al menos un archivo permitido." };
  }

  return { ok: true, form: upstream };
}

function checkSimpleApiRateLimit(empresaId: string, path: string): { ok: true } | { ok: false; retryAfterSeconds: number; detalle: string } {
  const now = Date.now();
  const secondWindow = Math.floor(now / 1000);
  const minuteWindow = Math.floor(now / 60000);
  const key = `${path}:${empresaId}`;
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
    return { ok: false, retryAfterSeconds: 1, detalle: "SimpleAPI permite hasta 3 solicitudes por segundo." };
  }
  if (nextBucket.minuteCount >= SIMPLEAPI_MINUTE_LIMIT) {
    const retryAfterSeconds = Math.max(1, 60 - Math.floor((now % 60000) / 1000));
    return { ok: false, retryAfterSeconds, detalle: "SimpleAPI permite hasta 40 solicitudes por minuto." };
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
