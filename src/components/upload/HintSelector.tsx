"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, Check, Lightbulb } from "@phosphor-icons/react";
import { setDocumentoHint } from "@/app/(app)/subir/actions";
import { useToast } from "@/components/Toast";

type Hint = "p2p_cripto" | "forex_divisas" | "servicios" | "ventas" | "mixto";

const OPCIONES: { id: Hint; label: string; desc: string }[] = [
  { id: "mixto", label: "Mixto / Auto", desc: "El clasificador decide por glosa" },
  { id: "p2p_cripto", label: "P2P cripto", desc: "USDT, BTC, exchange — sin IVA" },
  { id: "forex_divisas", label: "Forex / divisas", desc: "Compra/venta de monedas — sin IVA" },
  { id: "servicios", label: "Servicios", desc: "Consultoría, asesoría — afecta IVA" },
  { id: "ventas", label: "Ventas", desc: "Venta de bienes — afecta IVA" },
];

export default function HintSelector({
  documentoId,
  current,
}: {
  documentoId: string;
  current: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<Hint>((current as Hint) ?? "mixto");
  const ref = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function seleccionar(h: Hint) {
    setOpen(false);
    if (h === value) return;
    setSaving(true);
    const prev = value;
    setValue(h); // optimistic
    const res = await setDocumentoHint(documentoId, h === "mixto" ? null : h);
    if (res.error) {
      setValue(prev);
      toast(`Error: ${res.error}`, "error");
    } else {
      const label = OPCIONES.find((o) => o.id === h)?.label ?? h;
      toast(`Tipo guardado: ${label}`);
    }
    setSaving(false);
  }

  const opcionActual = OPCIONES.find((o) => o.id === value) ?? OPCIONES[0]!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        title="Tipo de operaciones en esta cartola — ayuda al clasificador a elegir afecta/exenta"
        className="btn-press flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
      >
        <Lightbulb size={10} weight="bold" className="text-[#F59E0B]" />
        <span>Tipo: <b className="text-[var(--foreground)]">{opcionActual.label}</b></span>
        <CaretDown size={8} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-40 top-full mt-1 left-0 w-64 rounded-xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden animate-fade-in py-1">
          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Tipo de operaciones
          </div>
          {OPCIONES.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => seleccionar(o.id)}
              className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                o.id === value
                  ? "bg-[var(--accent-light)] text-[#E8553E]"
                  : "hover:bg-[var(--surface)]"
              }`}
            >
              <div className="w-3 h-3 mt-0.5 shrink-0">
                {o.id === value && <Check size={12} weight="bold" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold">{o.label}</p>
                <p className="text-[10px] text-[var(--muted-light)] mt-0.5">{o.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
