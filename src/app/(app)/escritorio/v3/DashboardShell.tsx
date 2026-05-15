"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MagnifyingGlass, Bell, ChartBar, Files, CalendarDots, Receipt, Gear, UploadSimple, FileArrowDown } from "@phosphor-icons/react";

export default function DashboardShell({ children, empresa, empresaId }: {
  children: React.ReactNode; empresa: string; empresaId: string;
}) {
  const [tab, setTab] = useState("dashboard");

  const nav = [
    { id: "dashboard", icon: ChartBar },
    { id: "emitir", icon: Files },
    { id: "revisar", icon: Receipt },
    { id: "boletas", icon: CalendarDots },
    { id: "config", icon: Gear },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0f1014", color: "#e8eaf0", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      {/* ── SIDEBAR 72px ── */}
      <style>{`.nav-i:hover{background:#1e2028!important;color:#9499a8!important}`}</style>
      <div style={{ width: 72, background: "#16181d", borderRight: "1px solid #2a2d36", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 12px", gap: 6, flexShrink: 0 }}>
        <Link href="/escritorio/v3" scroll={false} style={{ textDecoration: "none" }}>
          <svg width="32" height="32" viewBox="0 0 32 32" style={{ marginBottom: 18 }}><rect width="32" height="32" rx="8" fill="#b4f027"/><rect x="8" y="8" width="6" height="16" rx="2" fill="#0f1014"/><rect x="18" y="12" width="6" height="12" rx="2" fill="#0f1014"/></svg>
        </Link>
        {nav.map((n) => {
          const Icon = n.icon;
          const active = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)}
              className="nav-i"
              style={{ width: 44, height: 44, borderRadius: 10, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#b4f027" : "transparent", color: active ? "#000" : "#636878", transition: "all .15s" }}>
              <Icon size={20} weight={active ? "fill" : "bold"} />
            </button>
          );
        })}
        <div style={{ marginTop: "auto" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", border: "2px solid #333742", position: "relative", cursor: "pointer" }}>
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>G</span>
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", border: "2px solid #16181d" }} />
          </div>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #2a2d36", gap: 12, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px", margin: 0, color: "#e8eaf0" }}>
              {tab === "dashboard" ? "Facturación Electrónica" : tab === "emitir" ? "Emitir Documentos" : tab === "revisar" ? "Revisar Propuestas" : tab === "boletas" ? "Boletas Emitidas" : "Configuración"}
            </h1>
            <p style={{ fontSize: 12, color: "#636878", margin: "1px 0 0" }}>Sistema de facturación y documentos tributarios</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "6px 12px", width: 160 }}>
              <MagnifyingGlass size={14} color="#636878" />
              <input placeholder="Buscar..." style={{ background: "none", border: "none", outline: "none", color: "#e8eaf0", fontSize: 13, width: "100%" }} />
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#1e2028", border: "1px solid #2a2d36", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9499a8", position: "relative" }}>
              <Bell size={17} />
              <div style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "#b4f027", border: "1.5px solid #1e2028" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "5px 10px 5px 5px", cursor: "pointer" }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>{empresa[0]}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{empresa.slice(0, 14)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
            {children}
          </div>
          {tab === "dashboard" && (
            <div style={{ width: 290, borderLeft: "1px solid #2a2d36", background: "#16181d", overflowY: "auto", padding: "20px 16px", flexShrink: 0 }}>
              <RightPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── KPI ROW ─── */
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
            {/* Sparkline */}
            <svg width="72" height="28" viewBox="0 0 72 28" style={{ opacity: 0.5 }}>
              <path d={c.spark.map((v, i) => `${i === 0 ? "M" : "L"}${i * 12},${28 - (v / Math.max(...c.spark, 1)) * 24}`).join(" ")} stroke={c.color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
              <div style={{ width: "100%", height: h, borderRadius: "6px 6px 2px 2px", background: i === activeMonth ? "#b4f027" : "#2a2d36", minHeight: 4, transition: "height .3s" }} />
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
    { icon: Receipt, label: "Boleta emitida #0042", sub: "$150.000 — Factura A", time: "Hace 5 min", bg: "rgba(34,197,94,0.15)", color: "#22c55e" },
    { icon: ChartBar, label: "Propuesta aprobada", sub: "Transferencia recibida — P2P", time: "Hace 18 min", bg: "rgba(91,156,246,0.15)", color: "#5b9cf6" },
    { icon: Files, label: "Cartola subida", sub: "santander.xlsx — 238 mov.", time: "Hace 1 hora", bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
    { icon: MagnifyingGlass, label: "Documento procesado", sub: "IA clasificó 238 movimientos", time: "Hace 2 horas", bg: "rgba(180,240,39,0.15)", color: "#b4f027" },
    { icon: Bell, label: "Folios restantes", sub: "42 disponibles para tipo 39", time: "Hace 3 horas", bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  ];

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px", color: "#e8eaf0" }}>Actividad reciente</h3>
      {acts.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: i < acts.length - 1 ? "1px solid #2a2d36" : "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: a.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <a.icon size={14} color={a.color} weight="fill" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{a.label}</div>
            <div style={{ fontSize: 11, color: "#636878", marginTop: 1 }}>{a.sub}</div>
            <div style={{ fontSize: 10, color: "#9499a8", marginTop: 2 }}>{a.time}</div>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 24, background: "#1e2028", borderRadius: 12, border: "1px solid #2a2d36", padding: 16 }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, margin: "0 0 10px", color: "#e8eaf0" }}>Resumen del mes</h4>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#636878", marginBottom: 6 }}>
          <span>Total emitido</span>
          <span style={{ color: "#b4f027", fontWeight: 600 }}>$2.450.000</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#636878", marginBottom: 6 }}>
          <span>Docs procesados</span>
          <span style={{ color: "#e8eaf0", fontWeight: 600 }}>238</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#636878" }}>
          <span>Por revisar</span>
          <span style={{ color: "#5b9cf6", fontWeight: 600 }}>12</span>
        </div>
      </div>
    </div>
  );
}
