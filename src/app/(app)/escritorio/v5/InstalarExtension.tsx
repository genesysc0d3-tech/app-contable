"use client";

import { useState } from "react";
import { useExtensionStatus } from "./useExtensionStatus";
import { EXTENSION_STORE_URL, EXTENSION_NOMBRE, mensajeExtensionDesactualizada } from "@/lib/extension";

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
/**
 * Banner de versión bajo el piso. El botón "Actualizar ahora" intenta que la
 * EXTENSIÓN abra chrome://extensions (una página web no puede navegar a chrome://;
 * la extensión sí, handler APP_CONTABLE_OPEN_EXTENSIONS_PAGE desde 0.1.7). Si la
 * versión instalada no conoce ese mensaje (0.1.5/0.1.6), a los 700ms cae al plan B:
 * copia "chrome://extensions" al portapapeles y muestra el paso a mano.
 */
function ExtensionDesactualizada({ version, recheck }: { version: string | null; recheck: () => void }) {
  const [copiado, setCopiado] = useState(false);

  function abrirPaginaExtensiones() {
    let respondio = false;
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string };
      if (event.source !== window || data?.source !== "app-contable-extension") return;
      if (data.type === "APP_CONTABLE_OPEN_EXTENSIONS_PAGE_RESULT") respondio = true;
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "app-contable", type: "APP_CONTABLE_OPEN_EXTENSIONS_PAGE", protocol_version: 1 },
      window.location.origin,
    );
    window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      if (respondio) return; // la extensión abrió chrome://extensions sola
      void navigator.clipboard?.writeText("chrome://extensions").catch(() => {});
      setCopiado(true);
    }, 700);
  }

  return (
    <div style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--amber, #f59e0b) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ fontSize: 15 }}>⬆️</span>
        <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: "var(--text, #e8eaf0)" }}>
          {mensajeExtensionDesactualizada(version)}
        </span>
        <button
          type="button"
          onClick={abrirPaginaExtensiones}
          style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--accent, #E8553E)", border: "none", borderRadius: 8, padding: "7px 13px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Actualizar ahora
        </button>
        <button
          type="button"
          onClick={recheck}
          style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--text, #e8eaf0)", background: "none", border: "1px solid color-mix(in srgb, var(--text, #e8eaf0) 25%, transparent)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Ya actualicé
        </button>
      </div>
      {copiado && (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: "var(--text2, #8b92a3)" }}>
          Copiamos <b>chrome://extensions</b> — pégalo en una pestaña nueva, busca «{EXTENSION_NOMBRE}» y aprieta <b>Actualizar</b> (arriba a la izquierda, con «Modo de desarrollador» activado se ve el botón).
        </div>
      )}
    </div>
  );
}

export default function InstalarExtension() {
  const { status, version, desactualizada, hayVersionNueva, versionPublicada, recheck } = useExtensionStatus();
  const [showSteps, setShowSteps] = useState(false);

  if (status === "checking") return null;

  // Conectada pero bajo el piso de compatibilidad: banner de bloqueo con las
  // instrucciones de actualización (la emisión también lo rechaza en su gate).
  if (status === "ready" && desactualizada) {
    return <ExtensionDesactualizada version={version} recheck={recheck} />;
  }

  if (status === "ready") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", fontSize: 11.5, color: "var(--green, #22c55e)", flexWrap: "wrap" }}>
        <span aria-hidden style={{ fontSize: 13 }}>✓</span>
        <span>Extensión conectada{version ? ` · v${version}` : ""}</span>
        {/* Aviso SUAVE de versión nueva: no bloquea (para eso está el piso).
            Cubre la ventana entre publicar y que Chrome propague el auto-update:
            el usuario se entera de que existe algo nuevo, no cuando algo falla. */}
        {hayVersionNueva && (
          <span title={`Instalada v${version} · publicada v${versionPublicada}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--amber, #f59e0b)", background: "color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 28%, transparent)", borderRadius: 7, padding: "2px 8px" }}>
            Hay una versión nueva (v{versionPublicada})
            {EXTENSION_STORE_URL.length > 0 && (
              <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>actualizar</a>
            )}
          </span>
        )}
      </div>
    );
  }

  const publicada = EXTENSION_STORE_URL.length > 0;

  return (
    <div style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--amber, #f59e0b) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ fontSize: 15 }}>🧩</span>
        <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: "var(--text, #e8eaf0)" }}>
          Para emitir en el SII necesitas la extensión <b>{EXTENSION_NOMBRE}</b> en este navegador (Chrome, Edge o Brave).
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
