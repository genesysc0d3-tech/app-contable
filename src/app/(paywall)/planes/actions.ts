"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const DOCS_POR_PLAN: Record<string, number> = {
  starter: 10,
  pro: 50,
  empresa: 200,
};

export async function activarPlan(formData: FormData) {
  const supabase = await createClient();
  const plan = formData.get("plan") as string;

  if (!["starter", "pro", "empresa"].includes(plan)) {
    return { error: "Plan invalido" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    redirect("/onboarding");
  }

  // Activate plan (30 days)
  const venceAt = new Date();
  venceAt.setDate(venceAt.getDate() + 30);

  const { error: planError } = await supabase
    .from("empresas")
    .update({
      plan,
      plan_activo: true,
      plan_vence_at: venceAt.toISOString(),
    })
    .eq("id", usuario.empresa_id);

  if (planError) {
    return { error: planError.message };
  }

  // Create initial credits for the current month
  const now = new Date();
  await supabase.from("creditos_uso").upsert(
    {
      empresa_id: usuario.empresa_id,
      mes: now.getMonth() + 1,
      anio: now.getFullYear(),
      docs_incluidos: DOCS_POR_PLAN[plan],
      docs_usados: 0,
      docs_acumulados: 0,
    },
    { onConflict: "empresa_id,mes,anio" }
  );

  redirect("/subir");
}
