"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";

const ICON_VENTAS = "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";
const ICON_ACT = "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z";
const CHEVRON = "M9 18l6-6-6-6";

type Props = {
  esRcvExento: boolean;
  ventasDocs: number;
  ventasTotal: number;
  actividadCount: number;
  actividadUltimo?: string | null;
  periodo: string;
};

const appear = { type: "tween" as const, duration: 0.22, ease: "easeOut" as const };

export default function RegistrosCard({
  esRcvExento, ventasDocs, ventasTotal, actividadCount, actividadUltimo, periodo,
}: Props) {
  const [active, setActive] = useState<"ventas" | "actividad">("ventas");
  // Números del rango: inicializan con el SSR y se actualizan en vivo cuando el
  // calendario maestro cambia de período (evento "mesa-updated" del MesaController).
  const [vDocs, setVDocs] = useState(ventasDocs);
  const [vTotal, setVTotal] = useState(ventasTotal);
  const [aCount, setACount] = useState(actividadCount);
  const [aUlt, setAUlt] = useState<string | null>(actividadUltimo ?? null);
  const [per, setPer] = useState(periodo);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      setVDocs(d.ventasDocs); setVTotal(d.ventasTotal); setACount(d.actividadCount);
      setAUlt(d.actividadUltimo ?? null); setPer(d.periodo);
    };
    window.addEventListener("mesa-updated", h);
    return () => window.removeEventListener("mesa-updated", h);
  }, []);

  const open = (d: string) => window.dispatchEvent(new CustomEvent("switch-view", { detail: d }));
  const fmtCLP = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

  const ventasSub = `${per} · ${vDocs} ${vDocs === 1 ? "boleta" : "boletas"} · ${fmtCLP(vTotal)}${esRcvExento ? " exento" : ""}`;
  const actSub = aCount > 0
    ? `${per} · ${aCount} ${aCount === 1 ? "evento" : "eventos"}${aUlt ? ` · ${aUlt}` : ""}`
    : `${per} · sin movimientos`;

  const reg = {
    ventas: { accent: "#E8553E", accentSoft: "rgba(232,85,62,.15)", icon: ICON_VENTAS, label: "Ventas", title: "REGISTRO DE VENTAS", sub: ventasSub, count: vDocs, view: "rcv" },
    actividad: { accent: "#A9B2C0", accentSoft: "rgba(169,178,192,.16)", icon: ICON_ACT, label: "Actividad", title: "REGISTRO DE ACTIVIDAD", sub: actSub, count: aCount, view: "actividad" },
  } as const;
  const otherKey = active === "ventas" ? "actividad" : "ventas";
  const A = reg[active];
  const O = reg[otherKey];

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch", height: 62, width: "100%", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 6px 20px var(--shadow), inset 0 1px 0 rgba(255,255,255,.04)", overflow: "hidden" }}>
      <style>{`@keyframes regMarquee{0%,16%{transform:translateX(0)}48%,62%{transform:translateX(var(--mq))}94%,100%{transform:translateX(0)}}`}</style>

      {/* ═══ ACTIVO — slot grande, fijo a la izquierda ═══ */}
      <button type="button" onClick={() => open(A.view)} title={`Abrir ${A.title.toLowerCase()}`}
        style={{ position: "relative", flexGrow: 4, flexBasis: 0, minWidth: 0, height: "100%", border: "none", padding: 0, textAlign: "left", color: "inherit", background: "transparent", cursor: "pointer", overflow: "hidden", WebkitTapHighlightColor: "transparent" }}>
        <span aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, background: `radial-gradient(130% 150% at 16% -25%, ${A.accentSoft}, transparent 50%), radial-gradient(75% 130% at 96% 130%, rgba(255,255,255,.06), transparent 55%)` }} />
        <motion.div key={active} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={appear}
          style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 10, height: "100%", padding: "0 13px" }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: A.accentSoft, color: A.accent, flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={A.icon} /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{A.title}</div>
            <MarqueeText text={A.sub} style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }} />
          </div>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: A.accent, flexShrink: 0 }}><path d={CHEVRON} /></svg>
        </motion.div>
      </button>

      <div aria-hidden style={{ width: 1, background: "var(--border)", flexShrink: 0, zIndex: 3 }} />

      {/* ═══ COLAPSADO — slot chico, fijo a la derecha; click = intercambia + abre ═══ */}
      <button type="button" onClick={() => { setActive(otherKey); open(O.view); }} title={`Ver ${O.title.toLowerCase()}`}
        style={{ position: "relative", flexGrow: 1, flexBasis: 0, minWidth: 0, height: "100%", border: "none", padding: 0, textAlign: "left", color: "inherit", background: "transparent", cursor: "pointer", overflow: "hidden", WebkitTapHighlightColor: "transparent" }}>
        {/* Atenuación con el fondo del tema (no negro fijo: en claro se veía como mancha) */}
        <span aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, background: "linear-gradient(90deg, color-mix(in srgb, var(--bg) 45%, transparent), color-mix(in srgb, var(--bg) 80%, transparent))" }} />
        <motion.div key={otherKey} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} whileHover={{ scale: 1.05 }} transition={appear}
          style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, height: "100%", width: "100%", padding: "0 4px" }}>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--text2)", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{O.label}</span>
          <span style={{ minWidth: 26, height: 24, borderRadius: 8, display: "grid", placeItems: "center", padding: "0 6px", background: O.accentSoft, color: O.accent, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{O.count}</span>
        </motion.div>
      </button>
    </div>
  );
}

/**
 * Texto que, si no cabe en su contenedor, se desliza en ping-pong (hacia un lado
 * y de vuelta) para mostrar el resto — sin ensanchar la card. Si cabe, queda fijo.
 */
function MarqueeText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current, i = innerRef.current;
      if (!w || !i) return;
      const o = i.scrollWidth - w.clientWidth;
      const next = o > 2 ? o : 0;
      setOverflow((prev) => (Math.abs(next - prev) > 1 ? next : prev));
    };
    measure();
    const w = wrapRef.current;
    if (!w) return;
    const ro = new ResizeObserver(measure);
    ro.observe(w);
    return () => ro.disconnect();
  }, [text]);

  const dur = Math.max(5, overflow / 20 + 4);
  // El span va ABSOLUTE → fuera del flujo, no aporta ancho al layout: jamás
  // puede mover el ancho de la card. Solo se desliza dentro del recorte.
  const innerStyle: React.CSSProperties = {
    position: "absolute", left: 0, top: 0, whiteSpace: "nowrap", lineHeight: "1.4em",
    ...(overflow > 0
      ? { animation: `regMarquee ${dur}s ease-in-out infinite`, willChange: "transform", ["--mq" as string]: `-${overflow}px` }
      : {}),
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", overflow: "hidden", width: "100%", minWidth: 0, height: "1.4em", ...style }}>
      <span ref={innerRef} style={innerStyle}>{text}</span>
    </div>
  );
}
