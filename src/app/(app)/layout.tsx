import { getAppEmpresaContext } from "@/lib/dal";
import DevSupportBanner from "./escritorio/v5/DevSupportBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { empresa, supportMode } = await getAppEmpresaContext();

  return (
    <>
      {supportMode && (
        <div style={{ padding: "12px 12px 0" }}>
          <DevSupportBanner empresaNombre={empresa.razon_social} operatorEmail={supportMode.operatorEmail} />
        </div>
      )}
      {children}
    </>
  );
}
