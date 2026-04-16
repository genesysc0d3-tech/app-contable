"use client";

import { useState, useTransition } from "react";
import { solicitarCAFMock } from "./actions";
import { useToast } from "@/components/Toast";
import { useRouter } from "next/navigation";

export interface CAFRow {
  id: string;
  tipo_dte: number;
  folio_desde: number;
  folio_hasta: number;
  folio_actual: number;
  estado: string;
  fecha_vence: string;
}

const TIPOS: { tipo: 39 | 41 | 61; label: string; descripcion: string; color: string }[] = [
  { tipo: 39, label: "Boleta afecta (39)", descripcion: "Con IVA — servicios, ventas", color: "bg-[#E8553E]" },
  { tipo: 41, label: "Boleta exenta (41)", descripcion: "Sin IVA — cripto, forex, educación", color: "bg-[#3B82F6]" },
  { tipo: 61, label: "Nota de crédito (61)", descripcion: "Anulación de boleta", color: "bg-[#A855F7]" },
];

export default function CAFPanel({ cafs }: { cafs: CAFRow[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cantidades, setCantidades] = useState<Record<number, string>>({ 39: "50", 41: "50", 61: "10" });

  function disponibles(tipo: number) {
    return cafs
      .filter((c) => c.tipo_dte === tipo && c.estado === "activo")
      .reduce((s, c) => s + (c.folio_hasta - c.folio_actual + 1), 0);
  }

  function solicitar(tipo: 39 | 41 | 61) {
    const n = Number.parseInt(cantidades[tipo] ?? "0", 10);
    if (!Number.isInteger(n) || n < 10 || n > 1000) {
      toast("Cantidad: entre 10 y 1000", "error");
      return;
    }
    start(async () => {
      const r = await solicitarCAFMock(tipo, n);
      if (r.error) toast(r.error, "error");
      else {
        toast(`CAF asignado: folios ${r.folio_desde}–${r.folio_hasta}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {TIPOS.map(({ tipo, label, descripcion, color }) => {
        const dispo = disponibles(tipo);
        return (
          <div key={tipo} className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${color}`}>
                    {tipo}
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                </div>
                <p className="text-xs text-[#888] dark:text-white/60 mt-0.5">{descripcion}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold tabular-nums">{dispo}</div>
                <div className="text-[10px] text-[#888] dark:text-white/60">folios disponibles</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={1000}
                value={cantidades[tipo] ?? ""}
                onChange={(e) => setCantidades((c) => ({ ...c, [tipo]: e.target.value }))}
                className="w-20 px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm tabular-nums"
              />
              <button
                onClick={() => solicitar(tipo)}
                disabled={pending}
                className="btn-press flex-1 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 text-sm font-medium disabled:opacity-50"
              >
                {pending ? "Solicitando…" : "Solicitar CAF (mock)"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
