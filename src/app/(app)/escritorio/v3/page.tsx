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
import { GoldIcon, PlainIcon } from "./NavIcons";
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
    <div className="min-h-screen flex flex-col" style={{ background: "#141416" }}>
      <header className="sticky top-0 z-30" style={{ background: "#111113", borderBottom: "1px solid #38383a" }}>
        <div className="max-w-[1400px] mx-auto px-4 h-12 flex items-center gap-3">
          <GoldIcon />
          <span className="text-xs font-medium truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{usuario.empresas.razon_social}</span>
          <span className="flex items-center gap-1 ml-auto">
            <PlainIcon title="Señal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 20h2"/><path d="M6 20h2"/><path d="M10 20h2"/><path d="M14 20h2"/><path d="M18 20h2"/><path d="M22 20h2"/><path d="M4 16l2-2"/><path d="M8 12l2-2"/><path d="M12 8l2-2"/><path d="M16 4l2-2"/></svg></PlainIcon>
            <PlainIcon title="Capas"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 22 8.5 12 15 2 8.5"/><polyline points="2 15 12 21.5 22 15"/><polyline points="2 10 12 16.5 22 10"/></svg></PlainIcon>
            <PlainIcon title="Billetera"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></PlainIcon>
          </span>
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
    <div className="flex items-center gap-5 overflow-x-auto no-scrollbar text-xs"
      style={{ background: "#1c1c1e", borderRadius: 16, border: "1px solid #38383a", padding: "12px 18px" }}>
      <Stat value={pendientes.count ?? 0} label="pendientes" color="#fff" />
      <Divider />
      <Stat value={aprobadosMes.count ?? 0} label="aprobados" color="#c8f135" />
      <Divider />
      <Stat value={emitidosMes.count ?? 0} label="emitidos" color="#38bdf8" />
      <Divider />
      <Stat value={foliosRest} label="folios" color="#9c6fe4" />
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
