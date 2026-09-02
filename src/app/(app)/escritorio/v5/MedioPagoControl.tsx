"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";
import { setDocumentoMedioPago } from "@/app/(app)/subir/actions";
import { MEDIOS_PAGO_SII } from "@/lib/sii/medios-pago";
import { useToast } from "@/components/Toast";

/**
 * Método de pago para TODAS las boletas del documento (espejo de la glosa común).
 *
 * El SII lo exige en cada boleta. Sin esto, la app solo lo pedía en las de sobre
 * 135 UF y el resto salía como "Efectivo" (fallback del worker de la extensión):
 * en beta, 65 boletas de una cartola bancaria se emitieron como efectivo siendo
 * transferencias. En una cartola eso es incorrecto por definición — nada entra
 * en efectivo a una cuenta bancaria — así que ahí se sugiere Transferencia.
 *
 * El menú es un popover propio (mismo patrón que HintSelector): el <select>
 * nativo pintaba el menú del sistema y rompía la estética del editor.
 */
export default function MedioPagoControl({
  documentoId,
  esCartola,
  medioInicial,
}: {
  documentoId: string;
  /** Documento con movimientos bancarios: la plata llegó por el banco, no en mano. */
  esCartola: boolean;
  medioInicial: string | null;
}) {
  const { toast } = useToast();
  const sugerido = esCartola ? "Transferencia" : "";
  const [medio, setMedio] = useState<string>(medioInicial ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Sin elegir + cartola = la boleta saldría "Efectivo" siendo transferencia.
  const avisa = !medio && esCartola;

  function toggleMenu() {
    if (open) { setOpen(false); return; }
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const MENU_H_EST = 30 + (MEDIOS_PAGO_SII.length + 1) * 34;
    const MENU_W = 232;
    const MARGIN = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const openUp = vh - r.bottom < MENU_H_EST + MARGIN && r.top > vh - r.bottom;
    let left = r.left;
    if (left + MENU_W + MARGIN > vw) left = Math.max(MARGIN, vw - MENU_W - MARGIN);
    const top = openUp ? Math.max(MARGIN, r.top - MENU_H_EST - 4) : r.bottom + 4;
    setPos({ top, left });
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

  async function cambiar(valor: string) {
    setOpen(false);
    if (valor === medio) return;
    const previo = medio;
    setMedio(valor);
    setSaving(true);
    const res = await setDocumentoMedioPago(documentoId, valor || null);
    setSaving(false);
    if (res.error) {
      setMedio(previo);
      toast(`Error: ${res.error}`, "error");
      return;
    }
    toast(valor ? `Todas las boletas de este documento: ${valor}` : "Sin método de pago fijado");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 0, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: avisa ? "var(--amber)" : "var(--text3)", textTransform: "uppercase", letterSpacing: ".07em" }}>
        Pago
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Método de pago de todas las boletas de este documento"
        title="El SII pide el método de pago en cada boleta. Acá lo fijas para todas las de este documento."
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, height: 30, borderRadius: 999,
          border: `1px solid ${avisa ? "rgba(245,158,11,.4)" : "color-mix(in srgb, var(--text) 14%, transparent)"}`,
          background: avisa ? "rgba(245,158,11,.06)" : "color-mix(in srgb, var(--text) 4%, transparent)",
          color: medio ? "var(--text)" : avisa ? "var(--amber)" : "var(--text3)",
          padding: "0 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
          whiteSpace: "nowrap", flexShrink: 0, outline: "none",
        }}
      >
        {medio || (sugerido ? `Elegir (sugerido: ${sugerido})` : "Elegir…")}
        <CaretDown size={10} weight="bold" style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none", opacity: .7 }} />
      </button>
      {avisa && (
        <button
          type="button"
          onClick={() => cambiar(sugerido)}
          disabled={saving}
          style={{
            fontSize: 10.5, fontWeight: 800, padding: "6px 12px", borderRadius: 99,
            border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.1)",
            color: "var(--green)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, outline: "none",
          }}
        >
          Usar {sugerido}
        </button>
      )}
      {avisa && (
        <span
          title="Es una cartola bancaria: sin elegir, las boletas salen como Efectivo."
          style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1, maxWidth: 170 }}
        >
          Es una cartola bancaria: sin elegir, las boletas salen como <b>Efectivo</b>.
        </span>
      )}

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Método de pago"
          style={{ position: "fixed", top: pos.top, left: pos.left, maxHeight: `calc(100vh - ${pos.top + 16}px)` }}
          className="z-[200] w-[232px] rounded-xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] overflow-y-auto animate-fade-in py-1"
        >
          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Método de pago
          </div>
          <button
            type="button"
            role="option"
            aria-selected={!medio}
            onClick={() => cambiar("")}
            className={`w-[calc(100%-8px)] mx-1 rounded-lg flex items-center gap-2 px-2.5 py-2 text-left transition-colors ${!medio ? "bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]"}`}
          >
            <div className="w-3 h-3 shrink-0 text-[#E8553E]">{!medio && <Check size={12} weight="bold" />}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold">Sin elegir</p>
              {esCartola && <p className="text-[10px] text-[var(--muted-light)] mt-0.5">Las boletas saldrían como Efectivo</p>}
            </div>
          </button>
          {MEDIOS_PAGO_SII.map((m) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === medio}
              onClick={() => cambiar(m)}
              className={`w-[calc(100%-8px)] mx-1 rounded-lg flex items-center gap-2 px-2.5 py-2 text-left transition-colors ${m === medio ? "bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]"}`}
            >
              <div className="w-3 h-3 shrink-0 text-[#E8553E]">{m === medio && <Check size={12} weight="bold" />}</div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <p className="text-[11px] font-semibold">{m}</p>
                {m === sugerido && !medio && (
                  <span className="text-[9px] font-bold text-[var(--green,#22c55e)] border border-[rgba(34,197,94,.35)] rounded-full px-1.5 py-px">sugerido</span>
                )}
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
