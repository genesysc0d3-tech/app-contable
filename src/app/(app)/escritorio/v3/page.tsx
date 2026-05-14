import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../../subir/SubirClient";
import RevisarClient from "../../revisar/RevisarClient";
import { Calendar as CalendarIcon, X } from "@phosphor-icons/react/dist/ssr";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import TabsV3 from "./TabsV3";
import DrawerToggle from "./DrawerToggle";

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

        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarStripV3 empresaId={empresaId} selectedDate={selectedDate} />
        </Suspense>

        <TabsV3
          subirContent={<SubirClient empresaId={empresaId} />}
          revisarContent={
            <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />}>
              <RevisarPanelV3 empresaId={empresaId} filterDate={selectedDate} />
            </Suspense>
          }
          emitirContent={<EmitirBoletaForm />}
          boletasContent={<BoletasListV3 empresaId={empresaId} />}
          empresaContent={
            <EmpresaContent empresaId={empresaId} />
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

/* Calendar strip */

async function CalendarStripV3({ empresaId, selectedDate }: { empresaId: string; selectedDate: string | null }) {
  const supabase = await createClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startMonth = new Date(year, month, 1).toISOString();
  const endMonth = new Date(year, month + 1, 1).toISOString();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const [{ data: propuestas }, { data: documentos }] = await Promise.all([
    supabase.from("propuestas_ia").select("created_at, estado").eq("empresa_id", empresaId).gte("created_at", startMonth).lt("created_at", endMonth),
    supabase.from("documentos_subidos").select("created_at").eq("empresa_id", empresaId).gte("created_at", startMonth).lt("created_at", endMonth),
  ]);

  const byDay = new Map<number, { p: number; a: number; d: number }>();
  for (let d = 1; d <= daysInMonth; d++) byDay.set(d, { p: 0, a: 0, d: 0 });
  for (const p of propuestas ?? []) { const day = new Date(p.created_at).getDate(); const info = byDay.get(day)!; if (p.estado === "pendiente") info.p++; else if (["aprobado", "editado"].includes(p.estado)) info.a++; }
  for (const d of documentos ?? []) { byDay.get(new Date(d.created_at).getDate())!.d++; }

  const today = now.getDate();
  const selDay = selectedDate ? (() => { const [y, m, d] = selectedDate.split("-").map(Number); return y === year && m === month + 1 ? d : null; })() : null;
  const wds = ["D", "L", "M", "M", "J", "V", "S"];

  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar bg-white/30 dark:bg-white/[0.02] rounded-xl px-3 py-1.5 border border-[var(--border)]">
      <CalendarIcon size={12} weight="bold" className="text-[var(--muted)] shrink-0 mr-1" />
      {selDay && (
        <Link href="/escritorio/v3" scroll={false}
          className="flex items-center gap-0.5 text-[9px] text-[var(--muted)] hover:text-[#E8553E] bg-[var(--surface)] hover:bg-[#E8553E]/10 rounded px-1.5 py-0.5 shrink-0 transition-colors">
          <X size={8} weight="bold" /> Todo
        </Link>
      )}
      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
        const info = byDay.get(day)!;
        const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isSel = day === selDay;
        const isToday = day === today;
        return (
          <Link key={day} href={`/escritorio/v3?date=${dayStr}`} scroll={false}
            className={`shrink-0 w-7 py-1 rounded-md flex flex-col items-center transition-all ${isSel ? "bg-[#E8553E] text-white" : isToday ? "ring-1 ring-inset ring-[#E8553E]/40" : "hover:bg-[var(--surface)]"}`}>
            <span className="text-[6px] uppercase leading-none text-[var(--muted-light)]">{wds[new Date(year, month, day).getDay()]}</span>
            <span className="text-[10px] font-medium tabular-nums leading-none">{day}</span>
          </Link>
        );
      })}
    </div>
  );
}

function CalendarSkeleton() {
  return <div className="h-[34px] bg-white/30 dark:bg-white/[0.02] rounded-xl border border-[var(--border)] animate-pulse" />;
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
