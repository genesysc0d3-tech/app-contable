import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { generarRefreshToken, hashOauthSecreto, verificarPkce, ACCESS_TOKEN_TTL_MS, OAUTH_SCOPE } from "@/lib/mcp/oauth";
import { generarMcpToken, hashMcpToken } from "@/lib/mcp/token";
import { clientIpFromRequest, rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";

// Endpoint de tokens OAuth 2.1 (application/x-www-form-urlencoded, público
// con PKCE — token_endpoint_auth_method "none", como exige el flujo de
// clientes públicos del estándar MCP).
//
// authorization_code: código de UN SOLO USO + TTL 5 min + PKCE S256 +
//   client y redirect_uri amarrados al código. El access token resultante
//   es un mcp_tokens con origen 'oauth' y expiración de 1 h + refresh.
// refresh_token: ROTA el refresh en cada uso (el viejo muere); un refresh
//   robado y reusado pierde la carrera y queda revocado.

function errorOauth(codigo: string, status = 400) {
  return NextResponse.json({ error: codigo }, { status, headers: { "Cache-Control": "no-store" } });
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: OAUTH_SCOPE,
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

export async function POST(request: Request) {
  const limited = await enforceRateLimitGlobal({
    key: rateLimitKey("oauth-token", clientIpFromRequest(request)),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return errorOauth("invalid_request");
  }
  const grant = form.get("grant_type") ?? "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorOauth("server_error", 500);
  const svc = createServiceClient(url, key) as unknown as SupabaseClient;

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const clientId = form.get("client_id") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    if (!code || !verifier || !clientId) return errorOauth("invalid_request");

    // Canje atómico del código: se marca usado ANTES de validar el resto.
    // Un replay (mismo código dos veces) pierde acá — y por seguridad,
    // el segundo intento además revoca lo emitido con ese código.
    const { data: fila, error } = await svc
      .from("oauth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", hashOauthSecreto(code))
      .is("used_at", null)
      .select("client_id, usuario_id, redirect_uri, code_challenge, scope, expires_at")
      .maybeSingle();
    if (error) return errorOauth("server_error", 500);
    if (!fila) return errorOauth("invalid_grant");
    if (new Date(fila.expires_at).getTime() < Date.now()) return errorOauth("invalid_grant");
    if (fila.client_id !== clientId) return errorOauth("invalid_grant");
    if (fila.redirect_uri !== redirectUri) return errorOauth("invalid_grant");
    if (!verificarPkce(verifier, fila.code_challenge)) return errorOauth("invalid_grant");

    const accessToken = generarMcpToken();
    const refreshToken = generarRefreshToken();
    const { data: cliente } = await svc.from("oauth_clients").select("client_name").eq("id", clientId).maybeSingle();
    const { error: insertError } = await svc.from("mcp_tokens").insert({
      usuario_id: fila.usuario_id,
      token_hash: hashMcpToken(accessToken),
      nombre: cliente?.client_name ?? "conector OAuth",
      origen: "oauth",
      client_id: clientId,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
      refresh_token_hash: hashOauthSecreto(refreshToken),
    });
    if (insertError) return errorOauth("server_error", 500);
    return tokenResponse(accessToken, refreshToken);
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    const clientId = form.get("client_id") ?? "";
    if (!refresh) return errorOauth("invalid_request");

    // Rotación atómica: el refresh viejo se anula en el mismo update que lo
    // reclama. El token de acceso viejo también muere (revoked_at) — cada
    // refresh deja exactamente UNA sesión viva por conexión.
    const nuevoAccess = generarMcpToken();
    const nuevoRefresh = generarRefreshToken();
    const { data: fila, error } = await svc
      .from("mcp_tokens")
      .update({ revoked_at: new Date().toISOString(), refresh_token_hash: null })
      .eq("refresh_token_hash", hashOauthSecreto(refresh))
      .is("revoked_at", null)
      .select("usuario_id, client_id, nombre")
      .maybeSingle();
    if (error) return errorOauth("server_error", 500);
    if (!fila) return errorOauth("invalid_grant");
    if (clientId && fila.client_id && clientId !== fila.client_id) return errorOauth("invalid_grant");

    const { error: insertError } = await svc.from("mcp_tokens").insert({
      usuario_id: fila.usuario_id,
      token_hash: hashMcpToken(nuevoAccess),
      nombre: fila.nombre ?? "conector OAuth",
      origen: "oauth",
      client_id: fila.client_id,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
      refresh_token_hash: hashOauthSecreto(nuevoRefresh),
    });
    if (insertError) return errorOauth("server_error", 500);
    return tokenResponse(nuevoAccess, nuevoRefresh);
  }

  return errorOauth("unsupported_grant_type");
}
