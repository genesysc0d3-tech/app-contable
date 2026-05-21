"use client";

import { useState, useEffect } from "react";

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
  const [prepararKey, setPrepararKey] = useState(0);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p && ["subidos","revisar","emitir","boletas"].includes(p)) {
      setTab(p);
      if (p === "emitir") setPrepararKey(k => k + 1);
    }
    function handler(e: CustomEvent) {
      const t = (e.detail as { tab?: string })?.tab;
      if (t && ["subidos","revisar","emitir","boletas"].includes(t)) {
        if (t === "emitir") setPrepararKey(k => k + 1);
        setTab(t);
      }
    }
    window.addEventListener("go-to-tab" as any, handler as any);
    return () => window.removeEventListener("go-to-tab" as any, handler as any);
  }, []);

  const tabs = [
    { id: "subidos", label: "SUBIR", sub: null,
      icon: "M12 5v14m-7-7l7-7 7 7" },
    { id: "revisar", label: "PREPARAR", sub: null,
      icon: "M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2m4-1v4H9V3m4 0h-2M9 14l2 2 4-4" },
    { id: "emitir", label: "EMITIR", sub: null,
      icon: "M13 10V3L4 14h7v7l9-11h-7z" },
    { id: "boletas", label: "VISUALIZAR DTE", sub: null,
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
                padding: "4px 6px", borderRadius: 6, border: "none", cursor: "pointer",
                minWidth: 88,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: active ? "rgba(232,85,62,.1)" : "transparent",
                color: active ? "#E8553E" : "var(--text2)",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={t.icon} /></svg>
              <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>{t.label}</span>
              {t.sub && <span style={{fontSize:7,fontWeight:500,lineHeight:1,opacity:0.65,marginTop:1}}>{t.sub}</span>}
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
          <span className="stat"><span className="num" style={{color:"var(--text2)",fontSize:13}}>{aprobCount}</span><span className="lbl" style={{fontSize:9,color:"var(--text2)"}}>aprobadas para emisión</span></span>
          <span className="date">{fecha}</span>
        </div>
      </div>

      {/* TAB CONTENT — renderiza solo el tab activo para que useEffect se dispare fresco */}
      {tab === "subidos" && <div className="r-tab-content act" style={{flex:1}}>{subidosContent}</div>}
      {tab === "revisar" && <div key={prepararKey} className="r-tab-content act" style={{flex:1}}>{revisarContent}</div>}
      {tab === "emitir" && <div className="r-tab-content act" style={{flex:1}}>{emitirContent}</div>}
      {tab === "boletas" && <div className="r-tab-content act" style={{flex:1}}>{boletasContent}</div>}
    </>
  );
}
