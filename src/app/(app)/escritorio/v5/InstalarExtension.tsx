"use client";

import { useState } from "react";
import { useExtensionStatus } from "./useExtensionStatus";
import { EXTENSION_STORE_URL, EXTENSION_NOMBRE } from "@/lib/extension";

/**
 * Aviso + CTA de instalación de la extensión, con detección automática:
 *  - falta        → banner ámbar "Instalar extensión". Si ya está publicada
 *                   (EXTENSION_STORE_URL seteada) el botón lleva a la Chrome Web Store
 *                   en una pestaña nueva; si no, despliega los pasos de carga manual.
 *  - conectada    → chip verde discreto "✓ Extensión conectada".
 *  - verificando  → nada (evita parpadeo en el primer render).
 *
 * Pensado para la pestaña Emitir (recordatorio antes de intentar emitir).
 */
export default function InstalarExtension() {
  const { status, recheck } = useExtensionStatus();
  const [showSteps, setShowSteps] = useState(false);

  if (status === "checking") return null;

  if (status === "ready") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", fontSize: 11.5, color: "var(--green, #22c55e)" }}>
        <span aria-hidden style={{ fontSize: 13 }}>✓</span>
        <span>Extensión conectada</span>
      </div>
    );
  }

  const publicada = EXTENSION_STORE_URL.length > 0;

  return (
    <div style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--amber, #f59e0b) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ fontSize: 15 }}>🧩</span>
        <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: "var(--text, #e8eaf0)" }}>
          Para emitir en el SII necesitás la extensión <b>{EXTENSION_NOMBRE}</b> en este Chrome.
        </span>
        {publicada ? (
          <a
            href={EXTENSION_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--accent, #E8553E)", border: "none", borderRadius: 8, padding: "7px 13px", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Instalar extensión →
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--accent, #E8553E)", border: "none", borderRadius: 8, padding: "7px 13px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Instalar extensión
          </button>
        )}
      </div>

      {!publicada && showSteps && (
        <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6, color: "var(--text2, #8b92a3)" }}>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            <li>Abre una pestaña nueva en <b>chrome://extensions</b></li>
            <li>Activa el «Modo de desarrollador» (arriba a la derecha).</li>
            <li>«Cargar descomprimida» → elige la carpeta de la extensión que te pasamos.</li>
            <li>
              Vuelve acá y{" "}
              <button type="button" onClick={recheck} style={{ background: "none", border: "none", padding: 0, color: "var(--accent, #E8553E)", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
                reintenta la detección
              </button>.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
