// Rate-limit GLOBAL (auditoría interna #6b): bucket en Postgres, compartido
// por todas las instancias serverless — cierra el bypass por concurrencia
// del limiter en memoria (que sigue existiendo como piso y como fallback).
//
// Uso: rutas CALIENTES de costo (subida, reproceso, parsers, MCP). Las rutas
// de latencia sensible (login) siguen con el limiter local: un roundtrip a
// la base por request no se justifica ahí.

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, rateLimitKey, rateLimitResponse, type RateLimitOptions, type RateLimitResult } from "./rate-limit";

// Cliente estructural mínimo para poder testear la decisión sin Supabase real.
export type RateLimitRpcClient = {
  rpc: (
    fn: "rate_limit_hit",
    args: { p_key: string; p_limit: number; p_window_ms: number },
  ) => PromiseLike<{ data: Array<{ allowed: boolean; retry_after_seconds: number }> | null; error: { message: string } | null }>;
};

let cachedSvc: RateLimitRpcClient | null = null;

function serviceClient(): RateLimitRpcClient | null {
  if (cachedSvc) return cachedSvc;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // La RPC no está en database.types hasta regenerar tras aplicar la
  // migración; cliente sin tipos SOLO para esta llamada.
  cachedSvc = createServiceClient(url, key) as unknown as RateLimitRpcClient;
  return cachedSvc;
}

// Versión "check" para server actions (que devuelven objetos, no Response).
export async function checkRateLimitGlobal(
  options: RateLimitOptions,
  cliente: RateLimitRpcClient | null = serviceClient(),
): Promise<RateLimitResult> {
  const key = rateLimitKey(options.key);
  if (cliente) {
    try {
      const { data, error } = await cliente.rpc("rate_limit_hit", {
        p_key: key,
        p_limit: options.limit,
        p_window_ms: options.windowMs,
      });
      const fila = data?.[0];
      if (!error && fila) {
        return {
          ok: fila.allowed,
          limit: options.limit,
          remaining: fila.allowed ? 1 : 0,
          resetAt: Date.now() + fila.retry_after_seconds * 1000,
          retryAfterSeconds: fila.allowed ? 0 : fila.retry_after_seconds,
        };
      }
    } catch {
      // cae al fallback local
    }
  }
  // FALLBACK CONSCIENTE: si la base no responde (o la RPC aún no existe),
  // manda el limiter en memoria — peor que el global, mejor que nada, y el
  // uso legítimo no se cae por un hipo de infraestructura.
  return checkRateLimit({ ...options, key });
}

export async function enforceRateLimitGlobal(
  options: RateLimitOptions,
  cliente: RateLimitRpcClient | null = serviceClient(),
): Promise<Response | null> {
  const result = await checkRateLimitGlobal(options, cliente);
  return result.ok ? null : rateLimitResponse(result);
}

// Variante FAIL-CLOSED para endpoints de ESCRITURA ANÓNIMA (hoy: el registro
// OAuth). El fallback al limiter local reabre el bypass por concurrencia
// (10/h pasa a ser 10/h POR INSTANCIA) — inaceptable donde un anónimo
// inserta filas. Acá, si el bucket compartido no responde, CERRADO: un
// registro de conector puede esperar un reintento; una tabla llenada por
// botnet no se vacía sola. (Hallazgo del escéptico, 2026-09-01.)
export async function checkRateLimitGlobalEstricto(
  options: RateLimitOptions,
  cliente: RateLimitRpcClient | null = serviceClient(),
): Promise<RateLimitResult> {
  const key = rateLimitKey(options.key);
  if (!cliente) {
    return { ok: false, limit: options.limit, remaining: 0, resetAt: Date.now() + 60_000, retryAfterSeconds: 60 };
  }
  try {
    const { data, error } = await cliente.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: options.limit,
      p_window_ms: options.windowMs,
    });
    const fila = data?.[0];
    if (!error && fila) {
      return {
        ok: fila.allowed,
        limit: options.limit,
        remaining: fila.allowed ? 1 : 0,
        resetAt: Date.now() + fila.retry_after_seconds * 1000,
        retryAfterSeconds: fila.allowed ? 0 : fila.retry_after_seconds,
      };
    }
  } catch {
    // sin señal ⇒ cerrado
  }
  return { ok: false, limit: options.limit, remaining: 0, resetAt: Date.now() + 60_000, retryAfterSeconds: 60 };
}
