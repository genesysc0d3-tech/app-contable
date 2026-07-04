"use client";

import { Component, useState, useCallback, useRef, useEffect, type ErrorInfo, type ReactNode } from "react";
import EmpresaPopup from "./EmpresaPopup";
import { EmissionLockProvider, useEmissionLockStatus } from "./useEmissionLockStatus";
import type { DatosEmisor } from "../../empresa/actions";
import type { CAFRow } from "../../empresa/CAFPanel";
import type { EmissionProviderState } from "../../empresa/EmissionProviderConfig";

class TabErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: string | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Error inesperado" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[massdte-tab-error]", this.props.label, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: 360, display: "grid", placeItems: "center", padding: 24, color: "var(--text2)", textAlign: "center" }}>
          <div style={{ maxWidth: 320 }}>
            <div style={{ fontSize: 15, fontWeight: 850, color: "var(--text)", letterSpacing: "-.025em" }}>No se pudo cargar {this.props.label}</div>
            <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45 }}>{this.state.error}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function V5Root({
  dashboardContent,
  empresaInicial, empresaCafs, empresaId, empresaEmisionConfig, devMode = false,
}: {
  dashboardContent: React.ReactNode;
  empresaInicial: DatosEmisor;
  empresaCafs: CAFRow[];
  empresaId: string;
  empresaEmisionConfig: EmissionProviderState;
  devMode?: boolean;
}) {
  const [empresaOpen, setEmpresaOpen] = useState(false);
  const [helpStepsEnabled, setHelpStepsEnabled] = useState(true);
  const [savedPulse, setSavedPulse] = useState<{ id: number; label: string } | null>(null);

  useEffect(() => {
    const h = () => setEmpresaOpen(v => !v);
    window.addEventListener("toggle-empresa", h);
    return () => window.removeEventListener("toggle-empresa", h);
  }, []);

  useEffect(() => {
    function handleSaved(e: Event) {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label ?? "Información guardada";
      const id = Date.now();
      setSavedPulse({ id, label });
      window.setTimeout(() => {
        setSavedPulse((current) => current?.id === id ? null : current);
      }, 1500);
    }

    window.addEventListener("v5-popup-saved", handleSaved);
    return () => window.removeEventListener("v5-popup-saved", handleSaved);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("v5-help-steps");
    if (saved === "off") {
      window.requestAnimationFrame(() => setHelpStepsEnabled(false));
    }
  }, []);

  const updateHelpSteps = useCallback((enabled: boolean) => {
    setHelpStepsEnabled(enabled);
    window.localStorage.setItem("v5-help-steps", enabled ? "on" : "off");
  }, []);

  return (
    <EmissionLockProvider>
      <style>{`
:root{--bg:#f5f0eb;--surface:#ffffff;--surface2:#faf7f3;--border:rgba(0,0,0,.08);--text:#1a1612;--text2:#6f6659;--text3:#8b8275;--accent:#E8553E;--accent-light:rgba(232,85,62,.08);--green:#16a34a;--amber:#d97706;--red:#dc2626;--blue:#2563eb;--lime:#4d7c0f;--bg-muted:rgba(0,0,0,.04);--shadow:rgba(0,0,0,.08);--header-bg:rgba(255,255,255,.2);--header-border:rgba(0,0,0,.04)}
.dark{--bg:#0f1014;--surface:#16181d;--surface2:#1a1c24;--border:rgba(255,255,255,.06);--text:#e8eaf0;--text2:#8b92a3;--text3:#697080;--accent:#E8553E;--accent-light:rgba(232,85,62,.1);--green:#22c55e;--amber:#f59e0b;--red:#ef4444;--blue:#5b9cf6;--lime:#b4f027;--bg-muted:rgba(255,255,255,.04);--shadow:rgba(0,0,0,.3);--header-bg:rgba(22,24,29,.15);--header-border:rgba(255,255,255,.04)}
body{background:var(--bg);color:var(--text);transition:background .4s,color .4s}
::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}
::view-transition-new(root){z-index:9999;clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%));animation:circle-expand .5s cubic-bezier(.22,1,.36,1) forwards}
@keyframes circle-expand{from{clip-path:circle(0 at var(--click-x,50%) var(--click-y,50%))}to{clip-path:circle(150% at var(--click-x,50%) var(--click-y,50%))}}
::view-transition-old(root){z-index:1}
@keyframes saved-pop{0%{opacity:0;transform:translate(-50%,14px) scale(.92);filter:blur(3px)}18%{opacity:1;transform:translate(-50%,0) scale(1.02);filter:blur(0)}72%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-10px) scale(.98)}}
@keyframes saved-ring{0%{transform:scale(.45);opacity:.9}100%{transform:scale(1.9);opacity:0}}
`}</style>

      <div style={{ position: "relative", minHeight: "100vh", color: "var(--text)", fontFamily: "var(--font-geist-sans), sans-serif", transition: "background .4s,color .4s" }}>
        <TabErrorBoundary label="Dashboard">
          <div>{dashboardContent}</div>
        </TabErrorBoundary>
      </div>

      {helpStepsEnabled && <DashboardHelpHarness onDisable={() => updateHelpSteps(false)} />}

      {savedPulse && <SavedPulse key={savedPulse.id} label={savedPulse.label} />}

      {empresaOpen && (
        <EmpresaPopup
          inicial={empresaInicial}
          cafs={empresaCafs}
          empresaId={empresaId}
          emisionConfig={empresaEmisionConfig}
          devMode={devMode}
          helpStepsEnabled={helpStepsEnabled}
          onHelpStepsChange={updateHelpSteps}
          onClose={() => setEmpresaOpen(false)}
        />
      )}
      <BusinessEmissionLockBanner />
    </EmissionLockProvider>
  );
}

function BusinessEmissionLockBanner() {
  const { activeLock, businessMode, lockMessage } = useEmissionLockStatus();

  if (!businessMode || !activeLock || activeLock.is_mine) return null;

  return (
    <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 96, width: "min(520px, calc(100vw - 28px))", pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(245,158,11,.24)", background: "rgba(24,20,12,.86)", color: "var(--amber)", boxShadow: "0 18px 48px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <span style={{ width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(245,158,11,.14)", border: "1px solid rgba(245,158,11,.22)", flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4" /><path d="M12 18v4" /><path d="m4.93 4.93 2.83 2.83" /><path d="m16.24 16.24 2.83 2.83" /><path d="M2 12h4" /><path d="M18 12h4" /><path d="m4.93 19.07 2.83-2.83" /><path d="m16.24 7.76 2.83-2.83" /></svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>Equipo</div>
          <div style={{ fontSize: 11, fontWeight: 750, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lockMessage}</div>
        </div>
      </div>
    </div>
  );
}

function SavedPulse({ label }: { label: string }) {
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 34, zIndex: 95, transform: "translateX(-50%)", animation: "saved-pop 1.45s cubic-bezier(.22,1,.36,1) both", pointerEvents: "none" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px 10px 10px", borderRadius: 999, background: "rgba(22,24,29,.86)", border: "1px solid rgba(34,197,94,.28)", color: "rgba(255,255,255,.92)", boxShadow: "0 18px 50px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.08)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", fontSize: 11, fontWeight: 850 }}>
        <span style={{ position: "relative", width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(34,197,94,.16)", color: "var(--green)", flexShrink: 0 }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: 999, border: "1px solid rgba(34,197,94,.45)", animation: "saved-ring .9s ease-out both" }} />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ position: "relative" }}><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <span>{label}</span>
      </div>
    </div>
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
        .v5-help-step-badge{transition:opacity .16s ease,background .16s ease,border-color .16s ease,color .16s ease;pointer-events:none}
      `}</style>
      <button
        type="button"
        onClick={onDisable}
        aria-label="Quitar ayuda de pasos"
        style={{ position: "fixed", left: 22, bottom: 22, zIndex: 72, pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 999, border: "1px solid rgba(232,85,62,.36)", background: "rgba(15,16,20,.72)", color: "rgba(255,255,255,.88)", boxShadow: "0 14px 36px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", cursor: "pointer", fontSize: 10, fontWeight: 850, letterSpacing: ".01em" }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(232,85,62,.16)", color: "var(--accent)", fontSize: 13, lineHeight: 1, fontWeight: 900 }}>×</span>
        <span>Quitar ayuda</span>
      </button>
      {markers.map((m) => (
        <div key={m.n}>
          {m.group && (
            <div style={{ position: "fixed", left: m.left - 6, top: m.top - 6, width: (m.width ?? 0) + 12, height: (m.height ?? 0) + 12, borderRadius: 16, border: `2px dashed ${hoveredStep === m.n ? "rgba(232,85,62,.95)" : "rgba(232,85,62,.58)"}`, opacity: hoveredStep === m.n ? 1 : .72, background: hoveredStep === m.n ? "rgba(232,85,62,.045)" : "rgba(232,85,62,.018)", boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.09)" : "0 0 0 3px rgba(232,85,62,.035)", transition: "opacity .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease", pointerEvents: "none" }} />
          )}
          {m.group ? (
            <span className="v5-help-step-badge" style={{ position: "fixed", left: m.left, top: m.top, transform: "translate(-50%, -18px)", width: 30, height: 30, borderRadius: 999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, background: hoveredStep === m.n ? "var(--accent)" : "rgba(232,85,62,.18)", color: hoveredStep === m.n ? "#fff" : "var(--accent)", opacity: hoveredStep === m.n ? 1 : .42, border: `1px solid ${hoveredStep === m.n ? "rgba(255,255,255,.92)" : "rgba(232,85,62,.62)"}`, boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.16), 0 8px 18px rgba(0,0,0,.22)" : "0 0 0 3px rgba(232,85,62,.07)", fontVariantNumeric: "tabular-nums", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
              <span style={{ fontSize: 6, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", letterSpacing: ".03em" }}>Paso</span>
              <span style={{ fontSize: 11, fontWeight: 950, lineHeight: 1 }}>{m.n}</span>
            </span>
          ) : (
            <span className="v5-help-step-badge" style={{ position: "fixed", left: m.left, top: m.top, transform: "translate(-50%, -24px)", width: 30, height: 30, borderRadius: 999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, background: hoveredStep === m.n ? "var(--accent)" : "rgba(232,85,62,.18)", color: hoveredStep === m.n ? "#fff" : "var(--accent)", opacity: hoveredStep === m.n ? 1 : .42, border: `1px solid ${hoveredStep === m.n ? "rgba(255,255,255,.92)" : "rgba(232,85,62,.62)"}`, boxShadow: hoveredStep === m.n ? "0 0 0 4px rgba(232,85,62,.16), 0 8px 18px rgba(0,0,0,.22)" : "0 0 0 3px rgba(232,85,62,.07)", fontVariantNumeric: "tabular-nums", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
              <span style={{ fontSize: 6, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", letterSpacing: ".03em" }}>Paso</span>
              <span style={{ fontSize: 11, fontWeight: 950, lineHeight: 1 }}>{m.n}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
