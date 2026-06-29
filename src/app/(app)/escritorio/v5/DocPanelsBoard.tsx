"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";

// Tablero de la parte de DOCUMENTOS del Check (debajo del visor, que no se toca).
// 3 paneles en layout fijo: IZQUIERDA = 1 panel a lo alto; DERECHA = 2 apilados.
// Cada panel tiene scroll propio y su TÍTULO es arrastrable: al soltarlo sobre otro
// panel, ambos intercambian lugar. El orden se persiste en localStorage (preferencia
// de UI del usuario, sin tocar la DB).
export interface DocPanel {
  id: string;
  titulo: string;
  count: number;
  render: () => ReactNode;
}

const LS_KEY = "massdte:check-panels-orden-v1";

export default function DocPanelsBoard({ panels }: { panels: DocPanel[] }) {
  const ids = panels.map((p) => p.id);
  // orden[slot] = panelId. slot 0 = izquierda, 1 = der-arriba, 2 = der-abajo.
  // Init con el orden dado (igual en server y cliente → sin hydration mismatch);
  // la preferencia guardada se carga en un effect tras montar.
  const [orden, setOrden] = useState<string[]>(ids);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (Array.isArray(saved) && saved.length === ids.length && ids.every((id) => saved.includes(id))) {
        setOrden(saved as string[]);
      }
    } catch { /* preferencia inválida: se ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("|")]);

  const save = (o: string[]) => {
    setOrden(o);
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* storage lleno/no disponible */ }
  };

  // Al soltar el título del panel en `fromSlot`, busca sobre qué slot quedó el puntero
  // e intercambia ambos paneles.
  const onDropTitle = (fromSlot: number, x: number, y: number) => {
    let toSlot = -1;
    slotRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) toSlot = i;
    });
    if (toSlot >= 0 && toSlot !== fromSlot) {
      const o = [...orden];
      [o[fromSlot], o[toSlot]] = [o[toSlot], o[fromSlot]];
      save(o);
    }
  };

  const panelFor = (slot: number): DocPanel | undefined => panels.find((p) => p.id === orden[slot]);

  const renderSlot = (slot: number): ReactNode => {
    const p = panelFor(slot);
    return (
      <div
        ref={(el) => { slotRefs.current[slot] = el; }}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg)" }}
      >
        <motion.div
          drag
          dragSnapToOrigin
          dragElastic={0.18}
          dragMomentum={false}
          onDragEnd={(_e, info) => onDropTitle(slot, info.point.x, info.point.y)}
          whileDrag={{ scale: 1.04, zIndex: 60, boxShadow: "0 12px 34px rgba(0,0,0,.28)", cursor: "grabbing", borderRadius: 8 }}
          title="Arrastrá el título para mover este panel a otra zona"
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-muted)", cursor: "grab", touchAction: "none", flexShrink: 0, userSelect: "none" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }} fill="currentColor">
            <circle cx="8" cy="6" r="1.6" /><circle cx="16" cy="6" r="1.6" />
            <circle cx="8" cy="12" r="1.6" /><circle cx="16" cy="12" r="1.6" />
            <circle cx="8" cy="18" r="1.6" /><circle cx="16" cy="18" r="1.6" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text2)" }}>{p?.titulo ?? "—"}</span>
          <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "var(--text3)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 7px" }}>{p?.count ?? 0}</span>
        </motion.div>
        <div className="r-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {p && p.count > 0
            ? p.render()
            : <div style={{ padding: "18px 12px", textAlign: "center", fontSize: 10, color: "var(--text3)" }}>Sin documentos.</div>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 8, padding: 8 }}>
      {/* IZQUIERDA: 1 panel a lo alto */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>{renderSlot(0)}</div>
      {/* DERECHA: 2 paneles apilados */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {renderSlot(1)}
        {renderSlot(2)}
      </div>
    </div>
  );
}
