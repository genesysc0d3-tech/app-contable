"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { motion } from "motion/react";
import { Building2, MessageCircle, ReceiptText, Users, CreditCard } from "lucide-react";
import { obtenerFacturacion, type ResumenCupos, type FacturacionData } from "./actions";

const RED = "#E8553E";

function fmt(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("es-CL");
}
function pct(uso: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((uso / total) * 100)));
}
function estadoColor(disponible: number, total: number) {
  if (total <= 0) return "var(--text3)";
  const restante = disponible / total;
  if (restante <= 0.08) return "#ef4444";
  if (restante <= 0.2) return "#f59e0b";
  return "#22c55e";
}
function fmtFecha(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", timeZone: "America/Santiago" });
  } catch {
    return iso.slice(0, 10);
  }
}

const panel: CSSProperties = { width: "50%", height: "100%", padding: "13px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column" };

/* ─── Cara A · Uso del mes ─── */
function UsoSide({ resumen, barW }: { resumen: ResumenCupos; barW: number }) {
  const b = resumen.boletasCartolas;
  const t = resumen.telegram;
  const barColor = estadoColor(b.disponible, b.total);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2 style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>Uso del mes</h2>
        <div style={{ border: `1px solid ${RED}55`, background: `${RED}10`, borderRadius: 9, padding: "3px 10px", textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: ".1em", color: "var(--text3)" }}>PLAN</div>
          <div style={{ fontSize: 12, fontWeight: 850, color: RED, lineHeight: 1.1, textTransform: "capitalize" }}>{resumen.plan ?? "Prueba"}</div>
        </div>
      </div>

      <div style={{ marginTop: 11, display: "grid", gap: 9 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, display: "grid", placeItems: "center", color: RED, background: "rgba(232,85,62,.1)", border: "1px solid var(--border)", flexShrink: 0 }}><ReceiptText size={12} strokeWidth={2.2} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", color: "var(--text)", fontSize: 11, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Boletas desde cartolas</span>
              <span style={{ display: "block", marginTop: 1, color: "var(--text2)", fontSize: 8 }}>{fmt(b.disponible)} disponibles</span>
            </span>
            <span style={{ color: "var(--text)", fontSize: 11, fontWeight: 850, whiteSpace: "nowrap" }}>{fmt(b.uso)} / {fmt(b.total)}</span>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: "var(--bg-muted)", overflow: "hidden" }}>
            <div style={{ width: `${barW}%`, height: "100%", borderRadius: 999, background: barColor, boxShadow: `0 0 10px color-mix(in srgb, ${barColor} 35%, transparent)`, transition: "width 1s cubic-bezier(.22,1,.36,1)" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, display: "grid", placeItems: "center", color: "var(--text3)", background: "var(--bg-muted)", border: "1px solid var(--border)", flexShrink: 0 }}><MessageCircle size={12} strokeWidth={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", color: t.habilitado ? "var(--text)" : "var(--text2)", fontSize: 11, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Comprobantes por Telegram</span>
            <span style={{ display: "block", marginTop: 1, color: "var(--text3)", fontSize: 8 }}>{t.total > 0 ? `${fmt(t.disponible)} disponibles` : "No incluido"}</span>
          </span>
          <span style={{ color: t.habilitado ? "var(--text)" : "var(--text3)", fontSize: 11, fontWeight: 850 }}>{t.total > 0 ? `${fmt(t.uso)} / ${fmt(t.total)}` : "0"}</span>
        </div>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--border)", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text2)", fontSize: 9, fontWeight: 800 }}><Building2 size={11} strokeWidth={2.2} /> Empresas</span>
          <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text)" }}>{fmt(resumen.empresas.uso)} / {fmt(resumen.empresas.total)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text2)", fontSize: 9, fontWeight: 800 }}><Users size={11} strokeWidth={2.2} /> Personas</span>
          <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text)" }}>{fmt(resumen.personas.uso)} / {fmt(resumen.personas.total)}</span>
        </div>
      </div>
    </>
  );
}

/* ─── Cara B · Tu plan ─── */
function PlanSide({ resumen, fact }: { resumen: ResumenCupos; fact: FacturacionData | null }) {
  const b = resumen.boletasCartolas;
  const renueva = fact?.suscripcion?.proximoCobro
    ? fmtFecha(fact.suscripcion.proximoCobro)
    : fact?.trial?.activo
    ? "en prueba"
    : "—";
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", color: RED, background: "rgba(232,85,62,.1)", border: "1px solid var(--border)" }}><CreditCard size={13} strokeWidth={2.2} /></span>
          <h2 style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>Tu plan</h2>
        </div>
        <span style={{ fontSize: 8, fontWeight: 800, color: resumen.planActivo ? "#22c55e" : "#f59e0b" }}>● {resumen.planActivo ? "activo" : "prueba"}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 850, color: "var(--text)", lineHeight: 1, textTransform: "capitalize" }}>{fact?.plan?.nombre ?? resumen.plan ?? "Prueba"}</div>
        <div style={{ marginTop: 4, fontSize: 10, color: "var(--text2)", fontWeight: 600 }}>
          {fact?.plan ? `UF ${fact.plan.ufMensual} / mes · ≈ $${fmt(fact.plan.clpMensualConIva)} con IVA` : "boletas desde tus cartolas"}
        </div>
      </div>

      <div style={{ marginTop: 11, display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span style={{ color: "var(--text2)" }}>Se renueva</span><span style={{ color: "var(--text)", fontWeight: 800 }}>{renueva}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span style={{ color: "var(--text2)" }}>Disponibles</span><span style={{ color: "var(--text)", fontWeight: 800 }}>{fmt(b.disponible)} de {fmt(b.total)}</span></div>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 11 }}>
        <a href="/planes" onClick={(e) => e.stopPropagation()} style={{ display: "block", width: "100%", borderRadius: 9, border: `1px solid ${RED}`, background: RED, color: "#fff", padding: "8px", fontSize: 11, fontWeight: 850, textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>Gestionar plan</a>
        <div style={{ marginTop: 6, textAlign: "center", fontSize: 8, color: "var(--text3)" }}>← clic para volver</div>
      </div>
    </>
  );
}

export default function UsageCountersPanel({ resumen }: { resumen: ResumenCupos }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [barW, setBarW] = useState(0);
  const [fact, setFact] = useState<FacturacionData | null>(null);

  const target = pct(resumen.boletasCartolas.uso, resumen.boletasCartolas.total);
  useEffect(() => {
    const t = setTimeout(() => setBarW(open ? 0 : target), 250);
    return () => clearTimeout(t);
  }, [open, target]);

  // Carga perezosa de la facturación cuando se abre la cara del plan (en
  // efecto, nunca dentro del render ni del updater de setState).
  useEffect(() => {
    if (!open || fact) return;
    let alive = true;
    obtenerFacturacion().then((r) => { if (alive && r.ok) setFact(r.data); });
    return () => { alive = false; };
  }, [open, fact]);

  function toggle() {
    setOpen((o) => !o);
  }
  function onMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div>
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={toggle}
        style={{
          position: "relative",
          width: "100%",
          height: 210,
          overflow: "hidden",
          borderRadius: 16,
          border: `1px solid ${hover ? "rgba(232,85,62,.28)" : "var(--border)"}`,
          background: "var(--surface)",
          boxShadow: "inset 0 1px 0 var(--border), 0 8px 32px var(--shadow)",
          transform: hover ? "translateY(-3px)" : "none",
          transition: "transform .3s cubic-bezier(.22,1,.36,1), border-color .3s",
          cursor: "pointer",
        }}
      >
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: hover ? 1 : 0, transition: "opacity .3s", background: "radial-gradient(260px circle at var(--mx,50%) var(--my,0), rgba(232,85,62,.18), transparent 60%)" }} />
        <motion.div
          animate={{ x: open ? "-50%" : "0%" }}
          transition={{ type: "spring", stiffness: 250, damping: 30 }}
          style={{ position: "relative", zIndex: 2, display: "flex", width: "200%", height: "100%" }}
        >
          <div style={panel}><UsoSide resumen={resumen} barW={barW} /></div>
          <div style={panel}><PlanSide resumen={resumen} fact={fact} /></div>
        </motion.div>
      </div>
      <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 8 }}>
        {[0, 1].map((i) => (
          <span key={i} style={{ width: open === Boolean(i) ? 16 : 5, height: 5, borderRadius: 999, background: open === Boolean(i) ? RED : "var(--text3)", transition: "all .3s" }} />
        ))}
      </div>
    </div>
  );
}
