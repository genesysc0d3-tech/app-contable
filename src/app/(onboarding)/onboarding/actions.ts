"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function crearEmpresa(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const rut = formData.get("rut") as string;
  const razon_social = formData.get("razon_social") as string;
  const giro = formData.get("giro") as string;

  // Create empresa
  const { data: empresa, error: empresaError } = await supabase
    .from("empresas")
    .insert({ rut, razon_social, giro })
    .select()
    .single();

  if (empresaError) {
    return { error: empresaError.message };
  }

  // Create usuario linked to empresa
  const nombre =
    user.user_metadata?.nombre || user.user_metadata?.full_name || user.email || "";

  const { error: usuarioError } = await supabase.from("usuarios").insert({
    id: user.id,
    empresa_id: empresa.id,
    email: user.email!,
    nombre,
    rol: "owner",
  });

  if (usuarioError) {
    // Rollback empresa
    await supabase.from("empresas").delete().eq("id", empresa.id);
    return { error: usuarioError.message };
  }

  redirect("/planes");
}
