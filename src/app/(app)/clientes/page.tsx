import { getAppEmpresaContext } from "@/lib/dal";
import ClientesClient from "./ClientesClient";

export default async function ClientesPage() {
  const { empresaId, supabase } = await getAppEmpresaContext();

  const { data: clientes } = await supabase
    .from("clientes")
    .select("*, propuestas_ia(count)")
    .eq("empresa_id", empresaId)
    .order("nombre", { ascending: true });

  const clientesConCount = (clientes ?? []).map((c) => ({
    ...c,
    propuestas_ia: undefined,
    movimientos_count:
      (c.propuestas_ia as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));

  return <ClientesClient clientes={clientesConCount} empresaId={empresaId} />;
}
