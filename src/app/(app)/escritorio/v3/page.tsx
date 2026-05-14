import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import SubirClient from "../../subir/SubirClient";
import RevisarClient from "../../revisar/RevisarClient";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import TabsV3 from "./TabsV3";

export default async function EscritorioV3Page() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  return (
    <div className="escritorio-root min-h-screen bg-[var(--background)] mesh-bg flex flex-col">
      <header className="sticky top-0 z-30 glass border-b border-[var(--glass-border)]">
        <div className="max-w-[1400px] mx-auto px-4 h-11 flex items-center">
          <span className="relative flex h-2 w-2 mr-2">
            <span className="absolute inset-0 rounded-full bg-[#E8553E] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8553E]" />
          </span>
          <span className="text-xs font-medium truncate">{usuario.empresas.razon_social}</span>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto w-full px-4 py-4">
        <Suspense fallback={<div className="h-10 animate-shimmer rounded-xl" />}>
          <StatsRow empresaId={empresaId} />
        </Suspense>

        <div className="mt-3">
          <TabsV3
            subirContent={<SubirClient empresaId={empresaId} />}
            revisarContent={
              <Suspense fallback={<div className="h-48 animate-shimmer rounded-xl" />}>
                <RevisarPanel empresaId={empresaId} />
              </Suspense>
            }
            emitirContent={<EmitirBoletaForm />}
            boletasContent={<BoletasList empresaId={empresaId} />}
          />
        </div>
      </main>
    </div>
  );
}

async function StatsRow({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { count } = await supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente");
  return (
    <div className="flex items-center gap-3 bg-white/50 dark:bg-white/[0.03] rounded-xl px-4 py-2.5 border border-[var(--border)]">
      <span className="text-lg font-light tabular-nums">{count ?? 0}</span>
      <span className="text-xs text-[var(--muted-light)]">pendientes</span>
    </div>
  );
}

async function RevisarPanel({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  return <RevisarClient propuestas={propuestas ?? []} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}
