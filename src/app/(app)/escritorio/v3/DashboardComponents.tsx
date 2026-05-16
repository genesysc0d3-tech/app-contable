"use client";

import { ChartBar, Files, Receipt, MagnifyingGlass, Bell } from "@phosphor-icons/react";

/* ─── KPI CARDS ─── */
export function KpiCards({ pendientes, emitidosHoy, emitidosMes, aprobados }: {
  pendientes: number; emitidosHoy: number; emitidosMes: number; aprobados: number;
}) {
  const cards = [
    { icon: ChartBar, value: emitidosHoy, label: "Emitidas hoy", sub: "Tasa de emisión", color: "#b4f027", bg: "linear-gradient(135deg, rgba(180,240,39,0.15) 0%, rgba(180,240,39,0.05) 100%)", spark: [2,4,3,6,5,8,7] },
    { icon: Files, value: pendientes, label: "Pendientes", sub: "Por revisar", color: "#5b9cf6", bg: "linear-gradient(135deg, rgba(91,156,246,0.15) 0%, rgba(91,156,246,0.05) 100%)", spark: [8,6,7,5,4,6,5] },
    { icon: Receipt, value: emitidosMes, label: "Emitidas mes", sub: "Total del período", color: "#a78bfa", bg: "linear-gradient(135deg, rgba(167,139,250,0.15) 0%, rgba(167,139,250,0.05) 100%)", spark: [3,5,4,6,7,5,6] },
    { icon: ChartBar, value: aprobados, label: "Aprobadas", sub: "Tasa de éxito", color: "#22c55e", bg: "linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)", spark: [5,4,6,3,7,4,5] },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "16px 18px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: c.bg }}>
              <c.icon size={18} color={c.color} weight="fill" />
            </div>
            <svg width="72" height="28" viewBox="0 0 72 28" style={{ opacity: 0.5 }}>
              <path d={c.spark.map((v, i) => `${i === 0 ? "M" : "L"}${i * 12},${28 - (v / Math.max(...c.spark, 1)) * 24}`).join(" ")} stroke={c.color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", lineHeight: 1, marginTop: 6, color: "#e8eaf0" }}>{c.value}</div>
          <div style={{ fontSize: 12, color: "#636878", marginTop: 2 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 11, color: "#636878" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── CHART ─── */
export function BarChart({ data, months, activeMonth }: {
  data: number[]; months: string[]; activeMonth: number;
}) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "18px 20px", marginTop: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 14px", color: "#e8eaf0" }}>Emisiones mensuales</h3>
      <div style={{ display: "flex", alignItems: "end", gap: 6, height: 120 }}>
        {data.map((c, i) => {
          const h = Math.max((c / max) * 100, 4);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: "#636878" }}>{c}</span>
              <div style={{ width: "100%", height: h, borderRadius: "6px 6px 2px 2px", background: i === activeMonth ? "#b4f027" : "#2a2d36", minHeight: 4 }} />
              <span style={{ fontSize: 9, color: i === activeMonth ? "#b4f027" : "#636878", fontWeight: i === activeMonth ? 600 : 400 }}>{months[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── RIGHT PANEL ─── */
export function RightPanel() {
  const acts = [
    { icon: Receipt, label: "Boleta #0042", sub: "$150.000 · Factura A", time: "5 min", color: "#22c55e", detail: "Tipo 39 · Afecta · Receptor: ACME SpA" },
    { icon: ChartBar, label: "Transferencia aprobada", sub: "$320.000 recibido", time: "18 min", color: "#5b9cf6", detail: "P2P · Cliente: Juan Pérez · Clasificación: boleta" },
    { icon: Files, label: "Cartola procesada", sub: "santander.xlsx · 238 mov.", time: "1 h", color: "#a78bfa", detail: "IA clasificó 238 movimientos · 12 pendientes" },
    { icon: MagnifyingGlass, label: "Documentos analizados", sub: "3 PDFs procesados", time: "2 h", color: "#b4f027", detail: "Extracción completada · 45 movimientos detectados" },
    { icon: Bell, label: "Folios restantes", sub: "42 disponibles", time: "3 h", color: "#f59e0b", detail: "Tipo 39: 42 · Tipo 41: 18 · Renovar pronto" },
  ];

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px", color: "#e8eaf0", letterSpacing: "-0.3px" }}>Actividad</h3>
      <style>{`
        .acard { position: relative; cursor: pointer; margin-bottom: 10px; background: #1e1e22; border-radius: 10px; transition: all .25s cubic-bezier(0.22,1,0.36,1); overflow: hidden; }
        .acard:hover { background: #25252a; }
        .acard .back { position: absolute; inset: 0; border-radius: 10px; background: rgba(30,31,38,0.4); transition: .2s ease-in-out; z-index: 0; }
        .acard:hover .back { scale: 1.03; top: -2px; }
        .acard .front { position: relative; z-index: 1; padding: 10px 12px; }
        .acard .expand { max-height: 0; overflow: hidden; transition: max-height .25s cubic-bezier(0.22,1,0.36,1); position: relative; z-index: 1; }
        .acard:hover .expand { max-height: 40px; }
        .acard .expand-inner { padding: 0 12px 8px; font-size: 10px; color: #888; border-top: 1px solid rgba(255,255,255,0.04); }
      `}</style>
      {acts.map((a, i) => (
        <div key={i} className="acard">
          <div className="back" />
          <div className="front" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: `${a.color}15`, border: `1px solid ${a.color}25`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <a.icon size={13} color={a.color} weight="fill" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#e8eaf0" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>{a.sub}</div>
              <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>{a.time}</div>
            </div>
          </div>
          <div className="expand">
            <div className="expand-inner">{a.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
