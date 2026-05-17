import { requireActiveEmpresa } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import BottomNav from "@/components/layout/BottomNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await requireActiveEmpresa();
  const supabase = await createClient();
  const { count } = await supabase
    .from("propuestas_ia")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", usuario.empresa_id)
    .eq("estado", "pendiente");

  return (
    <>
      {children}
      <BottomNav initialPendientes={count ?? 0} />
    </>
  );
}
