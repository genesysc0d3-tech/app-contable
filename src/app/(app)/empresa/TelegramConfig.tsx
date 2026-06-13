"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";

/**
 * Panel de conexión del bot de Telegram (paso del wizard de empresa).
 * Reemplaza al antiguo "IA (DeepSeek)": la IA hoy es centralizada (OpenCode),
 * el cliente ya no pone clave. Acá vincula su Telegram para mandar fotos de
 * comprobantes que caen en Agregados por el mismo pipeline que el panel.
 */
export default function TelegramConfig() {
  const { toast } = useToast();
  const [vinculado, setVinculado] = useState<boolean | null>(null);
  const [botConfigured, setBotConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/telegram/link")
      .then((r) => r.json())
      .then((d) => {
        setVinculado(Boolean(d.vinculado));
        setBotConfigured(d.botConfigured !== false);
      })
      .catch(() => setVinculado(false))
      .finally(() => setLoading(false));
  }, []);

  async function conectar() {
    if (generando) return;
    setGenerando(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.link) {
        setLink(data.link as string);
        toast("Abre Telegram y aprieta Iniciar");
      } else if (res.status === 503) {
        setBotConfigured(false);
        toast("Telegram próximamente", "error");
      } else {
        toast("No se pudo generar el link de Telegram", "error");
      }
    } catch {
      toast("No se pudo generar el link de Telegram", "error");
    } finally {
      setGenerando(false);
    }
  }

  const conectado = vinculado === true;

  return (
    <div style={{
      borderRadius: 22,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.025)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid rgba(232,85,62,0.25)",
            background: "rgba(232,85,62,0.12)",
            color: "#FDBA74",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                Bot de Telegram
              </h3>
              {!loading && (
                <span style={{
                  display: "inline-block", borderRadius: 9999,
                  padding: "2px 10px", fontSize: 11, fontWeight: 700,
                  border: `1px solid ${conectado ? "rgba(52,211,153,0.25)" : "rgba(251,113,133,0.20)"}`,
                  background: conectado ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.14)",
                  color: conectado ? "#6ee7b7" : "#FDA4AF",
                }}>
                  {conectado ? "Conectado" : "Sin conectar"}
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
              Manda fotos de comprobantes por chat y caen en Agregados, listas para boletear.
            </p>
          </div>
        </div>

        <div style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          background: conectado ? "rgba(52,211,153,0.04)" : "rgba(255,255,255,0.03)",
          padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: conectado ? "#34d399" : "#fb7185",
              border: `1px solid ${conectado ? "rgba(52,211,153,0.6)" : "rgba(251,113,133,0.6)"}`,
              fontSize: 12, fontWeight: 900, flexShrink: 0,
            }}>
              {conectado ? "✓" : "!"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 760, color: "#eaf0f8" }}>
              {loading
                ? "Cargando…"
                : !botConfigured
                ? "Disponible próximamente"
                : conectado
                ? "Telegram conectado — mándale fotos al bot"
                : "Conecta tu Telegram para mandar comprobantes"}
            </div>
          </div>

          {!loading && botConfigured && (
            link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                style={{
                  height: 36, borderRadius: 10, border: "none",
                  background: "#E8553E", color: "#fff",
                  padding: "0 14px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                  textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                Abrir Telegram →
              </a>
            ) : (
              <button
                type="button"
                onClick={conectar}
                disabled={generando}
                style={{
                  height: 36, borderRadius: 10,
                  border: conectado ? "1px solid rgba(255,255,255,0.13)" : "none",
                  background: conectado ? "rgba(255,255,255,0.045)" : "#E8553E",
                  color: conectado ? "#eff3fa" : "#fff",
                  padding: "0 14px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", opacity: generando ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {generando ? "Generando…" : conectado ? "Generar nuevo link" : "Conectar Telegram"}
              </button>
            )
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
          Manda <strong style={{ color: "rgba(255,255,255,0.7)" }}>screenshots nítidos</strong> — una foto de
          la pantalla con reflejos se lee peor. Desde Telegram solo se suben comprobantes, no se emite nada.
        </div>
      </div>
    </div>
  );
}
