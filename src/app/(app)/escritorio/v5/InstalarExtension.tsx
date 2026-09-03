"use client";

import { useState } from "react";
import { useExtensionStatus } from "./useExtensionStatus";
import { EXTENSION_STORE_URL, EXTENSION_NOMBRE, mensajeExtensionDesactualizada } from "@/lib/extension";
import AnimacionConectaSII from "./AnimacionConectaSII";

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

/**
 * LA ESCALERA (2026-09-01, veredicto de los 3 estrategas tras el primer
 * cliente perdido): el requisito de la extensión deja de ser un muro frío y
 * pasa a ser el paso 3 de un progreso donde los pasos 1-2 YA están en verde
 * (la cartola cargada y las boletas aprobadas del propio usuario). El paso 3
 * explica POR QUÉ (emite desde TU navegador con TU sesión) y qué pasa con la
 * clave (cifrada en tu equipo). Detección automática: instalar la extensión
 * y guardar la clave avanzan la escalera solos (polling del PONG).
 */
type EscaleraDatos = { docNombre: string | null; listas: number; montoListo: number | null };

function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function Paso({ ok, num, titulo, sub }: { ok: boolean; num: number; titulo: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
      <span style={{
        width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
        fontSize: 12, fontWeight: 800, transition: "all .3s",
        background: ok ? "color-mix(in srgb, var(--green, #22c55e) 14%, transparent)" : "transparent",
        color: ok ? "var(--green, #22c55e)" : "var(--text3, #6b7280)",
        border: ok ? "1.5px solid color-mix(in srgb, var(--green, #22c55e) 35%, transparent)" : "1.5px dashed color-mix(in srgb, var(--text, #e8eaf0) 25%, transparent)",
      }}>{ok ? "✓" : num}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12, fontWeight: 650, color: "var(--text, #e8eaf0)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titulo}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--text3, #6b7280)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
      </span>
    </div>
  );
}

export default function InstalarExtension({ escalera }: { escalera?: EscaleraDatos }) {
  const { status, version, hayBoveda, desactualizada, hayVersionNueva, versionPublicada, recheck } = useExtensionStatus();
  const [showSteps, setShowSteps] = useState(false);
  const [abriendoOpciones, setAbriendoOpciones] = useState(false);

  if (status === "checking") return null;

  if (status === "ready" && desactualizada) {
    return <ExtensionDesactualizada version={version} recheck={recheck} />;
  }

  // has_vault ausente (extensión vieja sin el campo) NO bloquea: se asume lista.
  const bovedaLista = status === "ready" && hayBoveda !== false;
  const listo = status === "ready" && bovedaLista;

  function abrirOpciones() {
    setAbriendoOpciones(true);
    window.postMessage(
      { source: "app-contable", type: "APP_CONTABLE_OPEN_EXTENSION_OPTIONS", protocol_version: 1 },
      window.location.origin,
    );
    window.setTimeout(() => setAbriendoOpciones(false), 1500);
  }

  // Estado terminal compacto: todo conectado (chip verde de siempre + aviso suave de versión).
  if (listo) {
    return (
      <div id="escalera-emision" data-listo="1" style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", fontSize: 11.5, color: "var(--green, #22c55e)", flexWrap: "wrap" }}>
        <span aria-hidden style={{ fontSize: 13 }}>✓</span>
        <span>Conectado con el SII{version ? ` · extensión v${version}` : ""}</span>
        {hayVersionNueva && (
          <span title={`Instalada v${version} · publicada v${versionPublicada}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--amber, #f59e0b)", background: "color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 28%, transparent)", borderRadius: 7, padding: "2px 8px" }}>
            {/* Sin link "actualizar" (fundador 2026-09-02): el Web Store no tiene botón
                de actualizar y una página no puede abrir chrome://extensions — la acción real
                del usuario es reiniciar su navegador (ahí se actualiza sola — vale para Edge/Brave). */}
            Hay una versión nueva (v{versionPublicada}) — reinicia tu navegador y se actualiza sola
          </span>
        )}
      </div>
    );
  }

  const publicada = EXTENSION_STORE_URL.length > 0;
  const listas = escalera?.listas ?? 0;
  const sub2 = listas > 0
    ? `${escalera?.montoListo != null ? `${pesos(escalera.montoListo)} en total` : "listas para salir"}`
    : "aprueba en Check las que saldrán";

  return (
    <div id="escalera-emision" data-listo="0" style={{ margin: "0 0 14px", padding: "16px 18px", borderRadius: 14, background: "var(--surface, #121212)", border: "1px solid color-mix(in srgb, var(--text, #e8eaf0) 12%, transparent)", transition: "box-shadow .4s, border-color .4s" }}>
      {/* los 3 pasos */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <Paso ok={Boolean(escalera?.docNombre)} num={1} titulo="Cartola cargada" sub={escalera?.docNombre ?? "sube tu cartola en Agregados"} />
        <span style={{ height: 1.5, flex: "0 0 30px", margin: "0 10px", background: listas > 0 ? "color-mix(in srgb, var(--green, #22c55e) 35%, transparent)" : "color-mix(in srgb, var(--text, #e8eaf0) 12%, transparent)" }} />
        <Paso ok={listas > 0} num={2} titulo={listas > 0 ? `${listas} ${listas === 1 ? "boleta aprobada" : "boletas aprobadas"}` : "Boletas aprobadas"} sub={sub2} />
        <span style={{ height: 1.5, flex: "0 0 30px", margin: "0 10px", background: "color-mix(in srgb, var(--text, #e8eaf0) 12%, transparent)" }} />
        <Paso
          ok={false}
          num={3}
          titulo="Conectar con el SII"
          sub={status === "ready" ? "extensión conectada ✓ — falta tu clave" : "1 minuto — el último paso del trial"}
        />
      </div>

      {/* la película: instala → tu clave cifrada → SII con tu sesión → boletas
          de verdad (iterada con mocks; misma gramática visual del landing) */}
      <AnimacionConectaSII />

      {/* paso 3, sub-momento A: instalar la extensión */}
      {status !== "ready" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {publicada ? (
              <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 750, color: "#fff", background: "var(--accent, #E8553E)", borderRadius: 10, padding: "9px 16px", textDecoration: "none", whiteSpace: "nowrap" }}>
                Instalar extensión (30 seg)
              </a>
            ) : (
              <button type="button" onClick={() => setShowSteps((v) => !v)}
                style={{ fontSize: 12, fontWeight: 750, color: "#fff", background: "var(--accent, #E8553E)", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", whiteSpace: "nowrap" }}>
                Instalar extensión
              </button>
            )}
            <span style={{ fontSize: 11, color: "var(--text3, #6b7280)" }}>La app detecta la instalación sola — no tienes que avisarle.</span>
          </div>
          {!publicada && showSteps && (
            <ol style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 11, lineHeight: 1.6, color: "var(--text2, #8b92a3)" }}>
              <li>Abre una pestaña nueva en <b>chrome://extensions</b></li>
              <li>Activa el «Modo de desarrollador» (arriba a la derecha).</li>
              <li>«Cargar descomprimida» → elige la carpeta de la extensión que te pasamos.</li>
            </ol>
          )}
        </div>
      )}

      {/* paso 3, sub-momento B: guardar la clave del SII en la bóveda */}
      {status === "ready" && !bovedaLista && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green, #22c55e)" }}>✓ Extensión conectada</span>
            <button type="button" onClick={abrirOpciones}
              style={{ fontSize: 12, fontWeight: 750, color: "#fff", background: "var(--accent, #E8553E)", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", whiteSpace: "nowrap", opacity: abriendoOpciones ? 0.7 : 1 }}>
              {abriendoOpciones ? "Abriendo…" : "Guardar mi clave"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text3, #6b7280)" }}>Se abre la configuración de la extensión; al guardar, esto avanza solo.</span>
          </div>
        </div>
      )}
    </div>
  );
}
