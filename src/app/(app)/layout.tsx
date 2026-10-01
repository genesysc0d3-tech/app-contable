import { getAppEmpresaContext } from "@/lib/dal";
import DevSupportBanner, { type BannerIntervencion } from "./escritorio/v5/DevSupportBanner";
import ActualizadorInvisible from "@/components/ActualizadorInvisible";
import { CLASE_TAPA, ESTILO_RESTAURANDO, SCRIPT_ANTES_DE_PINTAR } from "@/lib/actualizacion/estado-guardado";
import MesaSkeleton from "@/components/MesaSkeleton";

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
      {/* Actualización invisible: si esta carga viene de una recarga automática, la
          silueta de la mesa tapa la página ANTES de pintar hasta restaurar lo que la
          clienta veía (pestaña, doc, scroll) y se destapa con la vista ya restaurada.
          Solo en la app con sesión: /auth, /legal y las públicas no usan este layout. */}
      <style dangerouslySetInnerHTML={{ __html: ESTILO_RESTAURANDO }} />
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_ANTES_DE_PINTAR }} />
      <div className={CLASE_TAPA} aria-hidden="true"><MesaSkeleton /></div>
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
      <ActualizadorInvisible />
    </>
  );
}
