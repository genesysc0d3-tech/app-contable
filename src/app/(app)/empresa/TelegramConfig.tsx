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
  const [enPlan, setEnPlan] = useState(true);

  useEffect(() => {
    let cancel = false;
    const cargar = () => {
      fetch("/api/telegram/link")
        .then((r) => r.json())
        .then((d) => {
          if (cancel) return;
          const v = Boolean(d.vinculado);
          setVinculado(v);
          setBotConfigured(d.botConfigured !== false);
          setEnPlan(d.enPlan !== false);
          if (v) setLink(null); // ya conectado: no dejar el botón "Abrir Telegram"
        })
        .catch(() => { if (!cancel) setVinculado(false); })
        .finally(() => { if (!cancel) setLoading(false); });
    };
    cargar();
    // Vincular es un viaje app → Telegram → app. Al volver y recuperar el foco
    // re-chequeamos para que el estado salte a "Conectado" sin refrescar a mano.
    const onVisible = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
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
      } else if (res.status === 403) {
        setEnPlan(false);
        toast("Disponible en el plan Pro", "error");
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
      border: "1px solid var(--border, rgba(255,255,255,.06))",
      background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
      boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid rgba(232,85,62,0.25)",
            background: "rgba(232,85,62,0.12)",
            color: "var(--accent, #E8553E)",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)" }}>
                Bot de Telegram
              </h3>
              {!loading && (
                <span style={{
                  display: "inline-block", borderRadius: 9999,
                  padding: "2px 10px", fontSize: 11, fontWeight: 700,
                  border: `1px solid ${!enPlan ? "color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)" : conectado ? "color-mix(in srgb, var(--green, #22c55e) 25%, transparent)" : "color-mix(in srgb, var(--red, #ef4444) 20%, transparent)"}`,
                  background: !enPlan ? "color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent)" : conectado ? "color-mix(in srgb, var(--green, #22c55e) 12%, transparent)" : "color-mix(in srgb, var(--red, #ef4444) 14%, transparent)",
                  color: !enPlan ? "var(--amber, #f59e0b)" : conectado ? "var(--green, #22c55e)" : "var(--red, #ef4444)",
                }}>
                  {!enPlan ? "Pro" : conectado ? "Conectado" : "Sin conectar"}
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
              Manda fotos de comprobantes por chat y caen en Agregados, listas para boletear.
            </p>
          </div>
        </div>

        <div style={{
          borderRadius: 14,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: conectado ? "color-mix(in srgb, var(--green, #22c55e) 6%, transparent)" : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
          padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: conectado ? "var(--green, #22c55e)" : "var(--red, #ef4444)",
              border: `1px solid ${conectado ? "color-mix(in srgb, var(--green, #22c55e) 60%, transparent)" : "color-mix(in srgb, var(--red, #ef4444) 60%, transparent)"}`,
              fontSize: 12, fontWeight: 900, flexShrink: 0,
            }}>
              {conectado ? "✓" : "!"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 760, color: "var(--text, #e8eaf0)" }}>
              {loading
                ? "Cargando…"
                : !botConfigured
                ? "Disponible próximamente"
                : !enPlan
                ? "Disponible en el plan Pro"
                : conectado
                ? "Telegram conectado — mándale fotos al bot"
                : "Conecta tu Telegram para mandar comprobantes"}
            </div>
          </div>

          {!loading && botConfigured && !enPlan && (
            <a
              href="/planes"
              style={{
                height: 36, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 35%, transparent)",
                background: "color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent)", color: "var(--amber, #f59e0b)",
                padding: "0 14px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              Ver planes →
            </a>
          )}

          {!loading && botConfigured && enPlan && (
            link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                style={{
                  height: 36, borderRadius: 10, border: "none",
                  background: "var(--accent, #E8553E)", color: "#fff",
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
                  border: conectado ? "1px solid var(--border, rgba(255,255,255,.06))" : "none",
                  background: conectado ? "color-mix(in srgb, var(--text, #e8eaf0) 5%, transparent)" : "var(--accent, #E8553E)",
                  color: conectado ? "var(--text, #e8eaf0)" : "#fff",
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

        <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3, #697080)", lineHeight: 1.5 }}>
          Manda <strong style={{ color: "var(--text2, #8b92a3)" }}>screenshots nítidos</strong> — una foto de
          la pantalla con reflejos se lee peor. Desde Telegram solo se suben comprobantes, no se emite nada.
        </div>
      </div>
    </div>
  );
}
