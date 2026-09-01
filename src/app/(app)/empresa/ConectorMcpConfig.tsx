"use client";

import { useEffect, useState, useTransition } from "react";
import { desconectarConectorMcp, listarConectoresMcp, type ConexionMcp } from "./conector-mcp-actions";

// Panel "Conector MCP" del popup empresa (diseño del fundador): acá el
// cliente VE a qué asistentes de IA está conectado y los DESCONECTA con un
// click. El conector solo LEE (pendientes y resúmenes) — nunca emite ni ve
// la clave del SII; ese contrato se repite acá para que quede claro.

function fmtRelativo(iso: string | null): string {
  if (!iso) return "sin uso aún";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

const MCP_URL = "https://app.massdte.cl/api/mcp";
// claude.ai movió los conectores a Personalizar (2026-09): la ruta vieja
// /settings/connectors quedó como stub que solo dice "se movieron".
const CLAUDE_CONNECTORS_URL = "https://claude.ai/new#settings/customize-connectors";
const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";

export default function ConectorMcpConfig() {
  const [conexiones, setConexiones] = useState<ConexionMcp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cortando, setCortando] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [, startTransition] = useTransition();

  const conectar = async (destino: string) => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 4000);
    } catch {
      // sin permiso de portapapeles: la URL queda visible abajo para copiarla a mano
    }
    window.open(destino, "_blank", "noopener");
  };

  const cargar = () => {
    void listarConectoresMcp().then((res) => {
      if (res.ok) { setConexiones(res.conexiones); setError(null); }
      else setError("No se pudieron cargar las conexiones — reintenta.");
    });
  };
  useEffect(cargar, []);

  const desconectar = (id: string) => {
    setCortando(id);
    startTransition(async () => {
      const res = await desconectarConectorMcp(id);
      setCortando(null);
      if (res.ok) cargar();
      else setError("No se pudo desconectar — reintenta.");
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "-.02em" }}>Conector MCP</h3>
        <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--text2)", lineHeight: 1.55 }}>
          Conecta tu asistente de IA (Claude, ChatGPT) para que te ayude a revisar: <b style={{ color: "var(--text)" }}>solo lee</b> pendientes
          y resúmenes. Nunca emite documentos ni ve tu clave del SII — emitir es siempre un acto tuyo en la app.
        </p>
      </div>

      <div style={{ padding: "13px 15px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 750, color: "var(--text)" }}>
              {copiado ? "Dirección copiada ✓" : "Conectar tu asistente"}
            </div>
            <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--text3)" }}>
              Copia la dirección y abre los conectores — pega, agrega y autoriza.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => void conectar(CLAUDE_CONNECTORS_URL)}
              style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--accent)", color: "#fff", padding: "8px 14px", fontSize: 10.5, fontWeight: 850, cursor: "pointer" }}
            >
              Conectar tu Claude
            </button>
            <button
              onClick={() => void conectar(CHATGPT_CONNECTORS_URL)}
              style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", padding: "8px 14px", fontSize: 10.5, fontWeight: 850, cursor: "pointer" }}
            >
              Conectar tu ChatGPT
            </button>
          </div>
        </div>
        <ol style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, color: "var(--text2)", lineHeight: 1.7 }}>
          <li>En tu asistente, aprieta «Agregar conector personalizado».</li>
          <li>Pega la dirección (ya queda copiada): <code style={{ fontSize: 10, color: "var(--text)", background: "var(--bg-muted)", padding: "1px 6px", borderRadius: 6 }}>{MCP_URL}</code></li>
          <li>Aprieta «Agregar» y autoriza con tu cuenta de massDTE. Listo.</li>
        </ol>
      </div>

      {error && (
        <p style={{ margin: 0, padding: "8px 11px", borderRadius: 10, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#f0a9a0", fontSize: 11.5 }}>{error}</p>
      )}

      {conexiones === null ? (
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text3)" }}>Cargando conexiones…</p>
      ) : conexiones.length === 0 ? (
        <div style={{ padding: "14px 15px", borderRadius: 12, border: "1px dashed var(--border)", fontSize: 11.5, color: "var(--text2)", lineHeight: 1.6 }}>
          Sin conexiones todavía. Cuando conectes un asistente (desde su opción de
          «conectores» apuntando a massDTE), aparecerá acá con su historial — y este
          es el interruptor para cortarlo cuando quieras.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {conexiones.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 13px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(232,85,62,.1)", color: "var(--accent)", fontSize: 13, fontWeight: 900, flexShrink: 0 }}>⇄</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 750, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.nombre}
                  <span style={{ marginLeft: 7, fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: c.origen === "oauth" ? "rgba(84,172,126,.12)" : "var(--bg-muted)", color: c.origen === "oauth" ? "var(--green)" : "var(--text3)" }}>
                    {c.origen === "oauth" ? "sesión" : "token manual"}
                  </span>
                </div>
                <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--text3)" }}>
                  Conectado el {fmtFecha(c.creado)} · último uso {fmtRelativo(c.ultimoUso)}
                </div>
              </div>
              <button
                onClick={() => desconectar(c.id)}
                disabled={cortando === c.id}
                style={{ border: "1px solid rgba(239,68,68,.35)", borderRadius: 10, background: "rgba(239,68,68,.08)", color: "var(--red)", padding: "7px 12px", fontSize: 10.5, fontWeight: 850, cursor: "pointer", flexShrink: 0, opacity: cortando === c.id ? 0.6 : 1 }}
              >
                {cortando === c.id ? "Cortando…" : "Desconectar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
