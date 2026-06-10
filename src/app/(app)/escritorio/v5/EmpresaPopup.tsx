"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import EmisorForm from "../../empresa/EmisorForm";
import CAFPanel, { type CAFRow } from "../../empresa/CAFPanel";
import AiKeyConfig from "../../empresa/AiKeyConfig";
import EmissionProviderConfig, { type EmissionProviderState } from "../../empresa/EmissionProviderConfig";
import EmpresaFormatoCartola from "../../empresa/EmpresaFormatoCartola";
import type { DatosEmisor } from "../../empresa/actions";

export default function EmpresaPopup({
  inicial,
  cafs,
  empresaId,
  emisionConfig,
  devMode = false,
  helpStepsEnabled,
  onHelpStepsChange,
  onClose,
}: {
  inicial: DatosEmisor;
  cafs: CAFRow[];
  empresaId: string;
  emisionConfig: EmissionProviderState;
  devMode?: boolean;
  helpStepsEnabled?: boolean;
  onHelpStepsChange?: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { router.refresh(); }, [router]); // Refresh server data on mount

  const handleClose = useCallback(() => {
    // Auto-save EmisorForm before closing
    if (step === 0) {
      const form = document.getElementById("empresa-emisor-form") as HTMLFormElement | null;
      form?.requestSubmit();
    }
    window.dispatchEvent(new CustomEvent("v5-popup-saved", { detail: { label: "Empresa guardada" } }));
    onClose();
  }, [step, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const goToStep = useCallback((i: number) => {
    // Auto-save EmisorForm before leaving step 0
    if (step === 0) {
      const form = document.getElementById("empresa-emisor-form") as HTMLFormElement | null;
      form?.requestSubmit();
    }
    setStep(i);
  }, [step]);

  return (
    <>
      <style>{`
        .ep-background-app {
          position: fixed;
          inset: 0;
          display: grid;
          grid-template-columns: 240px 1fr;
          opacity: 0.38;
          filter: blur(1.8px);
          pointer-events: none;
          background:
            radial-gradient(circle at 8% 8%, rgba(232, 85, 62, 0.12), transparent 28%),
            radial-gradient(circle at 84% 14%, rgba(101, 184, 255, 0.10), transparent 32%),
            #070d15;
        }

        .ep-fake-sidebar {
          background: rgba(5, 9, 15, 0.9);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          padding: 28px 18px;
        }

        .ep-fake-logo {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          background: linear-gradient(145deg, #E8553E, #cd5832);
          box-shadow: 0 0 32px rgba(232, 85, 62, 0.28);
          margin-bottom: 38px;
        }

        .ep-fake-line {
          height: 42px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.045);
          border: 1px solid rgba(255, 255, 255, 0.04);
          margin-bottom: 12px;
        }

        .ep-fake-main {
          padding: 28px;
          background: linear-gradient(180deg, rgba(8, 14, 24, 0.7), rgba(8, 14, 24, 0.95));
        }

        .ep-fake-card {
          height: 130px;
          max-width: 760px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.035);
          border-radius: 22px;
          margin: 72px 0 18px;
        }

        .ep-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: grid;
          place-items: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.58);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: epFadeIn .2s ease both;
        }

        @keyframes epFadeIn { from { opacity: 0; } to { opacity: 1; } }

        .ep-modal {
          width: min(1100px, 96vw);
          height: min(780px, 88vh);
          overflow: hidden;
          border-radius: 20px;
          border: 1px solid var(--border);
          background: var(--surface);
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45), inset 0 1px 0 var(--border);
          display: grid;
          grid-template-columns: 280px 1fr;
          color: var(--text);
        }

        .ep-wizard {
          border-right: 1px solid var(--border);
          background: var(--surface);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-height: 0;
          position: relative;
          overflow-y: auto;
          scrollbar-width: thin;
        }

        .ep-step-card {
          min-height: 64px;
          display: grid;
          grid-template-columns: 28px 20px 1fr;
          gap: 10px;
          align-items: center;
          padding: 12px 10px;
          border-radius: 12px;
          border: 1px solid transparent;
          color: var(--text2);
          background: var(--bg-muted);
          position: relative;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            transform 160ms ease,
            color 160ms ease,
            box-shadow 160ms ease;
        }

        .ep-step-card + .ep-step-card::before {
          content: "";
          position: absolute;
          left: 38px;
          top: -7px;
          width: 1px;
          height: 6px;
          background: var(--border);
        }

        .ep-step-card:hover {
          color: var(--text);
          background: var(--bg-muted);
          border-color: var(--border);
          transform: translateY(-1px);
        }

        .ep-step-card.active {
          color: #ffffff;
          background:
            radial-gradient(circle at 20% 20%, rgba(232, 85, 62, 0.30), transparent 60%),
            linear-gradient(135deg, rgba(232, 85, 62, 0.50), rgba(232, 85, 62, 0.18));
          border-color: rgba(232, 85, 62, 0.48);
          box-shadow:
            0 18px 40px rgba(232, 85, 62, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
        }

        .ep-step-number {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: var(--surface2, var(--bg-muted));
          color: var(--text2);
          font-weight: 760;
          font-size: 11px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .ep-step-card.active .ep-step-number {
          background: rgba(255, 255, 255, 0.16);
          color: #ffffff;
        }

        .ep-step-icon {
          width: 20px;
          height: 20px;
          color: currentColor;
          opacity: 0.92;
        }

        .ep-step-title {
          font-size: 12px;
          font-weight: 650;
          margin-bottom: 1px;
          letter-spacing: -0.01em;
          color: currentColor;
        }

        .ep-step-subtitle {
          font-size: 10px;
          line-height: 1.2;
          color: var(--text2);
        }

        .ep-help-box {
          margin-top: auto;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--bg-muted);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
        }

        .ep-help-icon {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, #E8553E, #cd5832);
          color: var(--text);
          font-weight: 900;
          margin-bottom: 8px;
          font-size: 12px;
          box-shadow: 0 12px 26px rgba(232, 85, 62, 0.32);
        }

        .ep-help-title {
          font-weight: 650;
          font-size: 12px;
          margin-bottom: 4px;
          color: #ffffff;
        }

        .ep-help-text {
          color: var(--text2);
          font-size: 11px;
          line-height: 1.4;
          margin-bottom: 10px;
        }

        .ep-help-link {
          color: #E8553E;
          font-size: 11px;
          font-weight: 650;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .ep-help-toggle {
          width: 100%;
          padding: 8px 9px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 10px;
          font-weight: 760;
          transition: border-color .16s ease, background .16s ease, color .16s ease;
        }

        .ep-help-toggle:hover {
          border-color: rgba(232, 85, 62, 0.38);
          background: rgba(232, 85, 62, 0.06);
          color: #E8553E;
        }

        .ep-help-switch {
          width: 30px;
          height: 16px;
          padding: 2px;
          border-radius: 999px;
          background: var(--bg-muted);
          border: 1px solid var(--border);
          flex-shrink: 0;
        }

        .ep-help-switch-dot {
          display: block;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--text3);
          transition: transform .18s ease, background .18s ease;
        }

        .ep-help-toggle.active .ep-help-switch {
          background: rgba(232, 85, 62, 0.14);
          border-color: rgba(232, 85, 62, 0.34);
        }

        .ep-help-toggle.active .ep-help-switch-dot {
          transform: translateX(14px);
          background: #E8553E;
        }

        .ep-main-panel {
          min-width: 0;
          display: grid;
          grid-template-rows: auto 1fr auto;
          max-height: min(780px, 88vh);
        }

        .ep-modal-header {
          min-height: 72px;
          padding: 18px 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          border-bottom: 1px solid var(--border);
        }

        .ep-header-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, rgba(232, 85, 62, 0.92), rgba(232, 85, 62, 0.42));
          border: 1px solid rgba(232, 85, 62, 0.32);
          box-shadow:
            0 18px 40px rgba(232, 85, 62, 0.20),
            inset 0 1px 0 rgba(255, 255, 255, 0.16);
          color: #fff;
          flex-shrink: 0;
        }

        .ep-header-icon svg {
          width: 24px;
          height: 24px;
        }

        .ep-header-text {
          flex: 1;
          min-width: 0;
        }

        .ep-modal-header h1 {
          margin: 0;
          font-size: 22px;
          line-height: 1.1;
          letter-spacing: -0.04em;
          font-weight: 780;
          color: var(--text);
        }

        .ep-subtitle {
          margin: 4px 0 0;
          color: var(--text2);
          font-size: 12px;
        }

        .ep-close-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-muted);
          color: var(--text2);
          font-size: 30px;
          line-height: 1;
          cursor: pointer;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            color 160ms ease;
        }

        .ep-close-btn:hover {
          background: var(--surface);
          border-color: var(--border);
          color: var(--text);
        }

        .ep-content {
          overflow: auto;
          padding: 24px 32px 28px;
          scrollbar-width: thin;
          scrollbar-color: rgba(160, 170, 185, 0.32) transparent;
        }

        .ep-main-panel.step-emisor {
          max-height: min(820px, 92vh);
        }

        .ep-modal:has(.ep-main-panel.step-emisor) {
          height: min(820px, 92vh);
        }

        .ep-main-panel.step-emisor .ep-modal-header {
          min-height: 60px;
          padding: 12px 18px;
          gap: 10px;
        }

        .ep-main-panel.step-emisor .ep-header-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
        }

        .ep-main-panel.step-emisor .ep-header-icon svg {
          width: 19px;
          height: 19px;
        }

        .ep-main-panel.step-emisor .ep-modal-header h1 {
          font-size: 18px;
        }

        .ep-main-panel.step-emisor .ep-subtitle {
          margin-top: 2px;
          font-size: 11px;
        }

        .ep-main-panel.step-emisor .ep-content {
          overflow: auto;
          padding: 12px 18px;
        }

        .ep-main-panel.step-emisor .ep-main-footer {
          min-height: 46px;
          padding: 7px 16px;
        }

        .ep-content-inner {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .ep-content-inner > div {
          padding: 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }

        .ep-main-footer {
          min-height: 56px;
          padding: 10px 20px;
          border-top: 1px solid var(--border);
          background: var(--surface);
          display: flex;
          gap: 12px;
        }

        .ep-main-footer > div {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .ep-footer-btn {
          min-width: 100px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-muted);
          color: var(--text);
          font-size: 14px;
          font-weight: 760;
          cursor: pointer;
          transition:
            transform 160ms ease,
            filter 160ms ease,
            background 160ms ease,
            border-color 160ms ease;
        }

        .ep-footer-btn:hover {
          background: var(--surface);
          border-color: var(--border);
          transform: translateY(-1px);
        }

        .ep-footer-btn.primary {
          min-width: 150px;
          border-color: rgba(232, 85, 62, 0.55);
          background: linear-gradient(135deg, #E8553E, #cd5832);
          box-shadow:
            0 16px 34px rgba(232, 85, 62, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }

        .ep-footer-btn.primary:hover {
          filter: brightness(1.08);
        }

        @media (max-width: 1040px) {
          .ep-background-app {
            display: none;
          }

          .ep-overlay {
            position: static;
            min-height: 100vh;
            padding: 14px;
          }

          .ep-modal {
            grid-template-columns: 1fr;
            width: 100%;
            height: auto;
            min-height: calc(100vh - 28px);
            max-height: none;
          }

          .ep-wizard {
            display: none;
          }

          .ep-main-panel {
            max-height: none;
          }

          .ep-content {
            overflow: visible;
          }
        }

        @media (max-width: 720px) {
          .ep-modal-header {
            padding: 14px;
          }

          .ep-header-icon {
            width: 38px;
            height: 38px;
          }

          .ep-modal-header h1 {
            font-size: 18px;
          }

          .ep-content {
            padding: 12px;
          }

          .ep-content-inner > div {
            padding: 14px;
          }

          .ep-main-footer {
            flex-direction: column;
          }

          .ep-main-footer > div {
            width: 100%;
            flex-direction: column;
          }

          .ep-footer-btn,
          .ep-footer-btn.primary {
            width: 100%;
          }
        }
      `}</style>

      <div className="ep-background-app">
        <aside className="ep-fake-sidebar">
          <div className="ep-fake-logo"></div>
          <div className="ep-fake-line"></div>
          <div className="ep-fake-line"></div>
          <div className="ep-fake-line"></div>
          <div className="ep-fake-line"></div>
        </aside>

        <main className="ep-fake-main">
          <div className="ep-fake-card"></div>
          <div className="ep-fake-card" style={{ maxWidth: 620, height: 96 }}></div>
          <div className="ep-fake-card" style={{ maxWidth: 840, height: 140 }}></div>
        </main>
      </div>

      <div className="ep-overlay">
        <section
          ref={ref}
          className="ep-modal"
          aria-label="Configuración de empresa"
        >
          <aside className="ep-wizard" aria-label="Pasos de configuración">
            {[
              {
                n: 1,
                icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
                title: "Emisor",
                sub: "Datos de tu empresa",
              },
              {
                n: 2,
                icon: "M7 3h7l4 4v14H7V3Z",
                title: "Formatos de cartola",
                sub: "Sube y mapea formatos",
              },
              {
                n: 3,
                icon: "M4 7h16v12H4V7Z",
                title: "Folios CAF",
                sub: "Gestión automática",
              },
              {
                n: 4,
                icon: "M4 7h16M7 4v16M17 4v16M4 17h16",
                title: "Emisión",
                sub: "Modo de prueba o SII local",
              },
              {
                n: 5,
                icon: "M14.5 4.5 19.5 9.5M3 21l5.2-1.2L20 8a3.5 3.5 0 0 0-5-5L3.2 14.8 3 21Z",
                title: "IA (DeepSeek)",
                sub: "Clave de API",
              },
            ].map((s, i) => (
              <div
                key={i}
                className={`ep-step-card${step === i ? " active" : ""}`}
                onClick={() => goToStep(i)}
                style={{ cursor: "pointer" }}
              >
                <div className="ep-step-number">{s.n}</div>
                <svg className="ep-step-icon" viewBox="0 0 24 24" fill="none">
                  <path
                    d={s.icon}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <div className="ep-step-title">{s.title}</div>
                  <div className="ep-step-subtitle">{s.sub}</div>
                </div>
              </div>
            ))}

            <div className="ep-help-box">
              <div className="ep-help-icon">?</div>
              <div className="ep-help-title">¿Necesitas ayuda?</div>
              <div className="ep-help-text">
                Mostramos números sobre el dashboard para seguir el flujo.
              </div>
              <button
                type="button"
                className={`ep-help-toggle${helpStepsEnabled ? " active" : ""}`}
                aria-pressed={Boolean(helpStepsEnabled)}
                onClick={() => onHelpStepsChange?.(!helpStepsEnabled)}
              >
                <span>{helpStepsEnabled ? "Quitar pasos" : "Mostrar pasos"}</span>
                <span className="ep-help-switch" aria-hidden="true">
                  <span className="ep-help-switch-dot" />
                </span>
              </button>
            </div>
          </aside>

          <main className={`ep-main-panel${step === 0 ? " step-emisor" : ""}`}>
            <header className="ep-modal-header">
              <div className="ep-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2M3 21h18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="ep-header-text">
                <h1>Empresa</h1>
                <p className="ep-subtitle">Configuración inicial de tu empresa.</p>
              </div>

              <button className="ep-close-btn" onClick={handleClose} aria-label="Cerrar">
                ×
              </button>
            </header>

            <div className="ep-content">
              <div className="ep-content-inner">
                {[
                  { key: "emisor", content: <EmisorForm inicial={inicial} variant="popup" /> },
                  { key: "formatos", content: <EmpresaFormatoCartola empresaId={empresaId} /> },
                  { key: "folios", content: <CAFPanel cafs={cafs} proveedor={emisionConfig.boletasProveedor} /> },
                  { key: "emision", content: <EmissionProviderConfig inicial={emisionConfig} devMode={devMode} /> },
                  { key: "ia", content: <AiKeyConfig /> },
                ].map((s, i) => (
                  <div key={s.key} ref={el => { sectionRefs.current[i] = el; }} style={{ display: i === step ? "block" : "none" }}>
                    {s.content}
                  </div>
                ))}
              </div>
            </div>

            <footer className="ep-main-footer" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8 }}>
                {step > 0 && (
                  <button className="ep-footer-btn" onClick={() => goToStep(step - 1)}>
                    ‹ Anterior
                  </button>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="ep-footer-btn" onClick={handleClose}>
                  Cancelar
                </button>

                {step < 5 ? (
                  <button className="ep-footer-btn primary" onClick={() => goToStep(step + 1)}>
                    Siguiente ›
                  </button>
                ) : (
                  <button className="ep-footer-btn primary" onClick={handleClose}>
                    Cerrar
                  </button>
                )}
              </div>
            </footer>
          </main>
        </section>
      </div>
    </>
  );
}
