import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../subir/SubirClient";
import RevisarClient from "../revisar/RevisarClient";
import { UploadSimple, CheckSquare, Lightning, Receipt, Plus, Calendar as CalendarIcon, X } from "@phosphor-icons/react/dist/ssr";
import CapturarBoletasTabs from "@/components/CapturarBoletasTabs";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function EscritorioPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam } = await searchParams;
  // Default: today. Special value "all" removes the filter.
  const selectedDate = dateParam === "all" ? null : (dateParam ?? todayStr());

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg">
      <Suspense
        fallback={<TopBarShell empresa={usuario.empresas.razon_social} />}
      >
        <TopBar empresa={usuario.empresas.razon_social} empresaId={empresaId} />
      </Suspense>

      <main className="max-w-[1400px] mx-auto px-6 pt-10 pb-16 relative">
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-8">
          {/* Left: Capturar + Boletas emitidas (como tabs en el mismo card) */}
          <aside className="lg:col-span-3">
            <CapturarBoletasTabs boletasContent={<BoletasPanel />}>
              <Suspense fallback={<ShimmerBox h="h-72" />}>
                <SubirClient empresaId={empresaId} />
              </Suspense>
            </CapturarBoletasTabs>
          </aside>

          {/* Right: Calendar strip + Revisar */}
          <section className="lg:col-span-7 flex flex-col gap-6">
            <Suspense fallback={<CalendarSkeleton />}>
              <CalendarStrip empresaId={empresaId} selectedDate={selectedDate} />
            </Suspense>

            <Panel
              icon={CheckSquare}
              label="Revisar"
              hint={selectedDate ? `Del ${formatDateShort(selectedDate)}` : "Todas las fechas"}
              spotlight
            >
              <Suspense fallback={<ShimmerBox h="h-[28rem]" />} key={selectedDate ?? "all"}>
                <RevisarPanel empresaId={empresaId} filterDate={selectedDate} />
              </Suspense>
            </Panel>
          </section>
        </div>
      </main>
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x));
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[m - 1]} ${y}`;
}

// --- Calendar strip ---

async function CalendarStrip({ empresaId, selectedDate }: { empresaId: string; selectedDate: string | null }) {
  const supabase = await createClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startMonth = new Date(year, month, 1).toISOString();
  const endMonth = new Date(year, month + 1, 1).toISOString();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const [propuestas, documentos] = await Promise.all([
    supabase
      .from("propuestas_ia")
      .select("created_at, estado")
      .eq("empresa_id", empresaId)
      .gte("created_at", startMonth)
      .lt("created_at", endMonth),
    supabase
      .from("documentos_subidos")
      .select("created_at")
      .eq("empresa_id", empresaId)
      .gte("created_at", startMonth)
      .lt("created_at", endMonth),
  ]);

  type DayInfo = { pendientes: number; aprobadas: number; docs: number };
  const byDay = new Map<number, DayInfo>();
  for (let d = 1; d <= daysInMonth; d++) byDay.set(d, { pendientes: 0, aprobadas: 0, docs: 0 });

  for (const p of propuestas.data ?? []) {
    const day = new Date(p.created_at).getDate();
    const info = byDay.get(day)!;
    if (p.estado === "pendiente") info.pendientes++;
    else if (p.estado === "aprobado" || p.estado === "editado") info.aprobadas++;
  }
  for (const d of documentos.data ?? []) {
    const day = new Date(d.created_at).getDate();
    byDay.get(day)!.docs++;
  }

  const today = now.getDate();
  const mesNombre = now.toLocaleDateString("es-CL", { month: "long" });
  const totalPend = Array.from(byDay.values()).reduce((s, d) => s + d.pendientes, 0);
  const totalDocs = Array.from(byDay.values()).reduce((s, d) => s + d.docs, 0);
  const weekdayInitials = ["D", "L", "M", "M", "J", "V", "S"];

  // Parse selectedDate into day-of-month if within current month
  let selectedDay: number | null = null;
  if (selectedDate) {
    const [sy, sm, sd] = selectedDate.split("-").map((x) => parseInt(x));
    if (sy === year && sm === month + 1) selectedDay = sd;
  }

  return (
    <section className="neo rounded-[28px] overflow-hidden panel-hover-glow">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-black/5 dark:border-white/5">
        <div className="w-9 h-9 rounded-xl neo-inset flex items-center justify-center text-[var(--muted)]">
          <CalendarIcon size={16} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-medium text-[var(--foreground)] leading-none capitalize">
            {mesNombre} {year}
          </h2>
          <p className="text-[11px] text-[var(--muted-light)] mt-1 leading-none tracking-wide flex items-center gap-2">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#E8553E]" />{totalPend} pend.</span>
            <span className="text-[var(--muted-light)]">·</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />{totalDocs} subidos</span>
          </p>
        </div>
        {selectedDate && (
          <Link
            href="/escritorio?date=all"
            prefetch={false}
            scroll={false}
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--muted)] hover:text-[var(--foreground)] bg-[var(--surface)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] rounded-lg px-2 py-1 transition-colors"
          >
            <X size={10} weight="bold" />
            Ver todas
          </Link>
        )}
      </header>
      <div className="px-4 py-3 overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const info = byDay.get(day)!;
            const weekday = new Date(year, month, day).getDay();
            const isToday = day === today;
            const isSelected = day === selectedDay;
            const isWeekend = weekday === 0 || weekday === 6;
            const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            return (
              <Link
                key={day}
                href={`/escritorio?date=${dayStr}`}
                prefetch={false}
                scroll={false}
                className={`shrink-0 w-10 py-2 px-1 rounded-xl flex flex-col items-center gap-1 transition-all ${
                  isSelected
                    ? "bg-[#E8553E] text-white shadow-[0_0_14px_-4px_rgba(232,85,62,0.5)]"
                    : isToday
                    ? "ring-1 ring-inset ring-[#E8553E]/50 text-[var(--foreground)] hover:bg-[var(--accent-light)]"
                    : isWeekend
                    ? "text-[var(--muted-light)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    : "text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
                title={`${day} ${mesNombre} · ${info.pendientes} pend · ${info.docs} subidos`}
              >
                <span className={`text-[9px] uppercase tracking-wider ${isSelected ? "text-white/70" : "text-[var(--muted-light)]"}`}>
                  {weekdayInitials[weekday]}
                </span>
                <span className="text-[13px] font-medium tabular-nums leading-none">{day}</span>
                <div className="flex items-center gap-0.5 h-1.5">
                  {info.pendientes > 0 && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white" : "bg-[#E8553E]"}`} />}
                  {info.docs > 0 && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/80" : "bg-[#3B82F6]"}`} />}
                  {info.aprobadas > 0 && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/70" : "bg-[#22C55E]"}`} />}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CalendarSkeleton() {
  return (
    <section className="neo rounded-[28px] p-4">
      <div className="animate-shimmer h-4 w-32 rounded mb-3" />
      <div className="animate-shimmer h-16 rounded-xl" />
    </section>
  );
}

// --- TopBar with inline hero stats ---

function TopBarShell({ empresa, children }: { empresa: string; children?: React.ReactNode }) {
  const fecha = new Date().toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center gap-5">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E8553E] shadow-[0_0_10px_rgba(232,85,62,0.7)]" />
          </span>
          <h1 className="text-[14px] font-medium text-[var(--foreground)] truncate tracking-wide">
            {empresa}
          </h1>
        </div>
        {children}
        <span className="text-xs text-[var(--muted-light)] capitalize ml-auto hidden md:block shrink-0 pr-[92px]">
          {fecha}
        </span>
      </div>
    </header>
  );
}

async function TopBar({ empresa, empresaId }: { empresa: string; empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [pendientes, aprobadosMes] = await Promise.all([
    supabase
      .from("propuestas_ia")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("estado", "pendiente"),
    supabase
      .from("propuestas_ia")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .in("estado", ["aprobado", "editado"])
      .gte("created_at", startMonth),
  ]);

  const pend = pendientes.count ?? 0;
  const apro = aprobadosMes.count ?? 0;
  const mesNombre = now.toLocaleDateString("es-CL", { month: "long" });

  return (
    <TopBarShell empresa={empresa}>
      {/* Divider */}
      <span className="h-6 w-px bg-[var(--border)] shrink-0 hidden sm:block" />

      {/* Inline hero stats */}
      <div className="flex items-center gap-4 min-w-0 animate-number-in">
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="text-[22px] font-light tabular-nums text-[var(--foreground)] leading-none">
            {pend}
          </span>
          <span className="text-[11px] text-[var(--muted)] tracking-wide">
            {pend === 1 ? "esperando" : "esperando"}
          </span>
        </div>
        <span className="text-[var(--muted-light)] hidden sm:inline">·</span>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hidden sm:flex min-w-0">
          <Lightning size={11} weight="fill" className="text-[#22C55E] shrink-0" />
          <span className="truncate">
            {apro} aprobada{apro !== 1 ? "s" : ""} en <span className="capitalize">{mesNombre}</span>
          </span>
        </div>
      </div>
    </TopBarShell>
  );
}

// --- Panel with neumorphism + 3D tilt + idle breathing glow on spotlight ---

function Panel({
  icon: Icon,
  label,
  hint,
  spotlight,
  maxHeight,
  children,
}: {
  icon: typeof UploadSimple;
  label: string;
  hint: string;
  spotlight?: boolean;
  maxHeight?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`neo rounded-[28px] overflow-hidden relative panel-hover-glow flex flex-col ${spotlight ? "is-spotlight" : ""}`}
    >
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-black/5 dark:border-white/5 shrink-0">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-500 ${
            spotlight
              ? "bg-[#E8553E] text-white shadow-[0_6px_24px_-6px_rgba(232,85,62,0.6)]"
              : "neo-inset text-[var(--muted)]"
          }`}
        >
          <Icon size={16} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-medium tracking-tight text-[var(--foreground)] leading-none">
            {label}
          </h2>
          <p className="text-[11px] text-[var(--muted-light)] mt-1 leading-none tracking-wide">
            {hint}
          </p>
        </div>
      </header>
      <div
        className="escritorio-col pb-3 flex-1 min-h-0"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        {children}
      </div>
    </section>
  );
}

function BoletasPanel() {
  return (
    <div className="flex items-center gap-4 p-5">
      <div className="w-12 h-12 rounded-2xl neo-inset flex items-center justify-center text-[var(--muted)] shrink-0">
        <Receipt size={20} weight="light" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--foreground)] leading-tight">
          Aún no emitiste boletas
        </p>
        <p className="text-[11px] text-[var(--muted-light)] mt-1">
          Conectá tu cuenta SII para empezar (modo prueba disponible)
        </p>
      </div>
      <button
        type="button"
        disabled
        className="btn-press flex items-center gap-1.5 rounded-xl bg-[#E8553E]/90 text-white px-3 py-2 text-[12px] font-semibold opacity-60 cursor-not-allowed shrink-0"
        title="Próximamente"
      >
        <Plus size={14} weight="bold" />
        Emitir
      </button>
    </div>
  );
}

function ShimmerBox({ h }: { h: string }) {
  return <div className={`m-4 animate-shimmer ${h} rounded-xl`} />;
}

// --- Data fetchers ---

async function RevisarPanel({ empresaId, filterDate }: { empresaId: string; filterDate: string | null }) {
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

  // Filter by document upload date when a date is selected.
  // filterDate format: YYYY-MM-DD; doc.created_at is ISO with time, so prefix match works.
  const all = propuestas ?? [];
  const filtered = filterDate
    ? all.filter((p) => {
        const docCreated = p.movimientos_raw?.documentos_subidos?.created_at;
        if (!docCreated) return false;
        return docCreated.startsWith(filterDate);
      })
    : all;

  return (
    <RevisarClient
      propuestas={filtered}
      clientes={clientes ?? []}
      empresaId={empresaId}
      layout="desktop"
    />
  );
}
