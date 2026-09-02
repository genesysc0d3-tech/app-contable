"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Posicionamiento auto del menú: flip arriba si no entra abajo,
  // alinear derecha si no entra por el lado.
  function toggleMenu() {
    if (open) { setOpen(false); return; }
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const MENU_H_EST = 280; // estimado con 5 opciones + header + padding
    const MENU_W = 256; // w-64 = 256px
    const MARGIN = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < MENU_H_EST + MARGIN && spaceAbove > spaceBelow;

    let left = r.left;
    if (left + MENU_W + MARGIN > vw) {
      left = Math.max(MARGIN, vw - MENU_W - MARGIN);
    }
    const top = openUp ? Math.max(MARGIN, r.top - MENU_H_EST - 4) : r.bottom + 4;
    setPos({ top, left, openUp });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  async function seleccionar(h: Hint) {
    setOpen(false);
    if (h === value) return;
    setSaving(true);
    const prev = value;
    setValue(h);
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
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        disabled={saving}
        title="Tipo de operaciones en esta cartola — ayuda al clasificador a elegir afecta/exenta"
        className="btn-press flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50 border border-[var(--border)] rounded-full px-3 h-[30px] hover:border-[var(--muted)] whitespace-nowrap shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-[var(--muted)]"
      >
        <Lightbulb size={12} weight="bold" className="text-[#F59E0B]" />
        <span>Tipo: <b className="text-[var(--foreground)]">{opcionActual.label}</b></span>
        <CaretDown size={10} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            maxHeight: `calc(100vh - ${pos.top + 16}px)`,
          }}
          className="z-[200] w-64 rounded-xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] overflow-y-auto animate-fade-in py-1"
        >
          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Tipo de operaciones
          </div>
          {OPCIONES.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => seleccionar(o.id)}
              className={`w-[calc(100%-8px)] mx-1 rounded-lg flex items-start gap-2 px-2.5 py-2 text-left transition-colors ${
                o.id === value
                  ? "bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]"
                  : "hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]"
              }`}
            >
              <div className="w-3 h-3 mt-0.5 shrink-0 text-[#E8553E]">
                {o.id === value && <Check size={12} weight="bold" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold">{o.label}</p>
                <p className="text-[10px] text-[var(--muted-light)] mt-0.5">{o.desc}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
