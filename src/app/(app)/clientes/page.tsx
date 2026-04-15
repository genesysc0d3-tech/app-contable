import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import ClientesLoading from "./loading";
import ClientesClient from "./ClientesClient";

export default async function ClientesPage() {
  const usuario = (await getUsuario())!;
  return (
    <Suspense fallback={<ClientesLoading />}>
      <ClientesData empresaId={usuario.empresa_id} />
    </Suspense>
  );
}

async function ClientesData({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();

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
