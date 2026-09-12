"use client";

import { Component, useState, useCallback, useEffect, type ErrorInfo, type ReactNode } from "react";
import type { WizardSemilla } from "./TeamConfigPanel";
import dynamic from "next/dynamic";

// Perf: el wizard de empresa (5 pasos, ~850 líneas) sale del bundle inicial y se
// precarga en idle 2s después de montar (ver effect abajo) — la primera apertura
// sigue siendo instantánea porque el chunk ya está en cache cuando alguien clickea.
const EmpresaPopup = dynamic(() => import("./EmpresaPopup"), { ssr: false });
// La guía (popup con playlist de animaciones) fuera del bundle inicial: solo se
// baja cuando se abre (primera vez o desde el toggle de empresa).
const GuiaPopup = dynamic(() => import("./GuiaPopup"), { ssr: false });
import { EmissionLockProvider, useEmissionLockStatus } from "./useEmissionLockStatus";
import { VersionDisponibleProvider } from "./version-disponible-context";
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
  empresaInicial, empresaCafs, empresaId, empresaEmisionConfig, devMode = false, wizardSemilla = null,
  versionDisponible,
}: {
  dashboardContent: React.ReactNode;
  empresaInicial: DatosEmisor;
  empresaCafs: CAFRow[];
  empresaId: string;
  empresaEmisionConfig: EmissionProviderState;
  devMode?: boolean;
  /** Team + selector de empresas ya cargados por la página: el wizard arranca sin fetch. */
  wizardSemilla?: WizardSemilla | null;
  /** Versión de la extensión VIVA en la tienda (derivada de telemetría en el server). */
  versionDisponible: string;
}) {
  const [empresaOpen, setEmpresaOpen] = useState(false);
  const [guiaOpen, setGuiaOpen] = useState(false);
  const [guiaFirstRun, setGuiaFirstRun] = useState(false);
  const [savedPulse, setSavedPulse] = useState<{ id: number; label: string } | null>(null);

  useEffect(() => {
    const h = () => setEmpresaOpen(v => !v);
    const abrir = () => setEmpresaOpen(true); // Emitir con emisor incompleto → wizard, paso Emisor
    window.addEventListener("toggle-empresa", h);
    window.addEventListener("abrir-empresa", abrir);
    return () => { window.removeEventListener("toggle-empresa", h); window.removeEventListener("abrir-empresa", abrir); };
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

  // La guía se abre SOLA la primera vez que alguien entra al escritorio. Señal
  // por navegador (localStorage): suficiente para el caso real (una máquina).
  // Después vive en el toggle de Empresa y se reabre desde ahí.
  useEffect(() => {
    if (window.localStorage.getItem("v5-guia-vista") !== "1") {
      setGuiaFirstRun(true);
      window.requestAnimationFrame(() => setGuiaOpen(true));
    }
  }, []);

  // Precarga en idle del chunk del wizard de empresa (dynamic import arriba):
  // 2s después de montar, cuando el escritorio ya está quieto, el navegador baja
  // el chunk en silencio. Abrir el popup después es instantáneo, igual que antes.
  useEffect(() => {
    const t = window.setTimeout(() => { void import("./EmpresaPopup"); }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  // Cerrar la guía: marca "vista" para que no vuelva a saltar sola al entrar.
  const cerrarGuia = useCallback(() => {
    setGuiaOpen(false);
    window.localStorage.setItem("v5-guia-vista", "1");
    setGuiaFirstRun(false);
  }, []);

  // Reabrir desde el toggle de Empresa: cierra el popup de empresa y abre la
  // guía sin el modo "primera vez" (la X cierra directo, sin despedida).
  const abrirGuia = useCallback(() => {
    setEmpresaOpen(false);
    setGuiaFirstRun(false);
    setGuiaOpen(true);
  }, []);

  return (
    <VersionDisponibleProvider value={versionDisponible}>
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

      {guiaOpen && <GuiaPopup firstRun={guiaFirstRun} onClose={cerrarGuia} />}

      {savedPulse && <SavedPulse key={savedPulse.id} label={savedPulse.label} />}

      {empresaOpen && (
        <EmpresaPopup
          inicial={empresaInicial}
          cafs={empresaCafs}
          empresaId={empresaId}
          emisionConfig={empresaEmisionConfig}
          semilla={wizardSemilla}
          devMode={devMode}
          onOpenGuia={abrirGuia}
          onClose={() => setEmpresaOpen(false)}
        />
      )}
      <BusinessEmissionLockBanner />
    </EmissionLockProvider>
    </VersionDisponibleProvider>
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
