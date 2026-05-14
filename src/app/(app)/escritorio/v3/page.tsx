import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "../../revisar/RevisarClient";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import TabsV3 from "./TabsV3";
import DrawerToggle from "./DrawerToggle";
import CalendarYear from "./CalendarYear";
import EmitirTab from "./EmitirTab";
import { TabCard } from "./TabHelpers";

export default async function EscritorioV3Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam } = await searchParams;
  const selectedDate = dateParam === "all" ? null : (dateParam ?? todayStr());

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg flex flex-col">
      <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
        <div className="max-w-[1400px] mx-auto px-4 h-11 flex items-center gap-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8553E]" />
          </span>
          <span className="text-xs font-medium truncate">{usuario.empresas.razon_social}</span>
          <span className="ml-auto" />
          <DrawerToggle empresaId={empresaId} />
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto w-full px-4 py-3 flex flex-col gap-3">
        <Suspense fallback={<StatsSkeleton />}>
          <StatsRowFull empresaId={empresaId} />
        </Suspense>

        <CalendarYear empresaId={empresaId} />

        <TabsV3
          subirContent={
            <EmitirTab empresaId={empresaId} />
          }
          revisarContent={
            <TabCard>
              <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />}>
                <RevisarPanelV3 empresaId={empresaId} filterDate={selectedDate} />
              </Suspense>
            </TabCard>
          }
          emitirContent={
            <TabCard><EmitirBoletaForm /></TabCard>
          }
          boletasContent={
            <TabCard><BoletasListV3 empresaId={empresaId} /></TabCard>
          }
          empresaContent={
            <TabCard><EmpresaContent empresaId={empresaId} /></TabCard>
          }
        />
      </main>
    </div>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* Stats */

async function StatsRowFull({ empresaId }: { empresaId: string }) {
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
    <div className="flex items-center gap-4 sm:gap-6 bg-white/50 dark:bg-white/[0.03] rounded-xl px-4 py-2.5 border border-[var(--border)] text-xs overflow-x-auto no-scrollbar">
      <Stat value={pendientes.count ?? 0} label="pendientes" color="var(--foreground)" />
      <Divider />
      <Stat value={aprobadosMes.count ?? 0} label="aprobados" color="#22C55E" />
      <Divider />
      <Stat value={emitidosMes.count ?? 0} label="emitidos" color="#3B82F6" />
      <Divider />
      <Stat value={foliosRest} label="folios" color="#8B5CF6" />
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5 shrink-0">
      <span className="text-lg font-light tabular-nums" style={{ color }}>{value}</span>
      <span className="text-[var(--muted-light)]">{label}</span>
    </div>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-[var(--border)] shrink-0" />;
}

function StatsSkeleton() {
  return <div className="h-[42px] bg-white/30 dark:bg-white/[0.03] rounded-xl border border-[var(--border)] animate-pulse" />;
}

/* Revisar */

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

/* Empresa tab content */

async function EmpresaContent({ empresaId }: { empresaId: string }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="font-medium text-[var(--foreground)]">Configuración de empresa</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/empresa" className="inline-flex items-center gap-1.5 rounded-xl bg-[#E8553E] text-white px-4 py-2 text-xs font-semibold hover:bg-[var(--accent-hover)] transition-colors">
          Ir a Empresa
        </Link>
        <Link href="/clientes" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--border)] transition-colors">
          Gestionar clientes
        </Link>
      </div>
    </div>
  );
}
