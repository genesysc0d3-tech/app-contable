"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Buildings } from "@phosphor-icons/react/dist/ssr";
import EmpresaPopup from "./EmpresaPopup";
import type { DatosEmisor } from "../../empresa/actions";
import type { CAFRow } from "../../empresa/CAFPanel";

const TOP_TABS = [
  { id: "subir", label: "Subir", icon: "M12 5v14m-7-7l7-7 7 7" },
  { id: "revisar", label: "Revisar", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "emitir", label: "Emitir", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "visualizar", label: "Visualizar DTE", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

export default function V5Root({
  dashboardContent, subirContent, revisarContent, emitirContent, visualizarContent,
  empresaInicial, empresaTieneCertificado, empresaCafs, empresaId, hasBoletas,
}: {
  dashboardContent: React.ReactNode;
  subirContent: React.ReactNode;
  revisarContent: React.ReactNode;
  emitirContent: React.ReactNode;
  visualizarContent: React.ReactNode;
  empresaInicial: DatosEmisor;
  empresaTieneCertificado: boolean;
  empresaCafs: CAFRow[];
  empresaId: string;
  hasBoletas?: boolean;
}) {
  const [tab, setTab] = useState("subir");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [empresaOpen, setEmpresaOpen] = useState(false);
  const [emitir2Open, setEmitir2Open] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handler(e: CustomEvent) {
      const t = (e.detail as { tab?: string })?.tab;
      if (t) { setTab(t); setEmitir2Open(false); }
    }
    window.addEventListener("go-to-tab" as any, handler as any);
    return () => window.removeEventListener("go-to-tab" as any, handler as any);
  }, []);

  // Cerrar Emitir 2 al hacer click fuera
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setEmitir2Open(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggleTheme = useCallback((e: React.MouseEvent) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const next = theme === "dark" ? "light" : "dark";

    const apply = () => {
      setTheme(next);
      document.documentElement.dataset.theme = next;
    };

    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.documentElement.style.setProperty("--click-x", cx + "px");
      document.documentElement.style.setProperty("--click-y", cy + "px");
      (document as any).startViewTransition(apply);
    } else {
      apply();
    }
  }, [theme]);

  return (
    <>
      <style>{`
:root,[data-theme="dark"]{--bg:#0f1014;--surface:#16181d;--surface2:#1a1c24;--border:rgba(255,255,255,.06);--text:#e8eaf0;--text2:#636878;--text3:#4a4d55;--accent:#E8553E;--accent-light:rgba(232,85,62,.1);--green:#22c55e;--amber:#f59e0b;--blue:#5b9cf6;--bg-muted:rgba(255,255,255,.04);--shadow:rgba(0,0,0,.3);--header-bg:rgba(22,24,29,.15);--header-border:rgba(255,255,255,.04)}
[data-theme="light"]{--bg:#f5f0eb;--surface:#ffffff;--surface2:#faf7f3;--border:rgba(0,0,0,.08);--text:#1a1612;--text2:#8c8279;--text3:#b0a79e;--accent:#E8553E;--accent-light:rgba(232,85,62,.08);--green:#16a34a;--amber:#d97706;--blue:#3b82f6;--bg-muted:rgba(0,0,0,.04);--shadow:rgba(0,0,0,.08);--header-bg:rgba(255,255,255,.2);--header-border:rgba(0,0,0,.04)}
body{background:var(--bg);color:var(--text);transition:background .4s,color .4s}
::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}
::view-transition-new(root){z-index:9999;clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%));animation:circle-expand .5s cubic-bezier(.22,1,.36,1) forwards}
@keyframes circle-expand{from{clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%))}to{clip-path:circle(150% at var(--click-x,50%) var(--click-y,50%))}}
::view-transition-old(root){z-index:1}
.dz{padding:14px;border-radius:10px;border:1.5px dashed rgba(255,255,255,.06);display:flex;align-items:center;gap:10px;cursor:pointer;transition:all .2s}
.dz:hover{border-color:rgba(180,240,39,.3);background:rgba(180,240,39,.02)}
.dz-icon{width:32px;height:32px;border-radius:8px;background:rgba(180,240,39,.06);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dz-icon svg{width:16px;height:16px;color:#b4f027}
.dz-txt h4{font-size:12px;font-weight:600}
.dz-txt p{font-size:10px;color:var(--text2);margin-top:1px}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.3}}
.dots-anim::after{content:'';animation:dots 1.4s steps(4) infinite;display:inline-block;width:1.1em;text-align:left}
@keyframes dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:''}}
`}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans','Inter',sans-serif", transition: "background .4s,color .4s" }}>
        {/* NAV — barra superior */}
        <div ref={navRef} style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50,
          display: "flex", alignItems: "center", gap: 3,
          background: "var(--header-bg)", backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRadius: 16, padding: "4px 6px",
          border: "1px solid var(--header-border)",
          boxShadow: "0 4px 24px var(--shadow)",
          transition: "background .4s,border .4s,box-shadow .4s",
        }}>
          {/* Panel */}
          <button onClick={() => { setTab("dashboard"); setEmitir2Open(false); }}
            style={{
              padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", minWidth: 50,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: tab === "dashboard" ? "rgba(232,85,62,.1)" : "transparent",
              color: tab === "dashboard" ? "#E8553E" : "var(--text2)",
              transition: "all .2s",
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            </svg>
            <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>Panel</span>
          </button>

          {/* Tabs ocultos — siguen funcionales para el flujo masivo via EMITIR MASSDTE */}
          {TOP_TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setEmitir2Open(false); }}
              style={{
                padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                minWidth: 70, display: "none",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: tab === t.id ? "rgba(232,85,62,.1)" : "transparent",
                color: tab === t.id ? "#E8553E" : "var(--text2)",
                transition: "all .2s",
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={t.icon} /></svg>
              <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>{t.label}</span>
            </button>
          ))}

          {/* Emitir 2 */}
          <button onClick={() => setEmitir2Open(o => !o)}
            style={{
              padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", minWidth: 56,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "transparent",
              color: "var(--text2)",
              transition: "all .2s",
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>
              Emitir 2 <span style={{fontSize:7,marginLeft:1}}>{emitir2Open ? "▾" : "▸"}</span>
            </span>
          </button>

          {/* Options animadas: EMITIR DTE + EMITIR MASSDTE */}
          <div style={{
            overflow: "hidden",
            display: "flex", alignItems: "center", gap: 3,
            maxWidth: emitir2Open ? 240 : 0,
            opacity: emitir2Open ? 1 : 0,
            transform: emitir2Open ? "translateX(0)" : "translateX(-8px)",
            transition: "max-width .25s cubic-bezier(.22,1,.36,1), opacity .2s ease, transform .25s cubic-bezier(.22,1,.36,1)",
          }}>
            <button onClick={() => { setTab("emitir"); setEmitir2Open(false); setTimeout(() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "emitir", mode: "dte" } })), 50); }}
              style={{
                padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: "transparent", color: "var(--text2)", whiteSpace: "nowrap",
                transition: "all .2s",
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>EMITIR DTE</span>
            </button>
            <button onClick={() => { setTab("subir"); setEmitir2Open(false); }}
              style={{
                padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: tab === "subir" ? "rgba(232,85,62,.1)" : "transparent",
                color: tab === "subir" ? "#E8553E" : "var(--text2)", whiteSpace: "nowrap",
                transition: "all .2s",
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>EMITIR MASSDTE</span>
            </button>
          </div>

          {/* Visualizar — solo visible si hay boletas emitidas */}
          <button onClick={() => setTab("visualizar")}
            style={{
              padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", minWidth: 70,
              display: hasBoletas ? "flex" : "none",
              flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: tab === "visualizar" ? "rgba(232,85,62,.1)" : "transparent",
              color: tab === "visualizar" ? "#E8553E" : "var(--text2)",
              transition: "all .2s",
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span style={{fontSize:10,fontWeight:700,lineHeight:1.2,marginTop:2}}>Visualizar DTE</span>
          </button>
        </div>

        {/* TOP RIGHT CONTROLS */}
        <div style={{position:"fixed",top:22,right:24,zIndex:60,display:"flex",alignItems:"center",gap:8}}>
          <button onClick={() => { setEmpresaOpen(true); }}
            style={{width:38,height:38,borderRadius:10,border:"1px solid var(--header-border)",cursor:"pointer",background:"var(--header-bg)",backdropFilter:"blur(8px)",color:"var(--text2)",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
            <Buildings size={18} weight="bold" />
          </button>
          <button onClick={toggleTheme}
            style={{
              width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--header-border)", cursor: "pointer",
              background: "var(--header-bg)", backdropFilter: "blur(8px)",
              color: "var(--text2)", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, transition: "all .2s",
            }}>
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
        </div>

        {/* TAB CONTENT */}
        {tab === "dashboard" && <div style={{ padding: "84px 20px 20px" }}>{dashboardContent}</div>}
        {tab === "subir" && <div style={{ padding: "100px 24px 24px" }}>{subirContent}</div>}
        {tab === "revisar" && <div style={{ padding: "100px 24px 24px" }}>{revisarContent}</div>}
        {tab === "emitir" && <div style={{ padding: "100px 24px 24px" }}>{emitirContent}</div>}
        {tab === "visualizar" && <div style={{ padding: "100px 24px 24px" }}>{visualizarContent}</div>}

      </div>

      {empresaOpen && (
        <EmpresaPopup
          inicial={empresaInicial}
          tieneCertificado={empresaTieneCertificado}
          cafs={empresaCafs}
          empresaId={empresaId}
          onClose={() => setEmpresaOpen(false)}
        />
      )}
    </>
  );
}
