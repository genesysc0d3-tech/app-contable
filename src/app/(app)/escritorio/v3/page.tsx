import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../../subir/SubirClient";
import RevisarClient from "../../revisar/RevisarClient";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import TabsV3, { Tab as V3Tab } from "./TabsV3";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][m-1]}`;
}

export default async function EscritorioV3Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam, tab } = await searchParams;
  const selectedDate = dateParam === "all" ? null : (dateParam ?? todayStr());
  const activeTab = tab ?? "revisar";

  return (
    <div className="min-h-screen bg-[var(--background)] mesh-bg flex flex-col">
      <Suspense fallback={null}>
        <TopBarV3 empresa={usuario.empresas.razon_social} empresaId={empresaId} selectedDate={selectedDate} />
      </Suspense>

      <div className="max-w-[1400px] mx-auto w-full px-4 py-4 flex-1 flex flex-col">
        <Suspense fallback={null}>
          <StatsRowV3 empresaId={empresaId} />
        </Suspense>

        <div className="mt-3 flex-1">
          <Suspense fallback={<div className="h-64 animate-shimmer rounded-xl" />}>
            <TabsV3 activeTab={activeTab}>
              <V3Tab id="subir" label="Emitir" hint="Subir cartolas">
                <div className="h-full overflow-y-auto"><SubirClient empresaId={empresaId} /></div>
              </V3Tab>
              <V3Tab id="revisar" label="Revisar" hint={selectedDate ? formatDateShort(selectedDate) : "Todas"}>
                <div className="h-full overflow-y-auto">
                  <RevisarPanelV3 empresaId={empresaId} filterDate={selectedDate} />
                </div>
              </V3Tab>
              <V3Tab id="emitir" label="Emitir" hint="Boletas">
                <div className="h-full overflow-y-auto"><EmitirBoletaForm /></div>
              </V3Tab>
              <V3Tab id="boletas" label="Boletas" hint="Emitidas">
                <div className="h-full overflow-y-auto"><BoletasListV3 empresaId={empresaId} /></div>
              </V3Tab>
              <V3Tab id="empresa" label="Empresa" hint="Configuración">
                <div className="h-full overflow-y-auto text-sm text-[var(--muted-light)] p-4">
                  <a href="/empresa" className="text-[#E8553E] hover:underline font-medium">Ir a Empresa →</a>
                </div>
              </V3Tab>
            </TabsV3>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function TopBarV3({ empresa }: { empresa: string; empresaId: string; selectedDate: string | null }) {
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

async function RevisarPanelV3({ empresaId, filterDate }: { empresaId: string; filterDate: string | null }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  const all = propuestas ?? [];
  const filtered = filterDate ? all.filter((p) => p.created_at?.startsWith(filterDate)) : all;
  return <RevisarClient propuestas={filtered} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}

async function BoletasListV3({ empresaId }: { empresaId: string }) {
  return <BoletasList empresaId={empresaId} />;
}
