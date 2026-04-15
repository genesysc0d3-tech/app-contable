import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../subir/SubirClient";
import RevisarClient from "../revisar/RevisarClient";
import { UploadSimple, CheckSquare, Lightning, TrendUp } from "@phosphor-icons/react/dist/ssr";

export default async function EscritorioPage() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg">
      <TopBar empresa={usuario.empresas.razon_social} />

      <main className="max-w-[1400px] mx-auto px-6 pb-16 relative">
        {/* Hero zone — storytelling de datos */}
        <Suspense fallback={<HeroSkeleton />}>
          <Hero empresaId={empresaId} empresa={usuario.empresas.razon_social} />
        </Suspense>

        {/* Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-16">
          <aside className="lg:col-span-5">
            <Panel icon={UploadSimple} label="Capturar" hint="Arrastrá una cartola o documento">
              <Suspense fallback={<ShimmerBox h="h-80" />}>
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

// --- Hero with data storytelling ---

async function Hero({ empresaId, empresa }: { empresaId: string; empresa: string }) {
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
    <section className="pt-20 pb-8 animate-number-in">
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="hero-label">{empresa}</p>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="hero-number">
              <span className="hero-number-int">{pend}</span>
            </span>
            <span className="text-[22px] font-light text-[var(--muted)] pb-3">
              {pend === 1 ? "propuesta esperando" : "propuestas esperando"}
            </span>
          </div>
          <p className="hero-subtitle mt-3 flex items-center gap-2 capitalize">
            <Lightning size={14} weight="fill" className="text-[#22C55E]" />
            <span>
              {apro} aprobada{apro !== 1 ? "s" : ""} en {mesNombre}
            </span>
            {apro > 0 && (
              <>
                <span className="text-[var(--muted-light)]">·</span>
                <TrendUp size={14} weight="bold" className="text-[#22C55E]" />
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <section className="pt-20 pb-8">
      <div className="animate-shimmer h-3 w-40 rounded-full" />
      <div className="animate-shimmer h-20 w-64 rounded-2xl mt-4" />
      <div className="animate-shimmer h-4 w-56 rounded-full mt-4" />
    </section>
  );
}

// --- TopBar ---

function TopBar({ empresa }: { empresa: string }) {
  const fecha = new Date().toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E8553E] shadow-[0_0_10px_rgba(232,85,62,0.7)]" />
          </span>
          <h1 className="text-[14px] font-medium text-[var(--muted)] truncate tracking-wide">
            {empresa}
          </h1>
        </div>
        <span className="text-xs text-[var(--muted-light)] capitalize ml-auto hidden sm:block">
          {fecha}
        </span>
      </div>
    </header>
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
      className={`neo tilt-3d rounded-[28px] overflow-hidden ${
        spotlight ? "breathe-glow" : ""
      }`}
    >
      <header className="flex items-center gap-4 px-7 py-5">
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-500 ${
            spotlight
              ? "bg-[#E8553E] text-white shadow-[0_6px_24px_-6px_rgba(232,85,62,0.6)]"
              : "neo-inset text-[var(--muted)]"
          }`}
        >
          <Icon size={20} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[20px] font-light tracking-tight text-[var(--foreground)] leading-none">
            {label}
          </h2>
          <p className="text-[12px] text-[var(--muted-light)] mt-2 leading-none">
            {hint}
          </p>
        </div>
      </header>
      <div className="escritorio-col px-2 pb-2">{children}</div>
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
