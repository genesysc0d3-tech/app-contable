"use client";

import { useEffect, useState } from "react";
import { useExtensionStatus } from "./useExtensionStatus";

/**
 * Chips de estado en la barra de la mesa (iterado con el fundador 2026-09-02):
 * cada chip es el LOGO REAL con un badge redondo sobrepuesto en la esquina
 * (✓ verde conectado / ✕ apagado) — sin agrandar la barra.
 *  - Extensión: icono massDTE + "ex/ten/sión" apilado → conectada con bóveda
 *    lista (mismo criterio que Emitir).
 *  - MCP: glifo oficial del protocolo + "MCP" + los logos de los asistentes
 *    enchufados (Claude / ChatGPT), leídos de GET /api/mcp/estado.
 */

type EstadoMcp = { claude: boolean; chatgpt: boolean; otros: number; telegram?: boolean };

function Badge({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden style={{
      /* vive en la esquina inferior IZQUIERDA del logo (pedido fundador) */
      position: "absolute", left: -5, bottom: -4, width: 11, height: 11, borderRadius: 99,
      display: "grid", placeItems: "center", fontSize: 7.5, fontWeight: 900, lineHeight: 1,
      color: "#fff", background: ok ? "var(--green, #22c55e)" : "var(--text3, #6b7280)",
      border: "1.5px solid var(--bg, #0b0b0c)",
    }}>{ok ? "✓" : "✕"}</span>
  );
}

function Chip({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <span title={title} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, cursor: "default", opacity: ok ? 1 : 0.55 }}>
      {children}
      <Badge ok={ok} />
    </span>
  );
}

// Glifo oficial MCP (modelcontextprotocol, docs/logo — stroke a currentColor).
function LogoMcp({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="10 10 172 172" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" aria-hidden>
      <path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177" />
      <path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.519" />
      <path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087V131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822" />
    </svg>
  );
}

// Logo Claude: el asterisco/estallido, en su naranja.
function LogoClaude() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#D97757" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.3 4.3M14.1 14.1l4.3 4.3M18.4 5.6l-4.3 4.3M9.9 14.1l-4.3 4.3" />
    </svg>
  );
}

// Logo ChatGPT: el nudo hexagonal, simplificado.
function LogoChatGpt() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6Z" />
      <path d="M12 8.2l3.3 1.9v3.8L12 15.8l-3.3-1.9v-3.8Z" />
    </svg>
  );
}

// Logo Telegram: círculo celeste con el avioncito.
function LogoTelegram({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#229ED9" />
      <path d="M5.2 11.6l12.2-4.9c.6-.2 1.1.1.9.9l-2.1 9.8c-.15.7-.6.85-1.2.5l-3.2-2.35-1.5 1.5c-.2.2-.4.3-.7.3l.25-3.1 5.7-5.15c.25-.22-.05-.34-.38-.13l-7.05 4.44-3-.95c-.65-.2-.66-.65.08-.86z" fill="#fff" />
    </svg>
  );
}

const txt = { fontSize: 8, fontWeight: 800, letterSpacing: ".04em", color: "var(--text2)" } as const;

export default function ConectoresChips() {
  const { status, hayBoveda } = useExtensionStatus();
  const [mcp, setMcp] = useState<EstadoMcp | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/mcp/estado", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setMcp(d as EstadoMcp); })
      .catch(() => { /* sin red: el chip MCP simplemente no aparece */ });
    return () => { vivo = false; };
  }, []);

  const siiOk = status === "ready" && hayBoveda !== false;
  const mcpOk = mcp != null && (mcp.claude || mcp.chatgpt || mcp.otros > 0);
  const quien = mcp == null ? "" : [mcp.claude && "Claude", mcp.chatgpt && "ChatGPT", mcp.otros > 0 && "otro conector"].filter(Boolean).join(" + ");

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 14, color: "var(--text2)" }}>
      {/* verificando (primer render) no muestra ✕ prematuro */}
      {status !== "checking" && (
        <Chip ok={siiOk} title={siiOk ? "Extensión conectada con el SII" : "Extensión no conectada — pestaña Emitir para instalarla"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="Extensión massDTE" style={{ height: 15, width: 15, borderRadius: 4, display: "block" }} />
          <span aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 4.5, fontWeight: 800, letterSpacing: ".06em", lineHeight: 1.15, color: "var(--text2)", textTransform: "uppercase" }}>
            <span>ex</span><span>ten</span><span>sión</span>
          </span>
        </Chip>
      )}
      {mcp != null && (
        <Chip ok={mcp.telegram === true} title={mcp.telegram ? "Bot de Telegram vinculado — comprobantes desde el teléfono" : "Bot de Telegram sin vincular — panel Comprobantes por Telegram"}>
          <LogoTelegram />
        </Chip>
      )}
      {mcp != null && (
        <Chip ok={mcpOk} title={mcpOk ? `Conector MCP activo: ${quien}` : "Sin asistente conectado — botón Conectar tu Claude/ChatGPT en el panel Conector MCP"}>
          <LogoMcp />
          <span style={txt}>MCP</span>
          {mcp.claude && <LogoClaude />}
          {mcp.chatgpt && <LogoChatGpt />}
        </Chip>
      )}
    </span>
  );
}
