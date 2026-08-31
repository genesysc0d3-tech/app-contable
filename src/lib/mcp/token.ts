// Tokens del conector MCP — parte pura y testeable (sin server-only).
//
// El token viaja como `Authorization: Bearer mdte_…` y en la base vive SOLO
// su hash sha256 (un dump de mcp_tokens no sirve para conectarse). Formato
// propio con prefijo para que un token filtrado sea reconocible en scanners
// de secretos.

import { createHash, randomBytes } from "node:crypto";

export const MCP_TOKEN_PREFIX = "mdte_";

export function generarMcpToken(): string {
  return MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Extrae el token del header Authorization. Null si no viene, no es Bearer,
// o no tiene el prefijo del conector (fail-closed: nada de aceptar cualquier
// string como credencial).
export function tokenDesdeAuthorization(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] ?? "";
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  if (token.length < MCP_TOKEN_PREFIX.length + 20) return null;
  return token;
}
