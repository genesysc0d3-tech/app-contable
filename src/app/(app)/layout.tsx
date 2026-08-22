import { getAppEmpresaContext } from "@/lib/dal";
import DevSupportBanner, { type BannerIntervencion } from "./escritorio/v5/DevSupportBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { empresa, supportMode } = await getAppEmpresaContext();

  // Estado de la intervención autorizada por el cliente (solo en modo soporte;
  // el CLIENTE ve lo suyo en Empresa → Acceso de soporte, no acá).
  let intervencion: BannerIntervencion = { estado: "ninguna" };
  if (supportMode) {
    const { estadoIntervencion } = await import("@/lib/dev/intervencion");
    const estado = await estadoIntervencion(supportMode.sb, empresa.id).catch(() => null);
    if (estado?.estado === "pendiente") intervencion = { estado: "pendiente", canal: estado.canal };
    else if (estado?.estado === "activa") intervencion = { estado: "activa", expiraAt: estado.expiraAt };
  }

  return (
    <>
      {supportMode && (
        <div style={{ padding: "12px 12px 0" }}>
          <DevSupportBanner
            empresaNombre={empresa.razon_social}
            operatorEmail={supportMode.operatorEmail}
            intervencion={intervencion}
          />
        </div>
      )}
      {children}
    </>
  );
}
