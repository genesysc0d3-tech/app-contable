import "server-only";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { hashMcpToken, tokenDesdeAuthorization } from "@/lib/mcp/token";

type Sb = SupabaseClient<Database>;

// BARRERA #1 del conector MCP: la identidad hereda las cerraduras de la
// cuenta, nunca las puentea. El token resuelve a un usuario_id y de ahí el
// servidor DERIVA la empresa (usuarios.empresa_id) — jamás se acepta
// empresa_id como argumento de una herramienta. Veto, membresía y plan se
// validan con la MISMA función que usa la app (validarAccesoCuenta):
// comprometer un token MCP rinde, como techo, lo mismo que comprometer un
// chat de Telegram — leer/proponer dentro de UNA empresa autorizada.

export type McpAccess =
  | { ok: true; svc: Sb; usuarioId: string; empresaId: string; tokenId: string }
  | { ok: false; status: number; error: string };

export async function requireMcpAccess(request: Request): Promise<McpAccess> {
  const token = tokenDesdeAuthorization(request.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, error: "TOKEN_REQUERIDO" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 500, error: "BACKEND_CONFIG_MISSING" };
  const svc = createServiceClient<Database>(url, key);

  // mcp_tokens todavía no está en database.types (se regenera al aplicar la
  // migración 20260831180000 a prod) — cliente sin tipos SOLO para esta tabla.
  type McpTokenRow = { id: string; usuario_id: string; revoked_at: string | null };
  const sinTipos = svc as unknown as SupabaseClient;
  const { data, error } = await sinTipos
    .from("mcp_tokens")
    .select("id, usuario_id, revoked_at")
    .eq("token_hash", hashMcpToken(token))
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "TOKEN_QUERY_FAILED" };
  const fila = data as McpTokenRow | null;
  if (!fila || fila.revoked_at) return { ok: false, status: 401, error: "TOKEN_INVALIDO" };

  const { data: usuario } = await svc
    .from("usuarios")
    .select("id, empresa_id, vetado")
    .eq("id", fila.usuario_id)
    .maybeSingle();
  if (!usuario?.empresa_id) return { ok: false, status: 403, error: "USUARIO_SIN_EMPRESA" };
  if (usuario.vetado === true) return { ok: false, status: 403, error: "USUARIO_VETADO" };

  const acceso = await validarAccesoCuenta(svc, usuario.id, usuario.empresa_id);
  if (!acceso.ok) return { ok: false, status: 403, error: acceso.codigo };
  if (!acceso.planActivo) return { ok: false, status: 403, error: "PLAN_INACTIVO" };

  // Huella de uso (fire-and-forget: no bloquea la request).
  void sinTipos.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", fila.id).then(() => {});

  return { ok: true, svc, usuarioId: usuario.id, empresaId: usuario.empresa_id, tokenId: fila.id };
}
