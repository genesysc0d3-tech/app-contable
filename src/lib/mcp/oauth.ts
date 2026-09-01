// OAuth 2.1 del conector MCP — parte pura y testeable (sin server-only).
//
// Implementa lo que el estándar de autorización de MCP exige a un servidor
// remoto: PKCE S256 OBLIGATORIO, redirect_uri por calce EXACTO, códigos de
// un solo uso con TTL corto. Acá viven las decisiones de seguridad; las
// rutas (authorize/token/register) solo orquestan.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPE = "revision"; // única scope: copiloto de revisión (solo lectura)
export const CODE_TTL_MS = 5 * 60_000; // 5 min — el intercambio es inmediato
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000; // 1 h
export const REFRESH_PREFIX = "mdtr_";
export const CODE_PREFIX = "mdtc_";

export function generarCodigoAutorizacion(): string {
  return CODE_PREFIX + randomBytes(32).toString("base64url");
}

export function generarRefreshToken(): string {
  return REFRESH_PREFIX + randomBytes(32).toString("base64url");
}

export function hashOauthSecreto(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex");
}

// PKCE S256: challenge = BASE64URL(SHA256(verifier)). El método "plain" NO se
// acepta (OAuth 2.1 lo entierra). Comparación en tiempo constante.
export function verificarPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) return false;
  const esperado = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const a = Buffer.from(esperado);
  const b = Buffer.from(codeChallenge ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

// redirect_uri: calce EXACTO contra las registradas (nada de prefijos ni
// subdominios — un calce laxo es un open redirect con el código adentro).
// https obligatorio, salvo loopback http (clientes nativos, RFC 8252).
export function redirectUriValida(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]")) return true;
  return false;
}

export function redirectCoincide(solicitada: string, registradas: unknown): boolean {
  if (!Array.isArray(registradas)) return false;
  return registradas.some((r) => typeof r === "string" && r === solicitada);
}

// Registro dinámico (RFC 7591): validación mínima y estricta del metadata.
export type RegistroCliente = { client_name: string; redirect_uris: string[] };

export function validarRegistroCliente(body: unknown): RegistroCliente | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid_client_metadata" };
  const b = body as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10) return { error: "invalid_redirect_uri" };
  if (!uris.every(redirectUriValida)) return { error: "invalid_redirect_uri" };
  const nombre = typeof b.client_name === "string" && b.client_name.trim()
    ? b.client_name.trim().slice(0, 80)
    : "cliente MCP";
  return { client_name: nombre, redirect_uris: uris };
}

// Metadata RFC 8414 / RFC 9728 — una sola fuente para las dos rutas .well-known.
export function metadataAuthorizationServer(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/autorizar`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

export function metadataProtectedResource(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  };
}
