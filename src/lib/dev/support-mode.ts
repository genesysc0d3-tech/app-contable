import "server-only";

import { cookies } from "next/headers";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const DEV_OPERATOR_EMAIL = "genesysc0d3@gmail.com";
export const DEV_SUPPORT_EMPRESA_COOKIE = "massdte_dev_support_empresa_id";

type Sb = SupabaseClient<Database>;
type Usuario = Pick<Tables<"usuarios">, "id" | "email" | "nombre" | "dev_mode" | "vetado" | "empresa_id">;
type Empresa = Tables<"empresas">;

export type DevOperatorContext =
  | { ok: true; sb: Sb; userId: string; email: string; usuario: Usuario }
  | { ok: false; error: "NO_AUTH" | "NOT_DEV_OPERATOR" | "BACKEND_CONFIG_MISSING" | "USUARIO_QUERY_FAILED"; detalle?: string };

export type DevOperatorDiagnostics = {
  authenticated: boolean;
  backendConfigured: boolean;
  expectedEmail: string;
  authUserId: string | null;
  authEmail: string | null;
  usuarioEncontrado: boolean;
  usuarioEmail: string | null;
  usuarioNombre: string | null;
  usuarioDevMode: boolean | null;
  usuarioVetado: boolean | null;
  emailOk: boolean;
  devModeOk: boolean;
  vetadoOk: boolean;
  ok: boolean;
  error: string | null;
  detalle?: string;
};

export type DevSupportMode =
  | { ok: true; sb: Sb; operatorUserId: string; operatorEmail: string; empresa: Empresa; empresaId: string }
  | { ok: false; error: string; detalle?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceClient(): Sb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

function cleanUuid(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return UUID_RE.test(text) ? text : null;
}

export async function getDevOperatorContext(): Promise<DevOperatorContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "NO_AUTH" };

  const sb = serviceClient();
  if (!sb) return { ok: false, error: "BACKEND_CONFIG_MISSING" };

  const { data: usuario, error } = await sb
    .from("usuarios")
    .select("id, email, nombre, dev_mode, vetado, empresa_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: "USUARIO_QUERY_FAILED", detalle: error.message };

  const email = (usuario?.email || user.email || "").trim().toLowerCase();
  // Doble gate como promete la doc: email operador + usuarios.dev_mode + no vetado.
  // dev_mode funciona como kill-switch por columna: si la cuenta se compromete, basta
  // ponerla en false para cortar el god-mode aunque el email siga siendo el del operador.
  if (email !== DEV_OPERATOR_EMAIL || !usuario || usuario.vetado === true || usuario.dev_mode !== true) {
    return { ok: false, error: "NOT_DEV_OPERATOR" };
  }

  return { ok: true, sb, userId: user.id, email, usuario };
}

export async function getDevOperatorDiagnostics(): Promise<DevOperatorDiagnostics> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      authenticated: false,
      backendConfigured: false,
      expectedEmail: DEV_OPERATOR_EMAIL,
      authUserId: null,
      authEmail: null,
      usuarioEncontrado: false,
      usuarioEmail: null,
      usuarioNombre: null,
      usuarioDevMode: null,
      usuarioVetado: null,
      emailOk: false,
      devModeOk: false,
      vetadoOk: false,
      ok: false,
      error: "NO_AUTH",
    };
  }

  const sb = serviceClient();
  if (!sb) {
    return {
      authenticated: true,
      backendConfigured: false,
      expectedEmail: DEV_OPERATOR_EMAIL,
      authUserId: user.id,
      authEmail: user.email ?? null,
      usuarioEncontrado: false,
      usuarioEmail: null,
      usuarioNombre: null,
      usuarioDevMode: null,
      usuarioVetado: null,
      emailOk: (user.email ?? "").trim().toLowerCase() === DEV_OPERATOR_EMAIL,
      devModeOk: false,
      vetadoOk: false,
      ok: false,
      error: "BACKEND_CONFIG_MISSING",
    };
  }

  const { data: usuario, error } = await sb
    .from("usuarios")
    .select("id, email, nombre, dev_mode, vetado, empresa_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    return {
      authenticated: true,
      backendConfigured: true,
      expectedEmail: DEV_OPERATOR_EMAIL,
      authUserId: user.id,
      authEmail: user.email ?? null,
      usuarioEncontrado: false,
      usuarioEmail: null,
      usuarioNombre: null,
      usuarioDevMode: null,
      usuarioVetado: null,
      emailOk: false,
      devModeOk: false,
      vetadoOk: false,
      ok: false,
      error: "USUARIO_QUERY_FAILED",
      detalle: error.message,
    };
  }

  const effectiveEmail = (usuario?.email || user.email || "").trim().toLowerCase();
  const emailOk = effectiveEmail === DEV_OPERATOR_EMAIL;
  const vetadoOk = usuario?.vetado !== true;
  return {
    authenticated: true,
    backendConfigured: true,
    expectedEmail: DEV_OPERATOR_EMAIL,
    authUserId: user.id,
    authEmail: user.email ?? null,
    usuarioEncontrado: !!usuario,
    usuarioEmail: usuario?.email ?? null,
    usuarioNombre: usuario?.nombre ?? null,
    usuarioDevMode: usuario?.dev_mode ?? null,
    usuarioVetado: usuario?.vetado ?? null,
    emailOk,
    devModeOk: usuario?.dev_mode === true,
    vetadoOk,
    ok: !!usuario && emailOk && vetadoOk,
    error: !!usuario && emailOk && vetadoOk ? null : "NOT_DEV_OPERATOR",
  };
}

export async function getDevSupportMode(): Promise<DevSupportMode | null> {
  const cookieStore = await cookies();
  const empresaId = cleanUuid(cookieStore.get(DEV_SUPPORT_EMPRESA_COOKIE)?.value);
  if (!empresaId) return null;

  const operator = await getDevOperatorContext();
  if (!operator.ok) return { ok: false, error: operator.error, detalle: operator.detalle };

  const { data: empresa, error } = await operator.sb
    .from("empresas")
    .select("*")
    .eq("id", empresaId)
    .maybeSingle();
  if (error) return { ok: false, error: "DEV_SUPPORT_EMPRESA_QUERY_FAILED", detalle: error.message };
  if (!empresa) return { ok: false, error: "DEV_SUPPORT_EMPRESA_NOT_FOUND" };

  return {
    ok: true,
    sb: operator.sb,
    operatorUserId: operator.userId,
    operatorEmail: operator.email,
    empresa,
    empresaId,
  };
}

export async function getDevSupportWriteBlock(): Promise<{ error: string } | null> {
  const support = await getDevSupportMode();
  if (support?.ok) return { error: "Modo soporte: solo lectura" };
  return null;
}

export async function setDevSupportEmpresaCookie(empresaId: string) {
  const cookieStore = await cookies();
  cookieStore.set({
    name: DEV_SUPPORT_EMPRESA_COOKIE,
    value: empresaId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
}

export async function clearDevSupportEmpresaCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(DEV_SUPPORT_EMPRESA_COOKIE);
}
