"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const TOP_TABS = [
  { id: "dashboard", label: "Dashboard", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  { id: "subidos", label: "Subidos", icon: "M12 5v14m-7-7l7-7 7 7" },
  { id: "revisar", label: "Revisar", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "emitir", label: "Emitir", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "boletas", label: "Boletas", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

export default function V5Root({
  dashboardContent, subidosContent, revisarContent, emitirContent, boletasContent,
}: {
  dashboardContent: React.ReactNode;
  subidosContent: React.ReactNode;
  revisarContent: React.ReactNode;
  emitirContent: React.ReactNode;
  boletasContent: React.ReactNode;
}) {
  const [tab, setTab] = useState("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mountedRef = useRef(false);

  const moveIndicator = useCallback(() => {
    const idx = TOP_TABS.findIndex(t => t.id === tab);
    const btn = btnRefs.current[idx];
    const bar = barRef.current;
    const indicator = indicatorRef.current;
    if (!btn || !bar || !indicator) return;
    const barRect = bar.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    indicator.style.left = (btnRect.left - barRect.left) + "px";
    indicator.style.width = btnRect.width + "px";
  }, [tab]);

  // Position indicator on mount and tab change
  useEffect(() => { moveIndicator(); }, [moveIndicator]);

  // Enable transition only after first paint to avoid FOUC animation
  useEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    mountedRef.current = true;
    // Small RAF delay ensures the indicator has been positioned at (0,0)
    requestAnimationFrame(() => {
      indicator.style.transition = "left .35s cubic-bezier(.22,1,.36,1), width .35s cubic-bezier(.22,1,.36,1)";
      moveIndicator();
    });
  }, [moveIndicator]);

  // Resize handler
  useEffect(() => {
    window.addEventListener("resize", moveIndicator);
    return () => window.removeEventListener("resize", moveIndicator);
  }, [moveIndicator]);

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
  }, [theme, moveIndicator]);

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
`}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'DM Sans','Inter',sans-serif", transition: "background .4s,color .4s" }}>
        {/* GLASS HEADER WITH SLIDING PILL */}
        <div ref={barRef} style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50,
          display: "flex", alignItems: "center", gap: 3,
          background: "var(--header-bg)", backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRadius: 16, padding: "5px 6px",
          border: "1px solid var(--header-border)",
          boxShadow: "0 4px 24px var(--shadow)",
          transition: "background .4s,border .4s,box-shadow .4s",
        }}>
          {TOP_TABS.map((t, i) => {
            const active = t.id === tab;
            return (
              <button key={t.id} ref={el => { btnRefs.current[i] = el; }}
                onClick={() => setTab(t.id)}
                style={{
                  position: "relative", zIndex: 2,
                  padding: "8px 16px", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: active ? 600 : 500,
                  display: "flex", alignItems: "center", gap: 6,
                  background: "transparent",
                  color: active ? "#fff" : "var(--text2)",
                  transition: "color .25s",
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={t.icon} />
                </svg>
                {t.label}
              </button>
            );
          })}
          {/* SLIDING PILL INDICATOR — transition added by JS after mount */}
          <div ref={indicatorRef} style={{
            position: "absolute", top: 5, zIndex: 1,
            height: "calc(100% - 10px)", borderRadius: 10,
            background: "var(--accent)",
            boxShadow: "0 2px 12px rgba(232,85,62,.35)",
          }} />
        </div>

        {/* THEME TOGGLE */}
        <button onClick={toggleTheme}
          style={{
            position: "fixed", top: 22, right: 24, zIndex: 60,
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

        {/* TAB CONTENT */}
        {tab === "dashboard" && <div>{dashboardContent}</div>}
        {tab === "subidos" && <div style={{ padding: "100px 24px 24px" }}>{subidosContent}</div>}
        {tab === "revisar" && <div style={{ padding: "100px 24px 24px" }}>{revisarContent}</div>}
        {tab === "emitir" && <div style={{ padding: "100px 24px 24px" }}>{emitirContent}</div>}
        {tab === "boletas" && <div style={{ padding: "100px 24px 24px" }}>{boletasContent}</div>}
      </div>
    </>
  );
}
