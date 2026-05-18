"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import EmisorForm from "../../empresa/EmisorForm";
import CertificadoToggle from "../../empresa/CertificadoToggle";
import CAFPanel, { type CAFRow } from "../../empresa/CAFPanel";
import AiKeyConfig from "../../empresa/AiKeyConfig";
import EmpresaFormatoCartola from "../../empresa/EmpresaFormatoCartola";
import type { DatosEmisor } from "../../empresa/actions";

export default function EmpresaPopup({
  inicial,
  tieneCertificado,
  cafs,
  empresaId,
  onClose,
}: {
  inicial: DatosEmisor;
  tieneCertificado: boolean;
  cafs: CAFRow[];
  empresaId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const goToStep = useCallback((i: number) => {
    setStep(i);
  }, []);

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
          padding: 30px;
          background: rgba(0, 0, 0, 0.58);
          backdrop-filter: blur(14px);
        }

        .ep-modal {
          width: min(1100px, calc(100vw - 60px));
          height: min(780px, calc(100dvh - 60px));
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background:
            radial-gradient(circle at 14% 0%, rgba(139, 92, 246, 0.13), transparent 30%),
            radial-gradient(circle at 96% 2%, rgba(101, 184, 255, 0.08), transparent 30%),
            linear-gradient(145deg, rgba(17, 26, 39, 0.96), rgba(9, 16, 26, 0.97));
          box-shadow: 0 40px 120px rgba(0, 0, 0, 0.56);
          display: grid;
          grid-template-columns: 280px 1fr;
          color: #f4f7fb;
        }

        .ep-wizard {
          border-right: 1px solid rgba(255, 255, 255, 0.105);
          background: linear-gradient(180deg, rgba(13, 22, 35, 0.92), rgba(9, 16, 26, 0.96));
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
          color: #a8b2c1;
          background: rgba(255, 255, 255, 0.018);
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
          background: rgba(255, 255, 255, 0.08);
        }

        .ep-step-card:hover {
          color: #f4f7fb;
          background: rgba(255, 255, 255, 0.045);
          border-color: rgba(255, 255, 255, 0.075);
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
          background: rgba(255, 255, 255, 0.105);
          color: #d7deea;
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
          color: rgba(225, 232, 242, 0.6);
        }

        .ep-help-box {
          margin-top: auto;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.045);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
        }

        .ep-help-icon {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, #E8553E, #cd5832);
          color: #ffffff;
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
          color: #a8b1bf;
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

        .ep-main-panel {
          min-width: 0;
          display: grid;
          grid-template-rows: auto 1fr auto;
          max-height: min(780px, calc(100dvh - 60px));
        }

        .ep-modal-header {
          min-height: 72px;
          padding: 18px 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.105);
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
          color: #fca5a5;
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
          color: #f4f7fb;
        }

        .ep-subtitle {
          margin: 4px 0 0;
          color: #a8b2c1;
          font-size: 12px;
        }

        .ep-close-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.105);
          background: rgba(255, 255, 255, 0.045);
          color: #dce3ed;
          font-size: 30px;
          line-height: 1;
          cursor: pointer;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            color 160ms ease;
        }

        .ep-close-btn:hover {
          background: rgba(255, 255, 255, 0.075);
          border-color: rgba(255, 255, 255, 0.16);
          color: #ffffff;
        }

        .ep-content {
          overflow: auto;
          padding: 24px 32px 28px;
          scrollbar-width: thin;
          scrollbar-color: rgba(160, 170, 185, 0.32) transparent;
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
          border-top: 1px solid rgba(255, 255, 255, 0.105);
          background: rgba(255, 255, 255, 0.025);
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
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.055);
          color: #f5f7fb;
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
          background: rgba(255, 255, 255, 0.085);
          border-color: rgba(255, 255, 255, 0.16);
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

      <div className="ep-overlay" onClick={onClose}>
        <section
          ref={ref}
          className="ep-modal"
          onClick={(e) => e.stopPropagation()}
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
                icon: "M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z",
                title: "Certificado SII",
                sub: "Estado del certificado",
              },
              {
                n: 3,
                icon: "M7 3h7l4 4v14H7V3Z",
                title: "Formatos de cartola",
                sub: "Subí y mapeá formatos",
              },
              {
                n: 4,
                icon: "M4 7h16v12H4V7Z",
                title: "Folios CAF",
                sub: "Gestión automática",
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
                Te guiamos en cada paso para dejar la empresa lista.
              </div>
              <div className="ep-help-link">Ver documentación ↗</div>
            </div>
          </aside>

          <main className="ep-main-panel">
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

              <button className="ep-close-btn" onClick={onClose} aria-label="Cerrar">
                ×
              </button>
            </header>

            <div className="ep-content">
              <div className="ep-content-inner">
                {[
                  { key: "emisor", content: <EmisorForm inicial={inicial} /> },
                  { key: "certificado", content: <CertificadoToggle inicial={tieneCertificado} /> },
                  { key: "formatos", content: <EmpresaFormatoCartola empresaId={empresaId} /> },
                  { key: "folios", content: <CAFPanel cafs={cafs} /> },
                  { key: "ia", content: <AiKeyConfig /> },
                ]
                  .filter((_, i) => i === step)
                  .map((s) => (
                    <div key={s.key} ref={el => { sectionRefs.current[step] = el; }}>
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
                <button className="ep-footer-btn" onClick={onClose}>
                  Cancelar
                </button>

                {step < 4 ? (
                  <button className="ep-footer-btn primary" onClick={() => goToStep(step + 1)}>
                    Siguiente ›
                  </button>
                ) : (
                  <button className="ep-footer-btn primary" onClick={onClose}>
                    ✓ Guardar cambios
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
