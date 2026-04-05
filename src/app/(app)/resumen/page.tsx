import { requireActiveEmpresa } from "@/lib/dal";
import { getResumenMes, getHistorico6Meses } from "./actions";
import PageTransition from "@/components/PageTransition";
import ResumenClient from "./ResumenClient";

export default async function ResumenPage() {
  const usuario = await requireActiveEmpresa();
  const now = new Date();
  const mes = now.getMonth() + 1;
  const anio = now.getFullYear();

  const [resumen, historico] = await Promise.all([
    getResumenMes(usuario.empresa_id, anio, mes),
    getHistorico6Meses(usuario.empresa_id, anio, mes),
  ]);

  return (
    <PageTransition>
      <ResumenClient
        empresaId={usuario.empresa_id}
        empresaNombre={usuario.empresas.razon_social}
        initialResumen={resumen}
        initialHistorico={historico}
        initialMes={mes}
        initialAnio={anio}
      />
    </PageTransition>
  );
}
