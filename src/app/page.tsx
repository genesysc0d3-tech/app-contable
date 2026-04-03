import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Check if user has empresa
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, vetado, empresas(plan_activo)")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    redirect("/onboarding");
  }

  if (usuario.vetado) {
    redirect("/bloqueado");
  }

  const empresa = usuario.empresas as unknown as { plan_activo: boolean } | null;
  if (!empresa?.plan_activo) {
    redirect("/planes");
  }

  redirect("/subir");
}
