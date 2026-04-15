import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { getResumenMes, getHistorico6Meses } from "./actions";
import ResumenLoading from "./loading";
import ResumenClient from "./ResumenClient";

export default async function ResumenPage() {
  const usuario = (await getUsuario())!;
  const now = new Date();
  const mes = now.getMonth() + 1;
  const anio = now.getFullYear();

  return (
    <Suspense fallback={<ResumenLoading />}>
      <ResumenData
        empresaId={usuario.empresa_id}
        empresaNombre={usuario.empresas.razon_social}
        mes={mes}
        anio={anio}
      />
    </Suspense>
  );
}

async function ResumenData({
  empresaId,
  empresaNombre,
  mes,
  anio,
}: {
  empresaId: string;
  empresaNombre: string;
  mes: number;
  anio: number;
}) {
  const [resumen, historico] = await Promise.all([
    getResumenMes(empresaId, anio, mes),
    getHistorico6Meses(empresaId, anio, mes),
  ]);

  return (
    <ResumenClient
      empresaId={empresaId}
      empresaNombre={empresaNombre}
      initialResumen={resumen}
      initialHistorico={historico}
      initialMes={mes}
      initialAnio={anio}
    />
  );
}
