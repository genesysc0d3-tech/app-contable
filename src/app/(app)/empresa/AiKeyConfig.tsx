"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";

export default function AiKeyConfig() {
  const { toast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config/ai-key")
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured ?? false))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!key.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config/ai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("API key guardada correctamente");
        setConfigured(true);
        setKey("");
      } else {
        toast(data.error ?? "Error al guardar", "error");
      }
    } catch {
      toast("Error al guardar la API key", "error");
    }
    setSaving(false);
  }

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
              <path d="M9 3h6v3h3v3h3v6h-3v3h-3v3H9v-3H6v-3H3V9h3V6h3V3Z" stroke="currentColor" strokeWidth="1.7"/>
              <path d="M9 9h6v6H9V9Z" stroke="currentColor" strokeWidth="1.7"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                IA (DeepSeek)
              </h3>
              {!loading && (
                <span style={{
                  display: "inline-block", borderRadius: 9999,
                  border: `1px solid ${configured ? "rgba(232,85,62,0.20)" : "rgba(251,113,133,0.20)"}`,
                  background: configured ? "rgba(232,85,62,0.14)" : "rgba(251,113,133,0.14)",
                  color: configured ? "#FDBA74" : "#FDA4AF",
                }}>
                  {configured ? "Configurado" : "Sin configurar"}
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
              Clave de API para análisis inteligente de documentos.
            </p>
          </div>
        </div>

        <div style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          background: configured ? "rgba(52,211,153,0.04)" : "rgba(255,255,255,0.03)",
          padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: configured ? "#E8553E" : "#fb7185",
              border: `1px solid ${configured ? "rgba(232,85,62,0.6)" : "rgba(251,113,133,0.6)"}`,
              fontSize: 12, fontWeight: 900, flexShrink: 0,
            }}>
              {configured ? "✓" : "!"}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 760, color: "#eaf0f8" }}>
                {configured ? "Clave API configurada correctamente" : "API key no configurada"}
              </div>
              {!configured && (
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={visible ? "text" : "password"}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="sk-..."
                      style={{
                        width: "100%", height: 36,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.13)",
                        background: "rgba(5,11,20,0.28)",
                        color: "#ecf1f8",
                        padding: "0 32px 0 12px",
                        fontSize: 12,
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setVisible(!visible)}
                      style={{
                        position: "absolute", right: 8, top: "50%",
                        transform: "translateY(-50%)",
                        background: "none", border: "none",
                        color: "rgba(255,255,255,0.4)",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      {visible ? "🙈" : "👁"}
                    </button>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving || !key.trim()}
                    style={{
                      height: 36, borderRadius: 10,
                      border: "none",
                      background: "#E8553E",
                      color: "#fff",
                      padding: "0 14px",
                      fontSize: 12, fontWeight: 600,
                      cursor: "pointer",
                      opacity: saving || !key.trim() ? 0.5 : 1,
                    }}
                  >
                    {saving ? "..." : "Guardar"}
                  </button>
                </div>
              )}
            </div>
          </div>
          {configured && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={{
                  height: 36, borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.13)",
                  background: "rgba(255,255,255,0.045)",
                  color: "#eff3fa",
                  padding: "0 14px",
                  fontWeight: 600, fontSize: 12,
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                Probar conexión ≋
              </button>
            </div>
          )}
        </div>

        {!configured && (
          <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            La API key se guarda en la base de datos, no en variables de entorno.
          </div>
        )}
      </div>
    </div>
  );
}
