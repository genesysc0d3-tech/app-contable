import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../../subir/SubirClient";
import RevisarClient from "../../revisar/RevisarClient";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import TabsV3, { Tab } from "./TabsV3";

export default async function EscritorioV3Page() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  return (
    <div className="min-h-screen bg-[var(--background)] mesh-bg flex flex-col">
      <TopBarV3 empresa={usuario.empresas.razon_social} />
      <div className="max-w-[1400px] mx-auto w-full px-4 py-4 flex-1 flex flex-col">
        <Suspense fallback={<div className="h-10 animate-shimmer rounded-xl" />}>
          <StatsRowV3 empresaId={empresaId} />
        </Suspense>
        <div className="mt-3 flex-1">
          <Suspense fallback={<div className="h-64 animate-shimmer rounded-xl" />}>
            <TabsV3>
              <Tab id="subir" label="Emitir">
                <div className="min-h-[400px]"><SubirClient empresaId={empresaId} /></div>
              </Tab>
              <Tab id="revisar" label="Revisar">
                <div className="min-h-[400px]">
                  <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />}>
                    <RevisarPanelV3 empresaId={empresaId} />
                  </Suspense>
                </div>
              </Tab>
              <Tab id="emitir" label="Emitir">
                <div className="min-h-[400px]"><EmitirBoletaForm /></div>
              </Tab>
              <Tab id="boletas" label="Boletas">
                <div className="min-h-[400px]"><BoletasListV3 empresaId={empresaId} /></div>
              </Tab>
            </TabsV3>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function TopBarV3({ empresa }: { empresa: string }) {
  return (
    <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
      <div className="max-w-[1400px] mx-auto px-4 h-11 flex items-center gap-2">
        <span className="relative flex h-2 w-2"><span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8553E]" /></span>
        <span className="text-xs font-medium truncate">{empresa}</span>
      </div>
    </header>
  );
}

async function StatsRowV3({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const pendientes = await supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente");
  return (
    <div className="flex items-center gap-4 text-sm bg-white/50 dark:bg-white/[0.03] rounded-xl px-4 py-2.5 border border-[var(--border)]">
      <span className="text-lg font-light tabular-nums">{pendientes.count ?? 0}</span>
      <span className="text-[var(--muted-light)] text-xs">pendientes</span>
    </div>
  );
}

async function RevisarPanelV3({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  return <RevisarClient propuestas={propuestas ?? []} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}

async function BoletasListV3({ empresaId }: { empresaId: string }) {
  return <BoletasList empresaId={empresaId} />;
}
