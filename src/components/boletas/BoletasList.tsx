import { createClient } from "@/lib/supabase/server";
import { Receipt, FileText, ArrowRight } from "@phosphor-icons/react/dist/ssr";

interface BoletaRow {
  id: string;
  folio: number;
  tipo_dte: number;
  fecha_emision: string;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  monto_total: number;
  estado: string;
}

export default async function BoletasList({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();

  // The boletas_emitidas table may not exist yet (migration pending) and isn't
  // in the generated database.types yet. Use loose typing to bypass the static
  // check; query gracefully returns empty if table is missing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  let boletas: BoletaRow[] = [];
  try {
    const { data, error } = await sb
      .from("boletas_emitidas")
      .select("id, folio, tipo_dte, fecha_emision, receptor_rut, receptor_razon_social, monto_total, estado")
      .eq("empresa_id", empresaId)
      .order("fecha_emision", { ascending: false })
      .order("folio", { ascending: false })
      .limit(20);
    if (!error && data) boletas = data as BoletaRow[];
  } catch {
    /* table missing — show empty */
  }

  if (boletas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
        <div className="w-12 h-12 rounded-2xl neo-inset flex items-center justify-center text-[var(--muted)] mb-3">
          <Receipt size={20} weight="light" />
        </div>
        <p className="text-[13px] font-medium text-[var(--foreground)]">
          Aún no emitiste boletas
        </p>
        <p className="text-[11px] text-[var(--muted-light)] mt-1 max-w-[260px]">
          Andá a la pestaña <b>Emitir</b> para crear tu primera boleta de prueba.
          El sistema valida igual que el SII real.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <ul className="divide-y divide-[var(--border)]">
        {boletas.map((b) => {
          const isExenta = b.tipo_dte === 41;
          const isAnulada = b.estado === "anulada";
          return (
            <li
              key={b.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
                isAnulada ? "opacity-50" : ""
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--surface)] flex items-center justify-center text-[var(--muted)] shrink-0">
                <FileText size={14} weight="light" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-[var(--foreground)] tabular-nums">
                    #{b.folio}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                    isExenta
                      ? "bg-[#3B82F6]/10 text-[#3B82F6]"
                      : "bg-[var(--accent-light)] text-[#E8553E]"
                  }`}>
                    {isExenta ? "EXENTA" : "AFECTA"}
                  </span>
                  {isAnulada && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-[var(--surface)] text-[var(--muted)]">
                      ANULADA
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">
                  {b.receptor_razon_social || (b.receptor_rut ?? "Sin receptor")}
                  <span className="text-[var(--muted-light)] ml-1.5">· {formatFecha(b.fecha_emision)}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-medium tabular-nums text-[var(--foreground)]">
                  ${b.monto_total.toLocaleString("es-CL")}
                </p>
              </div>
              <ArrowRight size={12} weight="bold" className="text-[var(--muted-light)] shrink-0" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatFecha(d: string): string {
  const date = new Date(d + "T00:00:00");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${date.getDate()} ${meses[date.getMonth()]}`;
}
