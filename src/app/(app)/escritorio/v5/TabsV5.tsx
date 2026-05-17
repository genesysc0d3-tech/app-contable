"use client";

import { useState } from "react";

export default function TabsV5({
  pendCount, aprobCount, nombreEmpresa, fecha,
  subidosContent, revisarContent, emitirContent, boletasContent,
}: {
  pendCount: number; aprobCount: number; nombreEmpresa: string; fecha: string;
  subidosContent?: React.ReactNode;
  revisarContent: React.ReactNode;
  emitirContent: React.ReactNode;
  boletasContent: React.ReactNode;
}) {
  const [tab, setTab] = useState("revisar");

  const tabs = [
    { id: "subidos", label: "Subidos",
      icon: "M12 5v14m-7-7l7-7 7 7" },
    { id: "revisar", label: "Revisar",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "emitir", label: "Emitir",
      icon: "M13 10V3L4 14h7v7l9-11h-7z" },
    { id: "boletas", label: "Boletas",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  ];

  return (
    <>
      {/* TAB BAR */}
      <div className="tab-bar">
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`tb ${active ? "act" : ""}`}
              style={{
                padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
                background: active ? "rgba(232,85,62,.1)" : "transparent",
                color: active ? "#E8553E" : "var(--text2)",
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={t.icon} /></svg>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-l">
          <span className="dot"></span>
          <h1>{nombreEmpresa}</h1>
        </div>
        <div className="topbar-r">
          <span className="stat"><span className="num">{pendCount}</span><span className="lbl">esperando</span></span>
          <span className="sep">·</span>
          <span className="stat"><span className="num" style={{color:"#b4f027"}}>{aprobCount}</span><span className="lbl">aprobados</span></span>
          <span className="date">{fecha}</span>
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className={`r-tab-content ${tab === "subidos" ? "act" : ""}`} style={{flex:1}}>
        {subidosContent}
      </div>
      <div className={`r-tab-content ${tab === "revisar" ? "act" : ""}`} style={{flex:1}}>
        {revisarContent}
      </div>
      <div className={`r-tab-content ${tab === "emitir" ? "act" : ""}`} style={{flex:1}}>
        {emitirContent}
      </div>
      <div className={`r-tab-content ${tab === "boletas" ? "act" : ""}`} style={{flex:1}}>
        {boletasContent}
      </div>
    </>
  );
}
