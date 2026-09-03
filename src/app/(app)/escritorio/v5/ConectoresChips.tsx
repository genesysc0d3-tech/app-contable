"use client";

import { useEffect, useState } from "react";
import { useExtensionStatus } from "./useExtensionStatus";

/**
 * Chips de estado en la barra de la mesa (pedido fundador 2026-09-02):
 *  - SII ✓/✕  → la extensión conectada con bóveda lista (mismo criterio que
 *               el "Conectado con el SII" de Emitir).
 *  - MCP ✓/✕  → algún asistente enchufado por OAuth al conector, con el logo
 *               de quién: Claude, ChatGPT, o ambos.
 * Ambos con tooltip; discretos, del mismo porte que los contadores de al lado.
 */

type EstadoMcp = { claude: boolean; chatgpt: boolean; otros: number };

function Chip({ ok, label, title, children }: { ok: boolean; label: string; title: string; children?: React.ReactNode }) {
  const color = ok ? "var(--green, #22c55e)" : "var(--text3)";
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color, cursor: "default" }}>
      {label}
      <span aria-hidden style={{ fontSize: ok ? 10 : 9, lineHeight: 1 }}>{ok ? "✓" : "✕"}</span>
      {children}
    </span>
  );
}

// Logo Claude: el asterisco/estallido, en su naranja.
function LogoClaude() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#D97757" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.3 4.3M14.1 14.1l4.3 4.3M18.4 5.6l-4.3 4.3M9.9 14.1l-4.3 4.3" />
    </svg>
  );
}

// Logo ChatGPT: el nudo hexagonal, simplificado para 10px.
function LogoChatGpt() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6Z" />
      <path d="M12 8.2l3.3 1.9v3.8L12 15.8l-3.3-1.9v-3.8Z" />
    </svg>
  );
}

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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {/* verificando (primer render) no muestra ✕ prematuro */}
      {status !== "checking" && (
        <Chip ok={siiOk} label="SII" title={siiOk ? "Extensión conectada con el SII" : "Extensión no conectada — pestaña Emitir para instalarla"} />
      )}
      {mcp != null && (
        <Chip ok={mcpOk} label="MCP" title={mcpOk ? `Conector MCP activo: ${quien}` : "Sin asistente conectado — botón Conectar tu Claude/ChatGPT en el panel Conector MCP"}>
          {mcp.claude && <LogoClaude />}
          {mcp.chatgpt && <LogoChatGpt />}
        </Chip>
      )}
    </span>
  );
}
