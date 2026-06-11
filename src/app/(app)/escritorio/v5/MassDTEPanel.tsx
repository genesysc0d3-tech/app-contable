"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

export default function MassDTEPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <style>{`
        .massdte-head{position:relative;overflow:hidden;transition:background .22s ease,border-color .22s ease,box-shadow .28s ease}
        .massdte-head::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(180,240,39,.10),rgba(180,240,39,.04));opacity:1;pointer-events:none;transition:opacity .22s ease}
        .massdte-head:hover{box-shadow:inset 0 0 0 1px rgba(180,240,39,.12),inset 0 0 34px rgba(180,240,39,.08)}
        .massdte-content{overflow:hidden;transition:max-height .26s cubic-bezier(.22,1,.36,1),opacity .18s ease,transform .24s cubic-bezier(.22,1,.36,1)}
      `}</style>
      <div className={`panel-hd massdte-head ${open ? "is-open" : "is-closed"}`} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderBottom:"1px solid rgba(180,240,39,.10)",flexShrink:0,background:"rgba(180,240,39,.06)",boxShadow:open ? "inset 0 0 0 1px rgba(180,240,39,.10), inset 0 0 34px rgba(180,240,39,.06)" : "inset 0 0 0 1px rgba(180,240,39,.04)"}}>
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="massdte-content"
          style={{position:"relative",zIndex:1,width:32,height:32,borderRadius:8,border:"1px solid rgba(180,240,39,.14)",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(180,240,39,.08)",color:"#b4f027",flexShrink:0,cursor:"pointer",boxShadow:"0 0 18px rgba(180,240,39,.06)",transition:"all .2s ease"}}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        </button>
        <button
          onClick={() => setOpen((value) => !value)}
          style={{position:"relative",zIndex:1,display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0,border:"none",background:"transparent",padding:0,cursor:"pointer",textAlign:"left"}}
        >
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:13,fontWeight:800,color:"#b4f027",letterSpacing:"-0.02em"}}>MassDTE</h2>
            <p style={{fontSize:10,color:"var(--text2)",marginTop:1}}>Subida masiva de cartolas y documentos</p>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={open ? "#b4f027" : "var(--text2)"} strokeWidth="2" style={{transform:open ? "rotate(90deg)" : "rotate(0deg)",transition:"transform .18s ease,stroke .18s ease",marginLeft:"auto",flexShrink:0}}><path d="M9 18l6-6-6-6" /></svg>
        </button>
        {open && (
          <Link href="/api/generar-template" className="plantilla" style={{position:"relative",zIndex:1,marginLeft:"auto",display:"flex",alignItems:"center",gap:3,padding:"4px 8px",borderRadius:5,border:"1px solid rgba(180,240,39,.18)",background:"rgba(180,240,39,.06)",color:"var(--text2)",fontSize:9,fontWeight:600,textDecoration:"none",transition:"all .18s ease"}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-7-7l7-7 7 7"/></svg>
            Plantilla Excel
          </Link>
        )}
      </div>
      <div
        id="massdte-content"
        className="e-scroll massdte-content"
        style={{maxHeight:open ? 900 : 0,opacity:open ? 1 : 0,transform:open ? "translateY(0)" : "translateY(-4px)",pointerEvents:open ? "auto" : "none",flex:open ? "1 1 auto" : "0 0 auto",minHeight:0}}
      >
        {children}
      </div>
    </>
  );
}
