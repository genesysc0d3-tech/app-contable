import { getAppEmpresaContext } from "@/lib/dal";
import BottomNav from "@/components/layout/BottomNav";
import DevSupportBanner from "./escritorio/v5/DevSupportBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { empresaId, empresa, supabase, supportMode } = await getAppEmpresaContext();
  const { count } = await supabase
    .from("propuestas_ia")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("estado", "pendiente");

  return (
    <>
      {supportMode && (
        <div style={{ padding: "12px 12px 0" }}>
          <DevSupportBanner empresaNombre={empresa.razon_social} operatorEmail={supportMode.operatorEmail} />
        </div>
      )}
      {children}
      <BottomNav initialPendientes={count ?? 0} />
    </>
  );
}
