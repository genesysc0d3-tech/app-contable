import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarLoading from "./loading";
import RevisarClient from "./RevisarClient";

export default async function RevisarPage() {
  const usuario = (await getUsuario())!;
  return (
    <Suspense fallback={<RevisarLoading />}>
      <RevisarData empresaId={usuario.empresa_id} />
    </Suspense>
  );
}

async function RevisarData({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();

  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase
      .from("propuestas_ia")
      .select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nombre, rut")
      .eq("empresa_id", empresaId)
      .order("nombre", { ascending: true }),
  ]);

  return (
    <RevisarClient
      propuestas={propuestas ?? []}
      clientes={clientes ?? []}
      empresaId={empresaId}
    />
  );
}
