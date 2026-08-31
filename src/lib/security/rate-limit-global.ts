// Rate-limit GLOBAL (auditoría interna #6b): bucket en Postgres, compartido
// por todas las instancias serverless — cierra el bypass por concurrencia
// del limiter en memoria (que sigue existiendo como piso y como fallback).
//
// Uso: rutas CALIENTES de costo (subida, reproceso, parsers, MCP). Las rutas
// de latencia sensible (login) siguen con el limiter local: un roundtrip a
// la base por request no se justifica ahí.

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, rateLimitKey, rateLimitResponse, type RateLimitOptions } from "./rate-limit";

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

export async function enforceRateLimitGlobal(
  options: RateLimitOptions,
  cliente: RateLimitRpcClient | null = serviceClient(),
): Promise<Response | null> {
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
        if (fila.allowed) return null;
        return rateLimitResponse({
          ok: false,
          limit: options.limit,
          remaining: 0,
          resetAt: Date.now() + fila.retry_after_seconds * 1000,
          retryAfterSeconds: fila.retry_after_seconds,
        });
      }
    } catch {
      // cae al fallback local
    }
  }
  // FALLBACK CONSCIENTE: si la base no responde (o la RPC aún no existe),
  // manda el limiter en memoria — peor que el global, mejor que nada, y la
  // subida legítima no se cae por un hipo de infraestructura.
  const local = checkRateLimit({ ...options, key });
  return local.ok ? null : rateLimitResponse(local);
}
