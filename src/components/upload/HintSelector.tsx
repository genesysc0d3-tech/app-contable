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
    const top = openUp ? Math.max(MARGIN, r.top - MENU_H_EST - 8) : r.bottom + 8;
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
        className="btn-press"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "0 12px", height: 30, whiteSpace: "nowrap", flexShrink: 0, outline: "none", background: "transparent", cursor: "pointer", opacity: saving ? 0.5 : 1, transition: "color .15s, border-color .15s" }}
      >
        <Lightbulb size={12} weight="bold" color="#F59E0B" />
        <span>Tipo: <b style={{ color: "var(--foreground)" }}>{opcionActual.label}</b></span>
        <CaretDown size={10} weight="bold" style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            maxHeight: `calc(100vh - ${pos.top + 16}px)`,
            zIndex: 200, width: 288, borderRadius: 16, border: "1px solid var(--border)",
            overflowY: "auto", padding: 10,
          }}
          className="pop-menu animate-fade-in"
        >
          <div style={{ padding: "8px 12px 10px", fontSize: 9, fontWeight: 650, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--muted-light)" }}>
            Tipo de operaciones
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {OPCIONES.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => seleccionar(o.id)}
                className={`pop-item${o.id === value ? " activo" : ""}`}
                style={{ width: "100%", borderRadius: 12, border: "none", display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", textAlign: "left", cursor: "pointer", transition: "background .12s", color: "var(--foreground)" }}
              >
                <div style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0, color: "#E8553E" }}>
                  {o.id === value && <Check size={13} weight="bold" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 650, lineHeight: 1.25 }}>{o.label}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 10.5, lineHeight: 1.4, color: "var(--muted-light)" }}>{o.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
