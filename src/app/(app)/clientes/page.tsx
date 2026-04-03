import { requireActiveEmpresa } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import ClientesClient from "./ClientesClient";

export default async function ClientesPage() {
  const usuario = await requireActiveEmpresa();
  const supabase = await createClient();

  // Fetch clientes with count of linked movimientos via propuestas_ia
  const { data: clientes } = await supabase
    .from("clientes")
    .select("*, propuestas_ia(count)")
    .eq("empresa_id", usuario.empresa_id)
    .order("nombre", { ascending: true });

  const clientesConCount = (clientes ?? []).map((c) => ({
    ...c,
    propuestas_ia: undefined,
    movimientos_count:
      (c.propuestas_ia as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));

  return (
    <ClientesClient
      clientes={clientesConCount}
      empresaId={usuario.empresa_id}
    />
  );
}
