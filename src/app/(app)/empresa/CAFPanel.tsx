import { Info } from "@phosphor-icons/react/dist/ssr";

export interface CAFRow {
  id: string;
  tipo_dte: number;
  folio_desde: number;
  folio_hasta: number;
  folio_actual: number;
  estado: string;
  fecha_vence: string;
}

const TIPOS: { tipo: 39 | 41 | 61; label: string; color: string }[] = [
  { tipo: 39, label: "Boleta afecta (39)", color: "text-[#E8553E]" },
  { tipo: 41, label: "Boleta exenta (41)", color: "text-[#3B82F6]" },
  { tipo: 61, label: "Nota de crédito (61)", color: "text-[#A855F7]" },
];

export default function CAFPanel({ cafs }: { cafs: CAFRow[] }) {
  function disponibles(tipo: number) {
    return cafs
      .filter((c) => c.tipo_dte === tipo && c.estado === "activo")
      .reduce((s, c) => s + Math.max(0, c.folio_hasta - c.folio_actual + 1), 0);
  }
  function emitidos(tipo: number) {
    return cafs
      .filter((c) => c.tipo_dte === tipo)
      .reduce((s, c) => s + Math.max(0, c.folio_actual - c.folio_desde), 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-black/5 dark:bg-white/5 text-xs text-[#888] dark:text-white/60">
        <Info size={14} weight="fill" className="shrink-0 mt-0.5" />
        <span className="leading-relaxed">
          El intermediario (mock) solicita CAFs al SII automáticamente cuando se agotan. No necesitás hacer nada — así funciona Haulmer real.
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {TIPOS.map(({ tipo, label, color }) => {
          const dispo = disponibles(tipo);
          const emit = emitidos(tipo);
          return (
            <div key={tipo} className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
              <div className={`text-[10px] font-bold ${color}`}>{label}</div>
              <div className="mt-2 text-xl font-bold tabular-nums">{dispo}</div>
              <div className="text-[10px] text-[#888] dark:text-white/60">disponibles</div>
              {emit > 0 && (
                <div className="text-[10px] text-[#888] dark:text-white/60 mt-1">· {emit} emitidos</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
