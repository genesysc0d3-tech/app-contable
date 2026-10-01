import { getAppEmpresaContext } from "@/lib/dal";
import DevSupportBanner, { type BannerIntervencion } from "./escritorio/v5/DevSupportBanner";
import ActualizadorInvisible from "@/components/ActualizadorInvisible";
import { ESTILO_RESTAURANDO, SCRIPT_ANTES_DE_PINTAR } from "@/lib/actualizacion/estado-guardado";
import { Suspense } from "react";
import AvisosApp from "@/components/AvisosApp";
import { avisosPendientes, clienteServicioAvisos } from "@/lib/avisos/servidor";

/**
 * Avisos y novedades: viajan en ESTE render (que la app ya hace), por el MISMO camino
 * que /api/mesa (service role + la regla de empresa de servidor.ts, con el usuario y
 * la empresa activa que getAppEmpresaContext ya validó), con caché corta. En
 * Suspense: la consulta no atrasa la página. Si falla o tarda: undefined → la
 * pantalla deja su cola como está (N1).
 */
async function AvisosDeLaSesion({ userId, empresaId }: { userId: string; empresaId: string }) {
  const avisos = await avisosPendientes(clienteServicioAvisos(), { userId, empresaId });
  return <AvisosApp key={userId} iniciales={avisos} userId={userId} />;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { empresa, supportMode, usuario, empresaId } = await getAppEmpresaContext();

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
      {/* En modo soporte el operador no consume (ni marca) avisos de la clienta. */}
      {supportMode ? null : (
        <Suspense fallback={null}>
          <AvisosDeLaSesion userId={usuario.id} empresaId={empresaId} />
        </Suspense>
      )}
    </>
  );
}
