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

export default async function EscritorioV3Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam, tab } = await searchParams;
  const selectedDate = dateParam === "all" ? null : (dateParam ?? todayStr());
  const activeTab = (tab as "subir" | "revisar" | "emitir" | "boletas" | "empresa") ?? "revisar";

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg flex flex-col">
      <Suspense fallback={null}>
        <TopBarV3 empresa={usuario.empresas.razon_social} empresaId={empresaId} selectedDate={selectedDate} />
      </Suspense>

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-3 sm:px-4 pt-3 pb-4 h-0 flex flex-col">
        {/* Stats row */}
        <Suspense fallback={null}>
          <StatsRowV3 empresaId={empresaId} selectedDate={selectedDate} />
        </Suspense>

        {/* Tab bar + content */}
        <div className="flex-1 min-h-0 mt-2">
          <div className="h-full">
            <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />}>
              <TabsV3 activeTab={activeTab}>
            <V3Tab id="subir" label="Emitir" hint="Subir cartolas y documentos">
              <div className="overflow-y-auto h-full">
                <Suspense fallback={<div className="h-32 animate-shimmer rounded-xl" />}>
                  <SubirClient empresaId={empresaId} />
                </Suspense>
              </div>
            </V3Tab>

            <V3Tab id="revisar" label="Revisar" hint={selectedDate ? formatDateShort(selectedDate) : "Todas"} spotlight>
              <div className="overflow-y-auto h-full">
                <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />} key={selectedDate ?? "all"}>
                  <RevisarPanelV3 empresaId={empresaId} filterDate={selectedDate} />
                </Suspense>
              </div>
            </V3Tab>

            <V3Tab id="emitir" label="Emitir" hint="Boletas electrónicas">
              <div className="overflow-y-auto h-full space-y-3">
                <Suspense fallback={<div className="h-32 animate-shimmer rounded-xl" />}>
                  <EmitirBoletaForm />
                </Suspense>
              </div>
            </V3Tab>

            <V3Tab id="boletas" label="Boletas" hint="Emitidas">
              <div className="overflow-y-auto h-full">
                <Suspense fallback={<div className="h-32 animate-shimmer rounded-xl" />}>
                  <BoletasListV3 empresaId={empresaId} />
                </Suspense>
              </div>
            </V3Tab>

            <V3Tab id="empresa" label="Empresa" hint="Configuración">
              <EmpresaTabV3 empresaId={empresaId} />
            </V3Tab>
          </TabsV3>
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Stats row ── */

async function StatsRowV3({ empresaId, selectedDate }: { empresaId: string; selectedDate: string | null }) {
  const supabase = await createClient();
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [pendientes, emitidosMes, aprobadosMes, folios] = await Promise.all([
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente"),
    supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", startMonth),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["aprobado", "editado"]).gte("created_at", startMonth),
    supabase.from("boletas_caf_mock").select("folio_actual, folio_hasta, tipo_dte").eq("empresa_id", empresaId).eq("estado", "activo"),
  ]);

  const foliosRest = (folios.data ?? []).reduce((s, f) => s + (f.folio_hasta - f.folio_actual + 1), 0);

  return (
    <div className="flex items-center gap-3 sm:gap-5 text-[11px] bg-white/50 dark:bg-white/[0.03] rounded-xl px-3 sm:px-4 py-2 border border-[var(--border)]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-light tabular-nums text-[var(--foreground)]">{pendientes.count ?? 0}</span>
        <span className="text-[var(--muted-light)]">por revisar</span>
      </div>
      <span className="text-[var(--border)] hidden sm:block">|</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-light tabular-nums text-[#22C55E]">{aprobadosMes.count ?? 0}</span>
        <span className="text-[var(--muted-light)]">aprobados</span>
      </div>
      <span className="text-[var(--border)] hidden sm:block">|</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-light tabular-nums text-[#3B82F6]">{emitidosMes.count ?? 0}</span>
        <span className="text-[var(--muted-light)]">emitidos</span>
      </div>
      <span className="text-[var(--border)] hidden sm:block">|</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-light tabular-nums text-[#8B5CF6]">{foliosRest}</span>
        <span className="text-[var(--muted-light)]">folios</span>
      </div>
    </div>
  );
}

/* ── TopBar ── */

async function TopBarV3({ empresa, empresaId, selectedDate }: { empresa: string; empresaId: string; selectedDate: string | null }) {
  const now = new Date();
  const fecha = now.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 h-12 flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8553E]" />
          </span>
          <h1 className="text-[12px] font-medium text-[var(--foreground)] truncate">{empresa}</h1>
        </div>
        <span className="ml-auto text-[10px] text-[var(--muted-light)]">{fecha}</span>
      </div>
    </header>
  );
}

/* ── Revisar Panel ── */

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

/* ── Boletas List ── */

async function BoletasListV3({ empresaId }: { empresaId: string }) {
  return <BoletasList empresaId={empresaId} />;
}

/* ── Empresa Tab (placeholder por ahora) ── */

async function EmpresaTabV3({ empresaId }: { empresaId: string }) {
  return (
    <div className="max-w-2xl mx-auto py-4 space-y-4 text-[11px] text-[var(--muted-light)]">
      <p className="text-sm font-medium text-[var(--foreground)]">Configuración de empresa</p>
      <p>Disponible en la página Empresa.</p>
      <a href="/empresa" className="inline-flex items-center gap-1 rounded-xl bg-[#E8553E] text-white px-4 py-2 text-xs font-semibold hover:bg-[var(--accent-hover)]">
        Ir a Empresa
      </a>
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1]}`;
}
