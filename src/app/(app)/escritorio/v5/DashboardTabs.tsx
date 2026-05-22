"use client";

import { useState } from "react";

const DASH_TABS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  },
  {
    id: "actividad",
    label: "Actividad",
    icon: "M13 2l-5 7h4l-3 8 7-10h-4l3-5z",
  },
  {
    id: "boletas",
    label: "Registro de Ventas",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
];

export default function DashboardTabs({
  rcvCard,
  calendar,
  dashboardOverview,
  actividadContent,
  boletasEmitidasContent,
}: {
  rcvCard: React.ReactNode;
  calendar: React.ReactNode;
  dashboardOverview: React.ReactNode;
  actividadContent: React.ReactNode;
  boletasEmitidasContent: React.ReactNode;
}) {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="app" style={{
      display: "grid", gridTemplateColumns: "3fr 7fr", maxWidth: 1400,
      margin: "0 auto", gap: 24, height: "calc(100vh - 104px)",
      padding: 0, position: "relative", background: "transparent", minHeight: 0,
    }}>
      {/* LEFT COLUMN */}
      <div className="left-col" style={{display:"flex",flexDirection:"column",gap:16,overflow:"visible",minHeight:0,scrollbarWidth:"none"}}>
        {rcvCard}

        <div style={{
          background: "var(--surface)", borderRadius: 20,
          border: "1px solid var(--border)", padding: "8px",
          boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",
        }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 14px 8px" }}>
            Panel
          </div>
          {DASH_TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "10px 14px", borderRadius: 10,
                  border: "none", cursor: "pointer",
                  background: active ? "rgba(232,85,62,.1)" : "transparent",
                  color: active ? "#E8553E" : "var(--text2)",
                  fontWeight: active ? 600 : 500, fontSize: 11,
                  transition: "all .15s",
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <path d={t.icon} />
                </svg>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Botón EMITIR BOLETA fuera del Panel */}
        <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "emitir", mode: "dte" } }))}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "10px 14px", borderRadius: 10,
            border: "none", cursor: "pointer",
            background: "rgba(232,85,62,.1)", color: "#E8553E",
            fontWeight: 600, fontSize: 11,
            transition: "all .15s",
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span>EMITIR BOLETA</span>
        </button>
      </div>

      {/* RIGHT COLUMN */}
      <div style={{
        borderRadius: 20, display: "flex", flexDirection: "column",
        minHeight: 0, overflow: "hidden",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",
      }}>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
          {tab === "dashboard" && dashboardOverview}
          {tab === "actividad" && <div style={{ padding: 16 }}>{actividadContent}</div>}
          {tab === "boletas" && <div style={{ padding: 16 }}>{boletasEmitidasContent}</div>}
        </div>
      </div>
    </div>
  );
}
