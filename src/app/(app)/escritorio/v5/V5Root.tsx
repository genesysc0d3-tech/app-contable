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
  const [helpStepsEnabled, setHelpStepsEnabled] = useState(true);
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

  useEffect(() => {
    const saved = window.localStorage.getItem("v5-help-steps");
    if (saved === "off") setHelpStepsEnabled(false);
  }, []);

  const updateHelpSteps = useCallback((enabled: boolean) => {
    setHelpStepsEnabled(enabled);
    window.localStorage.setItem("v5-help-steps", enabled ? "on" : "off");
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

      {helpStepsEnabled && <DashboardHelpHarness onDisable={() => updateHelpSteps(false)} />}

      {empresaOpen && (
        <EmpresaPopup
          inicial={empresaInicial}
          tieneCertificado={empresaTieneCertificado}
          cafs={empresaCafs}
          empresaId={empresaId}
          helpStepsEnabled={helpStepsEnabled}
          onHelpStepsChange={updateHelpSteps}
          onClose={() => setEmpresaOpen(false)}
        />
      )}
    </>
  );
}

function DashboardHelpHarness({ onDisable }: { onDisable: () => void }) {
  const [markers, setMarkers] = useState<Array<{ n: number; left: number; top: number; width?: number; height?: number; group?: boolean }>>([]);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);
  const markersRef = useRef<Array<{ n: number; left: number; top: number; width?: number; height?: number; group?: boolean }>>([]);

  useEffect(() => {
    function getTargets() {
      const step1 = document.querySelector<HTMLElement>(".sparkle-button");
      const step1b = document.querySelector<HTMLElement>(".mass-sparkle-button");
      const tabButtons = Array.from(document.querySelectorAll<HTMLElement>(".tab-bar button"));
      return [[step1, step1b].filter(Boolean) as HTMLElement[], ...tabButtons.slice(0, 4)];
    }

    function positionMarkers() {
      const targets = getTargets();
      setMarkers(targets.flatMap((target, i) => {
        const n = i + 1;
        if (Array.isArray(target)) {
          if (target.length === 0) return [];
          const rects = target.map(el => el.getBoundingClientRect());
          const left = Math.min(...rects.map(r => r.left));
          const top = Math.min(...rects.map(r => r.top));
          const right = Math.max(...rects.map(r => r.right));
          const bottom = Math.max(...rects.map(r => r.bottom));
          return [{ n, left, top, width: right - left, height: bottom - top, group: true }];
        }
        if (!target) return [];
        const rect = target.getBoundingClientRect();
        return [{ n, left: rect.left + rect.width / 2, top: rect.top, width: rect.width, height: rect.height }];
      }));
    }

    const cleanups: Array<() => void> = [];
    getTargets().forEach((target, i) => {
      const step = i + 1;
      const elements = Array.isArray(target) ? target : [target];
      elements.forEach(el => {
        if (!el) return;
        const enter = () => setHoveredStep(step);
        const leave = () => setHoveredStep(current => current === step ? null : current);
        el.addEventListener("mouseenter", enter);
        el.addEventListener("mouseleave", leave);
        el.addEventListener("focus", enter);
        el.addEventListener("blur", leave);
        cleanups.push(() => {
          el.removeEventListener("mouseenter", enter);
          el.removeEventListener("mouseleave", leave);
          el.removeEventListener("focus", enter);
          el.removeEventListener("blur", leave);
        });
      });
    });

    positionMarkers();
    const id = window.setInterval(positionMarkers, 300);
    window.addEventListener("resize", positionMarkers);
    window.addEventListener("scroll", positionMarkers, true);
    return () => {
      cleanups.forEach(cleanup => cleanup());
      window.clearInterval(id);
      window.removeEventListener("resize", positionMarkers);
      window.removeEventListener("scroll", positionMarkers, true);
    };
  }, []);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const found = markersRef.current.find((m) => {
        const width = m.group ? (m.width ?? 0) + 10 : (m.width ?? 0);
        const height = m.group ? (m.height ?? 0) + 10 : (m.height ?? 0);
        const left = m.group ? m.left - 5 : m.left - width / 2;
        const top = m.group ? m.top - 5 : m.top;
        return e.clientX >= left && e.clientX <= left + width && e.clientY >= top && e.clientY <= top + height;
      });
      setHoveredStep(found?.n ?? null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none" }}>
      <style>{`
        .v5-help-step-badge{transition:opacity .16s ease,background .16s ease,border-color .16s ease;color .16s ease;pointer-events:none}
      `}</style>
      <button
        type="button"
        onClick={onDisable}
        aria-label="Quitar ayuda de pasos"
        style={{ position: "fixed", left: 22, bottom: 22, zIndex: 72, pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 999, border: "1px solid rgba(232,85,62,.36)", background: "rgba(15,16,20,.72)", color: "rgba(255,255,255,.88)", boxShadow: "0 14px 36px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", cursor: "pointer", fontSize: 10, fontWeight: 850, letterSpacing: ".01em" }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(232,85,62,.16)", color: "#E8553E", fontSize: 13, lineHeight: 1, fontWeight: 900 }}>×</span>
        <span>Quitar ayuda</span>
      </button>
      {markers.map((m) => (
        <div key={m.n}>
          {m.group && (
            <div style={{ position: "fixed", left: m.left - 6, top: m.top - 6, width: (m.width ?? 0) + 12, height: (m.height ?? 0) + 12, borderRadius: 16, border: `2px dashed ${hoveredStep === m.n ? "rgba(232,85,62,.95)" : "rgba(232,85,62,.58)"}`, opacity: hoveredStep === m.n ? 1 : .72, background: hoveredStep === m.n ? "rgba(232,85,62,.045)" : "rgba(232,85,62,.018)", boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.09)" : "0 0 0 3px rgba(232,85,62,.035)", transition: "opacity .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease", pointerEvents: "none" }} />
          )}
          {m.group ? (
            <span className="v5-help-step-badge" style={{ position: "fixed", left: m.left, top: m.top, transform: "translate(-50%, -18px)", width: 30, height: 30, borderRadius: 999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, background: hoveredStep === m.n ? "#E8553E" : "rgba(232,85,62,.18)", color: hoveredStep === m.n ? "#fff" : "#E8553E", opacity: hoveredStep === m.n ? 1 : .42, border: `1px solid ${hoveredStep === m.n ? "rgba(255,255,255,.92)" : "rgba(232,85,62,.62)"}`, boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.16), 0 8px 18px rgba(0,0,0,.22)" : "0 0 0 3px rgba(232,85,62,.07)", fontVariantNumeric: "tabular-nums", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
              <span style={{ fontSize: 6, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", letterSpacing: ".03em" }}>Paso</span>
              <span style={{ fontSize: 11, fontWeight: 950, lineHeight: 1 }}>{m.n}</span>
            </span>
          ) : (
            <span className="v5-help-step-badge" style={{ position: "fixed", left: m.left, top: m.top, transform: "translate(-50%, -24px)", width: 30, height: 30, borderRadius: 999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, background: hoveredStep === m.n ? "#E8553E" : "rgba(232,85,62,.18)", color: hoveredStep === m.n ? "#fff" : "#E8553E", opacity: hoveredStep === m.n ? 1 : .42, border: `1px solid ${hoveredStep === m.n ? "rgba(255,255,255,.92)" : "rgba(232,85,62,.62)"}`, boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.16), 0 8px 18px rgba(0,0,0,.22)" : "0 0 0 3px rgba(232,85,62,.07)", fontVariantNumeric: "tabular-nums", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
              <span style={{ fontSize: 6, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", letterSpacing: ".03em" }}>Paso</span>
              <span style={{ fontSize: 11, fontWeight: 950, lineHeight: 1 }}>{m.n}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
