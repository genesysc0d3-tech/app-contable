import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../subir/SubirClient";
import RevisarClient from "../revisar/RevisarClient";
import { UploadSimple, CheckSquare, Lightning } from "@phosphor-icons/react/dist/ssr";

export default async function EscritorioPage() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg">
      <Suspense
        fallback={<TopBarShell empresa={usuario.empresas.razon_social} />}
      >
        <TopBar empresa={usuario.empresas.razon_social} empresaId={empresaId} />
      </Suspense>

      <main className="max-w-[1400px] mx-auto px-6 pt-10 pb-16 relative">
        {/* Panels — Revisar protagonista (7/10), Capturar compacto (3/10) */}
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-8">
          <aside className="lg:col-span-3">
            <Panel icon={UploadSimple} label="Capturar" hint="Arrastrá una cartola">
              <Suspense fallback={<ShimmerBox h="h-72" />}>
                <SubirClient empresaId={empresaId} />
              </Suspense>
            </Panel>
          </aside>

          <section className="lg:col-span-7">
            <Panel icon={CheckSquare} label="Revisar" hint="Propuestas esperando tu aprobación" spotlight>
              <Suspense fallback={<ShimmerBox h="h-[32rem]" />}>
                <RevisarPanel empresaId={empresaId} />
              </Suspense>
            </Panel>
          </section>
        </div>
      </main>
    </div>
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
  children,
}: {
  icon: typeof UploadSimple;
  label: string;
  hint: string;
  spotlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`neo rounded-[28px] overflow-hidden relative panel-hover-glow ${spotlight ? "is-spotlight" : ""}`}
    >
      <header className="flex items-center gap-4 px-6 py-5 border-b border-black/5 dark:border-white/5">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500 ${
            spotlight
              ? "bg-[#E8553E] text-white shadow-[0_6px_24px_-6px_rgba(232,85,62,0.6)]"
              : "neo-inset text-[var(--muted)]"
          }`}
        >
          <Icon size={18} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-light tracking-tight text-[var(--foreground)] leading-none">
            {label}
          </h2>
          <p className="text-[11px] text-[var(--muted-light)] mt-1.5 leading-none tracking-wide">
            {hint}
          </p>
        </div>
      </header>
      <div className="escritorio-col">{children}</div>
    </section>
  );
}

function ShimmerBox({ h }: { h: string }) {
  return <div className={`m-4 animate-shimmer ${h} rounded-xl`} />;
}

// --- Data fetchers ---

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
      layout="desktop"
    />
  );
}
