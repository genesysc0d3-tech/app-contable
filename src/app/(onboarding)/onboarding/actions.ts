"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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

  // Use service role to bypass RLS (user has no empresa yet)
  const admin = getServiceClient();

  // Create empresa
  const { data: empresa, error: empresaError } = await admin
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

  // upsert (no insert): si ya existe la fila del usuario (cuenta creada sin
  // empresa, o estado parcial) se actualiza su empresa_id en vez de fallar con
  // duplicate usuarios_pkey.
  const { error: usuarioError } = await admin.from("usuarios").upsert({
    id: user.id,
    empresa_id: empresa.id,
    email: user.email!,
    nombre,
    rol: "owner",
  }, { onConflict: "id" });

  if (usuarioError) {
    // Rollback empresa
    await admin.from("empresas").delete().eq("id", empresa.id);
    return { error: usuarioError.message };
  }

  redirect("/planes");
}
