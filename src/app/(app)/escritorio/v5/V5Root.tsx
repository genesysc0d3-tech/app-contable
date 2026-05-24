"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import EmpresaPopup from "./EmpresaPopup";
import type { DatosEmisor } from "../../empresa/actions";
import type { CAFRow } from "../../empresa/CAFPanel";

const TOP_TABS = [
  { id: "dashboard", label: "Dashboard", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  { id: "subidos", label: "Subidos", icon: "M12 5v14m-7-7l7-7 7 7" },
  { id: "revisar", label: "Revisar", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "emitir", label: "Emitir", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "boletas", label: "Boletas", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

export default function V5Root({
  dashboardContent, subidosContent, revisarContent, emitirContent, boletasContent,
  empresaInicial, empresaTieneCertificado, empresaCafs, empresaId,
}: {
  dashboardContent: React.ReactNode;
  subidosContent: React.ReactNode;
  revisarContent: React.ReactNode;
  emitirContent: React.ReactNode;
  boletasContent: React.ReactNode;
  empresaInicial: DatosEmisor;
  empresaTieneCertificado: boolean;
  empresaCafs: CAFRow[];
  empresaId: string;
}) {
  const [tab, setTab] = useState("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [empresaOpen, setEmpresaOpen] = useState(false);
  const router = useRouter();
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

  useEffect(() => {
    const h = () => setEmpresaOpen(v => !v);
    window.addEventListener("toggle-empresa", h);
    return () => window.removeEventListener("toggle-empresa", h);
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
  }, [theme, moveIndicator]);

  return (
    <>
      <style>{`
:root,[data-theme="dark"]{--bg:#0f1014;--surface:#16181d;--surface2:#1a1c24;--border:rgba(255,255,255,.06);--text:#e8eaf0;--text2:#636878;--text3:#4a4d55;--accent:#E8553E;--accent-light:rgba(232,85,62,.1);--green:#22c55e;--amber:#f59e0b;--blue:#5b9cf6;--bg-muted:rgba(255,255,255,.04);--shadow:rgba(0,0,0,.3);--header-bg:rgba(22,24,29,.15);--header-border:rgba(255,255,255,.04)}
[data-theme="light"]{--bg:#f5f0eb;--surface:#ffffff;--surface2:#faf7f3;--border:rgba(0,0,0,.08);--text:#1a1612;--text2:#8c8279;--text3:#b0a79e;--accent:#E8553E;--accent-light:rgba(232,85,62,.08);--green:#16a34a;--amber:#d97706;--blue:#3b82f6;--bg-muted:rgba(0,0,0,.04);--shadow:rgba(0,0,0,.08);--header-bg:rgba(255,255,255,.2);--header-border:rgba(0,0,0,.04)}
body{background:var(--bg);color:var(--text);transition:background .4s,color .4s}
.root-noise::before{position:absolute;top:0;left:0;width:100%;height:100%;content:'';opacity:.01;z-index:-1;pointer-events:none;background-image:url(https://www.ui-layouts.com/noise.gif)}
::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}
::view-transition-new(root){z-index:9999;clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%));animation:circle-expand .5s cubic-bezier(.22,1,.36,1) forwards}
@keyframes circle-expand{from{clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%))}to{clip-path:circle(150% at var(--click-x,50%) var(--click-y,50%))}}
::view-transition-old(root){z-index:1}
`}</style>

        <div className="root-noise" style={{ position: "relative", minHeight: "100vh", color: "var(--text)", fontFamily: "'DM Sans','Inter',sans-serif", transition: "background .4s,color .4s" }}>
        {/* TAB CONTENT */}
        {tab === "dashboard" && <div>{dashboardContent}</div>}
        {tab === "subidos" && <div style={{ padding: "20px 24px 24px" }}>{subidosContent}</div>}
        {tab === "revisar" && <div style={{ padding: "20px 24px 24px" }}>{revisarContent}</div>}
        {tab === "emitir" && <div style={{ padding: "20px 24px 24px" }}>{emitirContent}</div>}
        {tab === "boletas" && <div style={{ padding: "20px 24px 24px" }}>{boletasContent}</div>}
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
