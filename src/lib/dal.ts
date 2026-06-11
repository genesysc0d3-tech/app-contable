import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Tables } from "./database.types";

export type Usuario = Tables<"usuarios">;
export type Empresa = Tables<"empresas">;

export type UsuarioConEmpresa = Usuario & {
  empresas: Empresa;
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

  if (!usuario.empresas.plan_activo) {
    redirect("/planes");
  }

  return usuario;
}
