"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { generarCodigoAutorizacion, hashOauthSecreto, redirectCoincide, CODE_TTL_MS, OAUTH_SCOPE } from "@/lib/mcp/oauth";
import { validarAccesoCuenta, esTitularDeCuenta } from "@/lib/entitlements";
import { MCP_REQUIERE_PLAN, MCP_SOLO_TITULAR } from "@/lib/mcp/copy";

// Consentimiento OAuth del conector MCP. El código de autorización nace ACÁ,
// solo después de que el usuario logueado apretó "Autorizar" — nunca antes.
// El redirect_uri se re-valida contra las registradas del cliente en este
// mismo paso (calce exacto): aunque el link de entrada viniera manipulado,
// el código jamás viaja a una URI no registrada.

export type SolicitudOauth = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
};

export async function autorizarConector(solicitud: SolicitudOauth): Promise<{ error: string } | never> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión vencida — vuelve a entrar y reintenta desde tu asistente." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Configuración del servidor incompleta." };
  const svc = createServiceClient(url, key) as unknown as SupabaseClient;

  const { data: cliente } = await svc
    .from("oauth_clients")
    .select("id, redirect_uris")
    .eq("id", solicitud.client_id)
    .maybeSingle();
  if (!cliente) return { error: "Conector desconocido." };
  if (!redirectCoincide(solicitud.redirect_uri, cliente.redirect_uris)) {
    return { error: "La dirección de retorno no coincide con la registrada por el conector." };
  }
  if (!solicitud.code_challenge || solicitud.code_challenge.length < 40) {
    return { error: "Solicitud inválida (falta PKCE)." };
  }

  // PLAN ANTES DE AUTORIZAR (2ª auditoría, 2026-09-06): el conector exige
  // plan activo (lib/mcp/auth.ts) pero esta pantalla dejaba autorizar en
  // trial — el usuario decía "sí" y su asistente recibía 403 en cada llamada:
  // "el conector no funciona". Decisión del fundador: en trial se bloquea y
  // se dice claro, ANTES de que exista un código.
  const { data: usuario } = await svc.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();
  if (!usuario?.empresa_id) return { error: "Tu cuenta aún no tiene empresa — termina el registro en la app." };
  const acceso = await validarAccesoCuenta(svc, user.id, usuario.empresa_id);
  if (!acceso.ok || !acceso.planActivo) return { error: MCP_REQUIERE_PLAN };
  if (!(await esTitularDeCuenta(svc, acceso.cuentaId, user.id))) return { error: MCP_SOLO_TITULAR };

  const code = generarCodigoAutorizacion();
  const { error } = await svc.from("oauth_codes").insert({
    code_hash: hashOauthSecreto(code),
    client_id: cliente.id,
    usuario_id: user.id,
    redirect_uri: solicitud.redirect_uri,
    code_challenge: solicitud.code_challenge,
    scope: OAUTH_SCOPE,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) return { error: "No se pudo autorizar — intenta de nuevo." };

  const destino = new URL(solicitud.redirect_uri);
  destino.searchParams.set("code", code);
  if (solicitud.state) destino.searchParams.set("state", solicitud.state);
  redirect(destino.toString());
}
