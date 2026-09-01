"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordCuentaAudit } from "@/lib/audit/account";

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
};

function svcSinTipos(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // mcp_tokens con columnas OAuth entra a database.types al aplicar la
  // migración; cliente sin tipos mientras tanto.
  return createServiceClient(url, key) as unknown as SupabaseClient;
}

export async function listarConectoresMcp(): Promise<{ ok: true; conexiones: ConexionMcp[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "NO_AUTH" };

  const svc = svcSinTipos();
  if (!svc) return { ok: false, error: "BACKEND_CONFIG_MISSING" };

  const { data, error } = await svc
    .from("mcp_tokens")
    .select("id, nombre, origen, created_at, last_used_at, revoked_at, refresh_token_hash, expires_at")
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
    .map((f) => ({
      id: f.id,
      nombre: f.nombre?.trim() || (f.origen === "oauth" ? "conector" : "token manual"),
      origen: (f.origen === "oauth" ? "oauth" : "manual") as "oauth" | "manual",
      creado: f.created_at,
      ultimoUso: f.last_used_at,
    }));
  return { ok: true, conexiones };
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
