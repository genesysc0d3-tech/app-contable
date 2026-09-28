// Guard de SESIÓN SEGURA para rutas API (2026-09-28, hueco MFA de rutas excluidas).
//
// POR QUÉ EXISTE: el MFA aal2 y el cierre por inactividad vivían SOLO en el proxy
// (lib/supabase/proxy.ts). Las rutas EXCLUIDAS del matcher (src/proxy.ts:
// api/sii-local/*, api/archivo/, api/extension/*) se excluyeron para responder
// 401 JSON en vez de un 307 a /auth/login (la extensión parsea JSON y un <img>
// no sigue redirects), pero con eso corrían SIN MFA: una sesión aal1 (solo
// contraseña) de alguien con MFA enrolado podía pedir la llave de la bóveda SII,
// bajar comprobantes o registrar folios.
//
// Qué decide (la MISMA regla que el proxy, con las mismas piezas):
//   1. sin usuario validado por GET /user                → NO_AUTH
//   2. inactividad > 7 días (inactividad-sesion.ts)      → SESSION_EXPIRED
//   3. factor verificado (del SERVIDOR) y token != aal2  → MFA_REQUERIDO (mfa-proxy.ts)
// Nunca redirige: siempre 401 JSON. Se usa 401 también para MFA a propósito: la
// extensión (modules/sii-vault.js) mapea 401 → SESSION_EXPIRED, que es TRANSITORIO
// (no gasta el intento de autologin y le dice "entra de nuevo a la app"); al entrar,
// el proxy la lleva a /auth/mfa. Un 403 lo trataría como error permanente.
//
// Diferencias deliberadas con el proxy: acá NO se hace signOut (una ruta API no
// cierra la sesión de la pestaña por su cuenta; el proxy lo hace en la próxima
// página) y `ultimo_acceso` se refresca SOLO si la sesión es segura (una sesión
// aal1 no se mantiene viva sola llamando a la API).

import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { debeRefrescarUltimoAcceso, sesionVencidaPorInactividad } from "@/lib/auth/inactividad-sesion";
import { aalDelToken, necesitaMfa } from "@/lib/auth/mfa-proxy";

type Sb = SupabaseClient<Database>;

export type MotivoSesionInsegura = "NO_AUTH" | "SESSION_EXPIRED" | "MFA_REQUERIDO";

export type DecisionSesion = { ok: true } | { ok: false; motivo: MotivoSesionInsegura };

/** Decisión PURA (testeable): mismo orden que el proxy — sesión, inactividad, MFA. */
export function decidirSesionSegura(args: {
  hayUsuario: boolean;
  /** usuarios.ultimo_acceso; undefined = no se pudo leer (sin service key → fail-open, igual que el proxy). */
  ultimoAcceso: string | Date | null | undefined;
  /** user.last_sign_in_at (un login recién hecho nunca está vencido). */
  ultimoLogin: string | Date | null | undefined;
  /** claim `aal` del access token que getUser validó. */
  aalActual: string | null | undefined;
  /** user.factors tal como los devolvió GET /user. */
  factoresServidor: Array<{ status?: string | null }> | null | undefined;
  ahora?: number;
}): DecisionSesion {
  if (!args.hayUsuario) return { ok: false, motivo: "NO_AUTH" };
  if (sesionVencidaPorInactividad(args.ultimoAcceso, args.ahora ?? Date.now(), args.ultimoLogin)) {
    return { ok: false, motivo: "SESSION_EXPIRED" };
  }
  if (necesitaMfa({ aalActual: args.aalActual, factoresServidor: args.factoresServidor })) {
    return { ok: false, motivo: "MFA_REQUERIDO" };
  }
  return { ok: true };
}

/** Respuesta JSON uniforme (nunca redirect). 401 para los tres motivos: ver cabecera. */
export function respuestaSesionInsegura(motivo: MotivoSesionInsegura): NextResponse {
  return NextResponse.json({ ok: false, error: motivo }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

function serviceClient(): Sb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

/**
 * Aplica inactividad + MFA a un usuario YA validado con getUser() de `supabase`.
 * La comparten requireSesionSegura y requireAccountApiAccess: una sola regla.
 */
export async function verificarSesionSegura(supabase: Sb, user: User): Promise<DecisionSesion> {
  const sb = serviceClient();
  let ultimoAcceso: string | null | undefined;
  if (sb) {
    const { data: visto } = await sb.from("usuarios").select("ultimo_acceso").eq("id", user.id).maybeSingle();
    ultimoAcceso = visto?.ultimo_acceso ?? null;
    // last_sign_in_at: un login recién hecho nunca está "vencido" (incidente 2026-09-22).
    if (sesionVencidaPorInactividad(ultimoAcceso, Date.now(), user.last_sign_in_at)) {
      return { ok: false, motivo: "SESSION_EXPIRED" };
    }
  }
  // El aal sale del access token que getUser acaba de validar; los factores, del
  // usuario que devolvió el SERVIDOR (no de la cookie: ver mfa-proxy.ts).
  const { data: sesion } = await supabase.auth.getSession();
  const decision = decidirSesionSegura({
    hayUsuario: true,
    ultimoAcceso,
    ultimoLogin: user.last_sign_in_at,
    aalActual: aalDelToken(sesion.session?.access_token),
    factoresServidor: user.factors as Array<{ status?: string | null }> | undefined,
  });
  if (decision.ok && sb && debeRefrescarUltimoAcceso(ultimoAcceso)) {
    await sb.from("usuarios").update({ ultimo_acceso: new Date().toISOString() }).eq("id", user.id);
  }
  return decision;
}

export type SesionSeguraResult =
  | { ok: true; supabase: Sb; user: User }
  | { ok: false; motivo: MotivoSesionInsegura; response: NextResponse; supabase: Sb; user: User | null };

/**
 * Guard para rutas FUERA del matcher del proxy: sesión + inactividad + MFA, con
 * 401 JSON. Devuelve también `user` cuando existe aunque la sesión sea insegura,
 * para la única ruta que no responde 401 a todo: /api/sii-local/result, que con
 * sesión insegura guarda la captura del folio SOLO en el stash del servidor (sin
 * escribir boletas). Ver lib/emission/result-sesion-insegura.ts.
 */
export async function requireSesionSegura(): Promise<SesionSeguraResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, motivo: "NO_AUTH", response: respuestaSesionInsegura("NO_AUTH"), supabase, user: null };
  const decision = await verificarSesionSegura(supabase, user);
  if (!decision.ok) {
    return { ok: false, motivo: decision.motivo, response: respuestaSesionInsegura(decision.motivo), supabase, user };
  }
  return { ok: true, supabase, user };
}

/**
 * sii-mock/dte/* por HTTP: solo fuera de producción. Son mocks en memoria sin
 * ningún caller HTTP (el intermediario llama recibirDTE in-process,
 * lib/intermediario/client.ts), así que en producción no tienen nada que hacer
 * expuestos. `MASSDTE_ENABLE_SII_MOCK_HTTP=1` los reabre a propósito (y aun así
 * exigen sesión segura).
 */
export function mockSiiHttpHabilitado(env: { NODE_ENV?: string; MASSDTE_ENABLE_SII_MOCK_HTTP?: string }): boolean {
  return env.NODE_ENV !== "production" || env.MASSDTE_ENABLE_SII_MOCK_HTTP === "1";
}
