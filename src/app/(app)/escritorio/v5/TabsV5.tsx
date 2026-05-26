"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

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
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveIndicator = useCallback(() => {
    const idx = tabs.findIndex(t => t.id === tab);
      const btn = btnRefs.current[idx];
      const bar = barRef.current;
      const indicator = indicatorRef.current;
      if (!btn || !bar || !indicator) return;
      const btnRect = btn.getBoundingClientRect();
      const next = btn.nextElementSibling as HTMLElement | null;
      const nextArrow = next?.dataset?.tabArrow === "true" ? next : null;
      indicator.style.left = btn.offsetLeft + "px";
      indicator.style.width = nextArrow
        ? (nextArrow.offsetLeft + nextArrow.offsetWidth - btn.offsetLeft) + "px"
        : btnRect.width + "px";
  }, [tab]);

  useEffect(() => {
    const handler = (e: Event) => setTab((e as CustomEvent).detail);
    window.addEventListener("switch-tab", handler);
    return () => window.removeEventListener("switch-tab", handler);
  }, []);

  useEffect(() => { moveIndicator(); }, [moveIndicator]);

  useEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    requestAnimationFrame(() => {
      indicator.style.transition = "left .35s cubic-bezier(.22,1,.36,1), width .35s cubic-bezier(.22,1,.36,1)";
      moveIndicator();
    });
  }, [moveIndicator]);

  const tabs = [
    { id: "subidos", label: "Agregados",
      icon: "M12 5v14m-7-7l7-7 7 7" },
    { id: "revisar", label: "Revisar",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "emitir", label: "Emitir",
      icon: "M13 10V3L4 14h7v7l9-11h-7z" },
    { id: "boletas", label: "Boletas",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  ];

  const activeContent = tab === "subidos"
    ? subidosContent
    : tab === "revisar"
      ? revisarContent
      : tab === "emitir"
        ? emitirContent
        : boletasContent;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* TAB BAR + STATS */}
      <div ref={barRef} className="tab-bar" style={{position:"relative",display:"flex",alignItems:"center",gap:2,padding:"8px 16px",borderBottom:"1px solid var(--bg-muted)",flexShrink:0}}>
        {tabs.map((t, i) => {
          const active = t.id === tab;
          const arrowActive = i > 0 && tabs[i - 1].id === tab;
          return (
            <React.Fragment key={t.id}>
            {i > 0 && <span data-tab-arrow="true" aria-hidden="true" style={{position:"relative",zIndex:2,width:30,height:26,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,color:arrowActive ? "#fff" : "var(--text3)",flexShrink:0,background:arrowActive ? "transparent" : "var(--bg-muted)",lineHeight:1,fontWeight:900,letterSpacing:"-0.18em",boxShadow:"none"}}>››</span>}
            <button ref={el => { btnRefs.current[i] = el; }} onClick={() => setTab(t.id)}
              style={{
                position:"relative",zIndex:2,padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: active ? 600 : 500, display: "flex", alignItems: "center", gap: 5,
                background: "transparent",
                color: active ? "#fff" : "var(--text2)",
                transition:"color .25s",
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={t.icon} /></svg>
              {t.label}
            </button>
            </React.Fragment>
          );
        })}
        {/* SLIDING PILL INDICATOR */}
        <div ref={indicatorRef} style={{
          position:"absolute",top:"50%",left:0,zIndex:1,
          height:26,borderRadius:6,marginTop:-13,
          background:"var(--accent)",
          boxShadow:"0 2px 12px rgba(232,85,62,.35)",
        }} />
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:9,color:"var(--text2)",display:"flex",alignItems:"center",gap:3}}>
            <span style={{fontSize:13,fontWeight:300}}>{pendCount}</span>
            <span style={{fontSize:9}}>esperando</span>
          </span>
          <span style={{fontSize:9,color:"var(--text3)"}}>·</span>
          <span style={{fontSize:9,color:"var(--text2)",display:"flex",alignItems:"center",gap:3}}>
            <span style={{fontSize:13,fontWeight:300,color:"#b4f027"}}>{aprobCount}</span>
            <span style={{fontSize:9}}>aprobados</span>
          </span>
          <span style={{fontSize:9,color:"var(--text2)",marginLeft:4}}>{fecha}</span>
        </div>
      </div>

      {/* TAB CONTENT */}
      <div key={`${tab}-${fecha}`} className="r-tab-content act" style={{flex:1, minHeight: 0}}>
        {activeContent}
      </div>
    </div>
  );
}
