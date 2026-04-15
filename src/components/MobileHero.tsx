import { createClient } from "@/lib/supabase/server";
import { Lightning, TrendUp } from "@phosphor-icons/react/dist/ssr";

interface MobileHeroProps {
  empresaId: string;
  empresa: string;
}

export default async function MobileHero({ empresaId, empresa }: MobileHeroProps) {
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
    <section className="px-5 pt-10 pb-6 animate-number-in">
      <p className="hero-label text-[10px]">{empresa}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="hero-number"
          style={{ fontSize: "clamp(44px, 14vw, 72px)" }}
        >
          <span className="hero-number-int">{pend}</span>
        </span>
        <span className="text-[14px] font-light text-[var(--muted)] pb-2 leading-tight">
          {pend === 1 ? "propuesta esperando" : "propuestas esperando"}
        </span>
      </div>
      <p className="hero-subtitle mt-2 flex items-center gap-1.5 text-[12px] capitalize">
        <Lightning size={12} weight="fill" className="text-[#22C55E]" />
        <span>
          {apro} aprobada{apro !== 1 ? "s" : ""} en {mesNombre}
        </span>
        {apro > 0 && <TrendUp size={12} weight="bold" className="text-[#22C55E]" />}
      </p>
    </section>
  );
}
