import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../subir/SubirClient";
import RevisarClient from "../revisar/RevisarClient";
import { UploadSimple, CheckSquare } from "@phosphor-icons/react/dist/ssr";

export default async function EscritorioPage() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  const fecha = new Date().toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)]">
      <TopBar empresa={usuario.empresas.razon_social} fecha={fecha} />

      <main className="max-w-[1500px] mx-auto px-6 pb-10 pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-4 xl:col-span-3">
            <Panel
              icon={UploadSimple}
              label="Subir"
              hint="Cartolas y documentos"
            >
              <Suspense fallback={<ShimmerBox h="h-80" />}>
                <SubirClient empresaId={empresaId} />
              </Suspense>
            </Panel>
          </aside>

          <section className="lg:col-span-8 xl:col-span-9">
            <Panel
              icon={CheckSquare}
              label="Revisar"
              hint="Propuestas de la IA"
              spotlight
            >
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

// --- Chrome ---

function TopBar({ empresa, fecha }: { empresa: string; fecha: string }) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[var(--background)]/80 border-b border-[var(--border)]">
      <div className="max-w-[1500px] mx-auto px-6 h-14 flex items-center gap-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#E8553E] shrink-0" />
          <h1 className="text-[15px] font-semibold text-[var(--foreground)] truncate">
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
      className={`rounded-[20px] bg-white dark:bg-white/[0.03] border border-[var(--border)] overflow-hidden ${
        spotlight
          ? "shadow-[0_8px_32px_-12px_rgba(232,85,62,0.18)] dark:shadow-none"
          : "shadow-[var(--card-shadow)] dark:shadow-none"
      }`}
    >
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface)]/40 dark:bg-transparent">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            spotlight
              ? "bg-[var(--accent-light)] text-[#E8553E]"
              : "bg-[var(--surface)] text-[var(--muted)]"
          }`}
        >
          <Icon size={18} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-bold tracking-wide uppercase text-[var(--foreground)] leading-none">
            {label}
          </h2>
          <p className="text-[11px] text-[var(--muted-light)] mt-1 leading-none">
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
    />
  );
}
