"use client";

import { useState, useRef, useEffect } from "react";

const DASH_TABS = [
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
  actividadContent,
  boletasEmitidasContent,
}: {
  rcvCard: React.ReactNode;
  calendar: React.ReactNode;
  actividadContent: React.ReactNode;
  boletasEmitidasContent: React.ReactNode;
}) {
  const [tab, setTab] = useState("actividad");

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
      </div>

      {/* RIGHT COLUMN */}
      <div style={{
        borderRadius: 20, display: "flex", flexDirection: "column",
        minHeight: 0, overflow: "hidden",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",
      }}>
        {/* Calendar (always visible) */}
        {calendar}

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, scrollbarWidth: "none" }}>
          {tab === "actividad" && actividadContent}
          {tab === "boletas" && boletasEmitidasContent}
        </div>
      </div>
    </div>
  );
}
