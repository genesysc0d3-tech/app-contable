"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";

// Tablero de la parte de DOCUMENTOS del Check (debajo del visor, que no se toca).
// 3 zonas en layout fijo: IZQUIERDA = 1 a lo alto; DERECHA = 2 apiladas. Mismo look
// VIEJO (el árbol de DocCardList con sus separaciones) — SIN cajas/cards: solo líneas
// finas de separación para no perder espacio. Cada zona tiene scroll propio y un título
// MÍNIMO arrastrable: al soltarlo sobre otra zona, ambas intercambian lugar. El orden se
// persiste en localStorage (preferencia de UI del usuario, sin tocar la DB).
export interface DocPanel {
  id: string;
  titulo: string;
  sub?: string;
  count: number;
  render: () => ReactNode;
}

const LS_KEY = "massdte:check-panels-orden-v1";

export default function DocPanelsBoard({ panels }: { panels: DocPanel[] }) {
  const ids = panels.map((p) => p.id);
  // orden[slot] = panelId. slot 0 = izquierda, 1 = der-arriba, 2 = der-abajo.
  // Init con el orden dado (igual server y cliente → sin hydration mismatch); la
  // preferencia guardada se carga en un effect tras montar.
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
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* storage no disponible */ }
  };

  // Al soltar el título de la zona `fromSlot`, busca sobre qué zona quedó el puntero e
  // intercambia ambas.
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

  // Tinte de fondo sutil por ORIGEN, para distinguir los paneles de un vistazo (sigue al
  // panel aunque se reordene). Telegram azul · massDTE rojo · Boleta única verde.
  const TINTS: Record<string, string> = {
    telegram: "rgba(91,156,246,0.035)",
    massdte: "rgba(232,85,62,0.035)",
    boleta: "rgba(34,197,94,0.035)",
  };
  const tintFor = (slot: number): string => TINTS[panelFor(slot)?.id ?? ""] ?? "transparent";

  // Contenido de una zona: título mínimo arrastrable (separación fina abajo) + árbol con scroll.
  const renderSlot = (slot: number): ReactNode => {
    const p = panelFor(slot);
    return (
      <>
        <motion.div
          drag
          dragSnapToOrigin
          dragElastic={0.15}
          dragMomentum={false}
          onDragEnd={(_e, info) => onDropTitle(slot, info.point.x, info.point.y)}
          whileDrag={{ scale: 1.05, zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,.25)", borderRadius: 6, cursor: "grabbing", background: "var(--bg-muted)" }}
          title="Arrastrá el título para mover este panel a otra zona"
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", cursor: "grab", touchAction: "none", flexShrink: 0, userSelect: "none", borderBottom: "1px solid var(--bg-muted)" }}
        >
          <svg width="8" height="11" viewBox="0 0 8 11" style={{ flexShrink: 0, opacity: 0.4 }} fill="currentColor">
            <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="5.5" r="1" /><circle cx="6" cy="5.5" r="1" />
            <circle cx="2" cy="9" r="1" /><circle cx="6" cy="9" r="1" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: "var(--text)" }}>{p?.titulo ?? "—"}</span>
          {p?.sub && <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 600 }}>{p.sub}</span>}
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text3)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p?.count ?? 0}</span>
        </motion.div>
        <div className="r-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {p && p.count > 0
            ? p.render()
            : <div style={{ padding: "12px 10px", fontSize: 9.5, color: "var(--text3)" }}>Sin documentos.</div>}
        </div>
      </>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      {/* IZQUIERDA: 1 zona, separación fina a la derecha */}
      <div ref={(el) => { slotRefs.current[0] = el; }} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", background: tintFor(0) }}>
        {renderSlot(0)}
      </div>
      {/* DERECHA: 2 zonas apiladas, separación fina entre ellas */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div ref={(el) => { slotRefs.current[1] = el; }} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border)", background: tintFor(1) }}>
          {renderSlot(1)}
        </div>
        <div ref={(el) => { slotRefs.current[2] = el; }} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: tintFor(2) }}>
          {renderSlot(2)}
        </div>
      </div>
    </div>
  );
}
