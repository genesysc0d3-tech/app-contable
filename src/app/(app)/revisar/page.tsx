import { requireActiveEmpresa } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "./RevisarClient";

export default async function RevisarPage() {
  const usuario = await requireActiveEmpresa();
  const supabase = await createClient();

  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase
      .from("propuestas_ia")
      .select("*, movimientos_raw(*)")
      .eq("empresa_id", usuario.empresa_id)
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nombre, rut")
      .eq("empresa_id", usuario.empresa_id)
      .order("nombre", { ascending: true }),
  ]);

  return (
    <RevisarClient
      propuestas={propuestas ?? []}
      clientes={clientes ?? []}
      empresaId={usuario.empresa_id}
    />
  );
}
