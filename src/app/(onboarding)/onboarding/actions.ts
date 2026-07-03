"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validarRut } from "@/lib/rut";

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

  if (!validarRut(rut)) {
    return { error: "El RUT no es válido — revisa el dígito verificador" };
  }

  // Use service role to bypass RLS (user has no empresa yet)
  const admin = getServiceClient();

  // Create empresa
  const { data: empresa, error: empresaError } = await admin
    .from("empresas")
    .insert({ rut, razon_social, giro })
    .select()
    .single();

  if (empresaError) {
    // 23505 = unique_violation en Postgres (RUT duplicado)
    if (empresaError.code === "23505" || empresaError.message?.includes("duplicate key")) {
      return { error: "Ese RUT ya está registrado" };
    }
    return { error: "No se pudo guardar tu empresa. Intenta de nuevo." };
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
    return { error: "No se pudo guardar tu empresa. Intenta de nuevo." };
  }

  const { data: cuenta, error: cuentaError } = await admin
    .from("cuentas")
    .insert({
      nombre: razon_social,
      owner_usuario_id: user.id,
      plan_codigo: null,
      plan_activo: false,
    })
    .select("id")
    .single();

  if (cuentaError || !cuenta) {
    await admin.from("empresas").delete().eq("id", empresa.id);
    return { error: "No se pudo crear la cuenta. Intenta de nuevo." };
  }

  const [{ error: cuentaEmpresaError }, { error: cuentaUsuarioError }, { error: usuarioEmpresaError }] = await Promise.all([
    admin.from("cuenta_empresas").insert({
      cuenta_id: cuenta.id,
      empresa_id: empresa.id,
      es_principal: true,
      activa: true,
    }),
    admin.from("cuenta_usuarios").insert({
      cuenta_id: cuenta.id,
      usuario_id: user.id,
      es_titular: true,
      activo: true,
    }),
    admin.from("usuario_empresas").insert({
      usuario_id: user.id,
      empresa_id: empresa.id,
      rol: "titular",
    }),
  ]);

  const membershipError = cuentaEmpresaError ?? cuentaUsuarioError ?? usuarioEmpresaError;
  if (membershipError) {
    await admin.from("cuentas").delete().eq("id", cuenta.id);
    await admin.from("empresas").delete().eq("id", empresa.id);
    return { error: "No se pudo crear la cuenta. Intenta de nuevo." };
  }

  // Si el usuario eligió un plan en el landing (?plan= → cookie en registro), lo
  // llevamos a /planes con ese plan resaltado y limpiamos la cookie.
  const jar = await cookies();
  const planElegido = (jar.get("massdte_plan")?.value ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  if (planElegido) jar.delete("massdte_plan");
  redirect(planElegido ? `/planes?plan=${planElegido}` : "/planes");
}
