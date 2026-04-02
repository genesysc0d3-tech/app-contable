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

  const { data } = await supabase
    .from("usuarios")
    .select("*, empresas(*)")
    .eq("id", user.id)
    .single();

  return data as UsuarioConEmpresa | null;
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
