import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import type { Database, Tables } from "./database.types";
import { validarAccesoCuenta } from "./entitlements";
import { getDevSupportMode, type DevSupportMode } from "./dev/support-mode";

export type Usuario = Tables<"usuarios">;
export type Empresa = Tables<"empresas">;

export type UsuarioConEmpresa = Usuario & {
  empresas: Empresa;
};

type ActiveDevSupportMode = Extract<DevSupportMode, { ok: true }>;

export type AppEmpresaContext = {
  usuario: UsuarioConEmpresa;
  empresaId: string;
  empresa: Empresa;
  supabase: SupabaseClient<Database>;
  supportMode: ActiveDevSupportMode | null;
  readOnlyReason?: string;
};

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return user;
});

export const getUsuario = cache(async (): Promise<UsuarioConEmpresa | null> => {
  const user = await getSession();
  const supabase = await createClient();

  // Embed desambiguado: usuario_empresas (junction multiempresa) crea un segundo
  // camino usuarios↔empresas, así que hay que indicar el FK directo o PostgREST
  // falla el embed por ambigüedad.
  const { data } = await supabase
    .from("usuarios")
    .select("*, empresas!usuarios_empresa_id_fkey(*)")
    .eq("id", user.id)
    .single();

  if (data) return data as UsuarioConEmpresa;

  // Fallback robusto: si el cliente SSR no resuelve la fila (RLS/JWT no
  // propagado), buscar por el user.id de la sesión validada vía service role,
  // con dos queries separadas (sin embed, para evitar problemas de relación).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient: createServiceClient } = await import("@supabase/supabase-js");
    const sb = createServiceClient(url, key);
    const { data: u } = await sb.from("usuarios").select("*").eq("id", user.id).single();
    if (u?.empresa_id) {
      const { data: emp } = await sb.from("empresas").select("*").eq("id", u.empresa_id).single();
      if (emp) return { ...u, empresas: emp } as unknown as UsuarioConEmpresa;
    }
  }

  return null;
});

export async function requireActiveEmpresa(): Promise<UsuarioConEmpresa> {
  const usuario = await getUsuario();

  if (!usuario) {
    redirect("/onboarding");
  }

  if (usuario.vetado) {
    redirect("/bloqueado");
  }

  const supabase = await createClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accesoClient = url && key ? createServiceClient<Database>(url, key) : supabase;
  const acceso = await validarAccesoCuenta(accesoClient, usuario.id, usuario.empresa_id);

  if (!acceso.ok) {
    if (acceso.codigo === "EMPRESA_SIN_CUENTA" && usuario.empresas.plan_activo) {
      return usuario;
    }
    redirect(acceso.codigo === "USUARIO_SIN_CUENTA" ? "/bloqueado" : "/planes");
  }

  // Con cuenta pagadora creada, la cuenta es la autoridad. empresas.plan_activo
  // solo se conserva para filas pre-backfill detectadas arriba.
  if (!acceso.planActivo) {
    redirect("/planes");
  }

  return usuario;
}

export async function getAppEmpresaContext(): Promise<AppEmpresaContext> {
  const sessionUsuario = await requireActiveEmpresa();
  const support = await getDevSupportMode();

  if (support?.ok) {
    const usuario = {
      ...sessionUsuario,
      empresa_id: support.empresaId,
      empresas: support.empresa,
    } as UsuarioConEmpresa;

    return {
      usuario,
      empresaId: support.empresaId,
      empresa: support.empresa,
      supabase: support.sb,
      supportMode: support,
      readOnlyReason: "Modo soporte: solo lectura",
    };
  }

  const supabase = await createClient();
  return {
    usuario: sessionUsuario,
    empresaId: sessionUsuario.empresa_id,
    empresa: sessionUsuario.empresas,
    supabase,
    supportMode: null,
  };
}
