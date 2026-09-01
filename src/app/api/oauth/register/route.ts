import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { redirectEnAllowlistConector, urisNormalizadas, validarRegistroCliente } from "@/lib/mcp/oauth";
import { clientIpFromRequest, rateLimitKey } from "@/lib/security/rate-limit";
import { checkRateLimitGlobalEstricto } from "@/lib/security/rate-limit-global";
import { recordOpsEvent } from "@/lib/ops/events";

// Registro dinámico de clientes OAuth (RFC 7591) — BLINDADO (decisión del
// fundador 2026-09-01: "protegidos como los grandes"). El estándar MCP exige
// que claude.ai/ChatGPT puedan registrarse solos, pero acá el "abierto" es
// una ventanilla curada:
//
//  1. ALLOWLIST: solo callbacks de plataformas conocidas (la consola de
//     Google, versión automática). Lo demás → rechazado.
//  2. IDEMPOTENTE: mismas redirect_uris ⇒ mismo client_id, sin fila nueva.
//     El mundo real colapsa a ~1 fila por plataforma.
//  3. TOPE TOTAL + GC: techo duro de filas y poda de clientes que nunca
//     acuñaron un token.
//  4. FAIL-CLOSED: rate-limit por IP Y global (todas las IPs) contra el
//     bucket compartido; si el bucket no responde, CERRADO — jamás el
//     fallback por-instancia en un INSERT anónimo.
//
// Registrarse sigue sin dar acceso a nada: solo habilita PEDIR autorización,
// que muere en el login + consentimiento del usuario.

const TOPE_CLIENTES_DEFAULT = 200;

function topeClientes(): number {
  const raw = Number(process.env.MASSDTE_TOPE_OAUTH_CLIENTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : TOPE_CLIENTES_DEFAULT;
}

function respuestaCliente(id: string, nombre: string, uris: string[], creado: string, status: number) {
  return NextResponse.json(
    {
      client_id: id,
      client_name: nombre,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(new Date(creado).getTime() / 1000),
    },
    { status },
  );
}

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  // Doble freno fail-closed: por IP (10/h) y GLOBAL sobre todas las IPs
  // (60/h) — una botnet con IPs rotativas choca contra el segundo.
  const porIp = await checkRateLimitGlobalEstricto({ key: rateLimitKey("oauth-register", ip), limit: 10, windowMs: 60 * 60_000 });
  if (!porIp.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(porIp.retryAfterSeconds) } });
  const global = await checkRateLimitGlobalEstricto({ key: rateLimitKey("oauth-register-global"), limit: 60, windowMs: 60 * 60_000 });
  if (!global.ok) {
    await recordOpsEvent({
      severity: "warn",
      source: "auth",
      eventName: "oauth_register_global_limit",
      summary: "El registro OAuth chocó el tope GLOBAL por hora (posible botnet)",
      metadata: { ip },
    });
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(global.retryAfterSeconds) } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const registro = validarRegistroCliente(body);
  if ("error" in registro) return NextResponse.json({ error: registro.error }, { status: 400 });

  // Consola curada: TODAS las callbacks deben ser de plataformas conocidas.
  if (!registro.redirect_uris.every(redirectEnAllowlistConector)) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "server_error" }, { status: 500 });
  const svc = createServiceClient(url, key) as unknown as SupabaseClient;

  // IDEMPOTENCIA: mismas URIs (normalizadas) ⇒ devolver el cliente existente.
  const firma = urisNormalizadas(registro.redirect_uris);
  const { data: existentes } = await svc
    .from("oauth_clients")
    .select("id, client_name, redirect_uris, created_at")
    .order("created_at", { ascending: true })
    .limit(500);
  const previo = (existentes ?? []).find(
    (c) => urisNormalizadas((c.redirect_uris as string[]) ?? []) === firma,
  );
  if (previo) {
    return respuestaCliente(previo.id, previo.client_name, registro.redirect_uris, previo.created_at, 200);
  }

  // GC oportunista: clientes de +7 días que jamás acuñaron un token, fuera.
  try {
    const corte = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const [{ data: viejos }, { data: usados }] = await Promise.all([
      svc.from("oauth_clients").select("id").lt("created_at", corte).limit(100),
      svc.from("mcp_tokens").select("client_id").not("client_id", "is", null).limit(1000),
    ]);
    const conUso = new Set((usados ?? []).map((r) => r.client_id as string));
    const basura = (viejos ?? []).map((v) => v.id as string).filter((id) => !conUso.has(id));
    if (basura.length > 0) await svc.from("oauth_clients").delete().in("id", basura);
  } catch {
    // GC best-effort: si falla, el tope total sigue de pie.
  }

  // TOPE TOTAL: techo duro de filas.
  const { count } = await svc.from("oauth_clients").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= topeClientes()) {
    await recordOpsEvent({
      severity: "warn",
      source: "auth",
      eventName: "oauth_clients_tope_alcanzado",
      summary: `oauth_clients llegó al tope (${topeClientes()}) — revisar por abuso`,
      metadata: { ip, count: count ?? 0 },
    });
    return NextResponse.json({ error: "server_error" }, { status: 503 });
  }

  const { data, error } = await svc
    .from("oauth_clients")
    .insert({ client_name: registro.client_name, redirect_uris: registro.redirect_uris })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "server_error" }, { status: 500 });

  return respuestaCliente(data.id, registro.client_name, registro.redirect_uris, data.created_at, 201);
}
