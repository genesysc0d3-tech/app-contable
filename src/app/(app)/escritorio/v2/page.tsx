import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../../subir/SubirClient";
import RevisarClient from "../../revisar/RevisarClient";
import {
  UploadSimple, CheckSquare, Lightning, Calendar as CalendarIcon,
  Gear, Users, Buildings, X, Receipt, FileText
} from "@phosphor-icons/react/dist/ssr";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import DrawerToggle from "./DrawerToggle";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function EscritorioV2Page({
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
      {/* TopBar */}
      <Suspense fallback={null}>
        <TopBarV2 empresa={usuario.empresas.razon_social} empresaId={empresaId} />
      </Suspense>

      {/* Calendar strip compact */}
      <Suspense fallback={null}>
        <CalendarStripV2 empresaId={empresaId} selectedDate={selectedDate} />
      </Suspense>

      {/* 3-column workspace */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-3 sm:px-4 pt-3 pb-4 min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 h-full min-h-0">
          {/* Col 1: Subir */}
          <div className="md:col-span-3 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
            <SectionCard icon={UploadSimple} label="Emitir" hint="Cartolas y documentos">
              <div className="overflow-y-auto flex-1 px-3">
                <Suspense fallback={<div className="h-24 animate-shimmer rounded-xl" />}>
                  <SubirClient empresaId={empresaId} />
                </Suspense>
              </div>
            </SectionCard>
          </div>

          {/* Col 2: Revisar */}
          <div className="md:col-span-5 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
            <SectionCard icon={CheckSquare} label="Revisar" hint={selectedDate ? formatDateShort(selectedDate) : "Todas las fechas"} spotlight>
              <div className="overflow-y-auto flex-1 px-3">
                <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />} key={selectedDate ?? "all"}>
                  <RevisarPanelV2 empresaId={empresaId} filterDate={selectedDate} />
                </Suspense>
              </div>
            </SectionCard>
          </div>

          {/* Col 3: Emitir */}
          <div className="md:col-span-4 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
            <SectionCard icon={Lightning} label="Emitir" hint="Boletas electrónicas">
              <div className="overflow-y-auto flex-1 px-3 space-y-3">
                <EmitirBoletaForm />
                <div className="border-t border-[var(--border)] pt-3">
                  <Suspense fallback={<div className="h-16 animate-shimmer rounded-xl" />}>
                    <BoletasList empresaId={empresaId} />
                  </Suspense>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── TopBar ── */

async function TopBarV2({ empresa, empresaId }: { empresa: string; empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [pendientes, aprobadosMes] = await Promise.all([
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente"),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["aprobado", "editado"]).gte("created_at", startMonth),
  ]);

  const pend = pendientes.count ?? 0;
  const apro = aprobadosMes.count ?? 0;
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

        <span className="h-4 w-px bg-[var(--border)] shrink-0" />

        <div className="flex items-center gap-3 text-[11px]">
          <span className="tabular-nums font-medium">{pend}</span>
          <span className="text-[var(--muted-light)]">pend</span>
          {apro > 0 && <><span className="text-[var(--muted-light)] hidden sm:inline">·</span><span className="text-[#22C55E] hidden sm:inline">{apro} aprobados</span></>}
        </div>

        <span className="ml-auto text-[10px] text-[var(--muted-light)] hidden md:block">{fecha}</span>

        {/* Drawer toggles */}
        <DrawerToggle empresaId={empresaId} />
      </div>
    </header>
  );
}

/* ── Calendar strip (compact) ── */

async function CalendarStripV2({ empresaId, selectedDate }: { empresaId: string; selectedDate: string | null }) {
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
  for (const p of propuestas ?? []) {
    const day = new Date(p.created_at).getDate();
    const info = byDay.get(day)!;
    if (p.estado === "pendiente") info.p++;
    else if (["aprobado", "editado"].includes(p.estado)) info.a++;
  }
  for (const d of documentos ?? []) { const day = new Date(d.created_at).getDate(); byDay.get(day)!.d++; }

  const today = now.getDate();
  const selDay = selectedDate ? (() => { const [y, m, d] = selectedDate.split("-").map(Number); return y === year && m === month + 1 ? d : null; })() : null;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="max-w-[1400px] mx-auto w-full px-3 sm:px-4 pt-2">
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
        <div className="text-[9px] text-[var(--muted-light)] font-medium mr-1 shrink-0">
          {now.toLocaleDateString("es-CL", { month: "short" })}
        </div>
        {selDay && (
          <Link href="/escritorio/v2?date=all" scroll={false}
            className="flex items-center gap-0.5 text-[8px] text-[var(--muted)] hover:text-[#E8553E] bg-[var(--surface)] hover:bg-[#E8553E]/10 rounded px-1 py-0.5 shrink-0 transition-colors">
            <X size={8} weight="bold" /> Todo
          </Link>
        )}
        {days.map((day) => {
          const info = byDay.get(day)!;
          const isToday = day === today;
          const isSel = day === selDay;
          const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return (
            <Link key={day} href={`/escritorio/v2?date=${dayStr}`} scroll={false}
              className={`shrink-0 w-7 py-1 rounded-md flex flex-col items-center gap-0 transition-all ${isSel ? "bg-[#E8553E] text-white" : isToday ? "ring-1 ring-inset ring-[#E8553E]/40" : "hover:bg-[var(--surface)]"}`}>
              <span className="text-[7px] uppercase leading-none text-[var(--muted-light)]">{["D", "L", "M", "M", "J", "V", "S"][new Date(year, month, day).getDay()]}</span>
              <span className="text-[10px] font-medium tabular-nums leading-none">{day}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Revisar panel (server fetch) ── */

async function RevisarPanelV2({ empresaId, filterDate }: { empresaId: string; filterDate: string | null }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  const all = propuestas ?? [];
  const filtered = filterDate ? all.filter((p) => p.created_at?.startsWith(filterDate)) : all;
  return <RevisarClient propuestas={filtered} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}

/* ── Section wrapper card ── */

function SectionCard({ icon: Icon, label, hint, spotlight, children }: {
  icon: typeof UploadSimple; label: string; hint: string; spotlight?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`neo rounded-[20px] overflow-hidden flex flex-col flex-1 min-h-0 ${spotlight ? "is-spotlight" : ""}`}>
      <header className="flex items-center gap-2.5 px-3.5 py-2 border-b border-black/5 dark:border-white/5 shrink-0">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${spotlight ? "bg-[#E8553E] text-white" : "neo-inset text-[var(--muted)]"}`}>
          <Icon size={13} weight="bold" />
        </div>
        <h2 className="text-[12px] font-medium text-[var(--foreground)]">{label}</h2>
        <p className="text-[9px] text-[var(--muted-light)] ml-auto truncate">{hint}</p>
      </header>
      <div className="py-2 flex-1 min-h-0">{children}</div>
    </section>
  );
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1]}`;
}
