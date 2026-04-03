import { requireActiveEmpresa } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "./RevisarClient";

export default async function RevisarPage() {
  const usuario = await requireActiveEmpresa();
  const supabase = await createClient();

  const { data: propuestas } = await supabase
    .from("propuestas_ia")
    .select("*, movimientos_raw(*)")
    .eq("empresa_id", usuario.empresa_id)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false });

  return <RevisarClient propuestas={propuestas ?? []} />;
}
