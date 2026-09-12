"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordCuentaAudit } from "@/lib/audit/account";
import { validarAccesoCuenta, esTitularDeCuenta } from "@/lib/entitlements";

// Conexiones MCP del usuario (panel "Conector MCP" del popup empresa):
// ver a qué asistentes está conectado y DESCONECTAR al instante. Desconectar
// = revocar el token + matar su refresh → la próxima llamada rebota 401.
// Todo scoped al usuario de la sesión: nadie lista ni corta conexiones ajenas.

export type ConexionMcp = {
  id: string;
  nombre: string;
  origen: "manual" | "oauth";
  creado: string;
  ultimoUso: string | null;
};

type FilaConexion = {
  id: string;
  nombre: string | null;
  origen: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  refresh_token_hash: string | null;
  expires_at: string | null;
  oauth_clients?: { redirect_uris?: unknown } | { redirect_uris?: unknown }[] | null;
};

/**
 * Nombre a mostrar del conector. Algunos clientes mandan un client_name basura por
 * Dynamic Client Registration (Claude registra "ping"), así que preferimos derivar
 * el asistente del redirect_uri (señal confiable, igual que /api/mcp/estado).
 */
function nombreAsistenteMcp(redirectUris: string[], nombreGuardado: string | null, origen: string | null): string {
  if (redirectUris.some((u) => /^https:\/\/claude\.(ai|com)\//.test(u))) return "Claude";
  if (redirectUris.some((u) => /^https:\/\/(chatgpt|openai)\.com\//.test(u))) return "ChatGPT";
  const n = nombreGuardado?.trim();
  if (n && n.toLowerCase() !== "ping") return n; // "ping" = basura de DCR, no un nombre
  return origen === "oauth" ? "Conector" : "token manual";
}

function svcSinTipos(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // mcp_tokens con columnas OAuth entra a database.types al aplicar la
  // migración; cliente sin tipos mientras tanto.
  return createServiceClient(url, key) as unknown as SupabaseClient;
}

export async function listarConectoresMcp(): Promise<{ ok: true; conexiones: ConexionMcp[]; planActivo: boolean; esTitular: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "NO_AUTH" };

  const svc = svcSinTipos();
  if (!svc) return { ok: false, error: "BACKEND_CONFIG_MISSING" };

  const { data, error } = await svc
    .from("mcp_tokens")
    .select("id, nombre, origen, created_at, last_used_at, revoked_at, refresh_token_hash, expires_at, oauth_clients(redirect_uris)")
    .eq("usuario_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: "QUERY_FAILED" };

  // Una conexión viva = token manual, o token OAuth cuya cadena de refresh
  // sigue activa (los access rotados quedan revocados; el vigente porta el
  // refresh). Un OAuth expirado sin refresh es basura muerta: no se lista.
  const conexiones = ((data ?? []) as FilaConexion[])
    .filter((f) => f.origen !== "oauth" || f.refresh_token_hash !== null)
    .map((f) => {
      const cliente = (Array.isArray(f.oauth_clients) ? f.oauth_clients[0] : f.oauth_clients) as { redirect_uris?: unknown } | null;
      const uris: string[] = Array.isArray(cliente?.redirect_uris)
        ? cliente.redirect_uris.filter((u): u is string => typeof u === "string")
        : [];
      return {
        id: f.id,
        nombre: nombreAsistenteMcp(uris, f.nombre, f.origen),
        origen: (f.origen === "oauth" ? "oauth" : "manual") as "oauth" | "manual",
        creado: f.created_at,
        ultimoUso: f.last_used_at,
      };
    });
  // ¿Tiene plan? El conector exige plan activo (lib/mcp/auth.ts); en trial el
  // panel se ve en gris y sin botones (fundador 2026-09-06). Se decide acá,
  // server-side, con la misma regla que usa el consentimiento.
  const { data: usuario } = await svc.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();
  let planActivo = false;
  let esTitular = false;
  if (usuario?.empresa_id) {
    const acceso = await validarAccesoCuenta(svc, user.id, usuario.empresa_id);
    planActivo = acceso.ok && acceso.planActivo;
    // Solo la cuenta principal usa el conector (fundador 2026-09-06).
    esTitular = acceso.ok && (await esTitularDeCuenta(svc, acceso.cuentaId, user.id));
  }
  return { ok: true, conexiones, planActivo, esTitular };
}

export async function desconectarConectorMcp(tokenId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "NO_AUTH" };

  const svc = svcSinTipos();
  if (!svc) return { ok: false, error: "BACKEND_CONFIG_MISSING" };

  const { error, count } = await svc
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString(), refresh_token_hash: null }, { count: "exact" })
    .eq("id", tokenId)
    .eq("usuario_id", user.id)
    .is("revoked_at", null);
  if (error) return { ok: false, error: "UPDATE_FAILED" };
  if (!count) return { ok: false, error: "NO_ENCONTRADO" };

  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();
  if (usuario?.empresa_id) {
    await recordCuentaAudit({
      sb: svc,
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      accion: "mcp_conector_desconectado",
      recursoTipo: "mcp_token",
      recursoId: tokenId,
      resumen: "Conector MCP desconectado por el usuario",
    });
  }
  return { ok: true };
}
