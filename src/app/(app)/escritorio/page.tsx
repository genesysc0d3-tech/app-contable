import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getResumenMes, getHistorico6Meses } from "../resumen/actions";
import SubirClient from "../subir/SubirClient";
import RevisarClient from "../revisar/RevisarClient";
import ClientesClient from "../clientes/ClientesClient";
import ResumenClient from "../resumen/ResumenClient";

export default async function EscritorioPage() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const now = new Date();
  const mes = now.getMonth() + 1;
  const anio = now.getFullYear();

  return (
    <div className="escritorio-root min-h-screen">
      <div className="max-w-[1400px] mx-auto px-6 pt-8 pb-12">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--muted-light)]">
              Panel
            </p>
            <h1 className="text-[32px] font-extrabold text-[var(--foreground)] mt-1 leading-none">
              {usuario.empresas.razon_social}
            </h1>
          </div>
          <p className="text-sm text-[var(--muted)] capitalize">
            {new Date().toLocaleDateString("es-CL", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="space-y-8 min-w-0">
            <Column>
              <Suspense fallback={<div className="animate-shimmer h-72 rounded-[20px]" />}>
                <SubirPanel empresaId={empresaId} />
              </Suspense>
            </Column>
            <Column>
              <Suspense fallback={<div className="animate-shimmer h-80 rounded-[20px]" />}>
                <ClientesPanel empresaId={empresaId} />
              </Suspense>
            </Column>
          </div>

          <div className="space-y-8 min-w-0">
            <Column>
              <Suspense fallback={<div className="animate-shimmer h-[32rem] rounded-[20px]" />}>
                <RevisarPanel empresaId={empresaId} />
              </Suspense>
            </Column>
            <Column>
              <Suspense fallback={<div className="animate-shimmer h-96 rounded-[20px]" />}>
                <ResumenPanel
                  empresaId={empresaId}
                  empresaNombre={usuario.empresas.razon_social}
                  mes={mes}
                  anio={anio}
                />
              </Suspense>
            </Column>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return <div className="escritorio-col min-w-0">{children}</div>;
}

// --- Data fetchers ---

async function SubirPanel({ empresaId }: { empresaId: string }) {
  return <SubirClient empresaId={empresaId} />;
}

async function ClientesPanel({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: clientes } = await supabase
    .from("clientes")
    .select("*, propuestas_ia(count)")
    .eq("empresa_id", empresaId)
    .order("nombre", { ascending: true });

  const clientesConCount = (clientes ?? []).map((c) => ({
    ...c,
    propuestas_ia: undefined,
    movimientos_count:
      (c.propuestas_ia as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));

  return <ClientesClient clientes={clientesConCount} empresaId={empresaId} />;
}

async function RevisarPanel({ empresaId }: { empresaId: string }) {
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

async function ResumenPanel({
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
