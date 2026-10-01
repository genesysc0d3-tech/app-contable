import { getAppEmpresaContext } from "@/lib/dal";
import DevSupportBanner, { type BannerIntervencion } from "./escritorio/v5/DevSupportBanner";
import ActualizadorInvisible from "@/components/ActualizadorInvisible";
import { ESTILO_RESTAURANDO, SCRIPT_ANTES_DE_PINTAR } from "@/lib/actualizacion/estado-guardado";

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
      {/* Actualización invisible: si esta carga viene de una recarga automática y la
          vista guardada difiere de la por defecto, la página queda invisible ANTES de
          pintar (el navegador sostiene el último cuadro) hasta restaurar lo que la
          clienta veía. Solo en la app con sesión: /auth, /legal y las públicas no usan
          este layout. */}
      <style dangerouslySetInnerHTML={{ __html: ESTILO_RESTAURANDO }} />
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_ANTES_DE_PINTAR }} />
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
