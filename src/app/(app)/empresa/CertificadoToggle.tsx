"use client";

import { useState, useTransition } from "react";
import { setCertificadoSii } from "./actions";
import { useToast } from "@/components/Toast";

export default function CertificadoToggle({ inicial }: { inicial: boolean }) {
  const { toast } = useToast();
  const [activo, setActivo] = useState(inicial);
  const [pending, start] = useTransition();

  function toggle() {
    const siguiente = !activo;
    setActivo(siguiente);
    start(async () => {
      const r = await setCertificadoSii(siguiente);
      if (r.error) {
        setActivo(!siguiente);
        toast(r.error, "error");
      } else {
        toast(siguiente ? "Certificado delegado al intermediario" : "Certificado desactivado");
      }
    });
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
            border: "1px solid rgba(52,211,153,0.25)",
            background: "rgba(52,211,153,0.12)",
            color: "#86EFAC",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
              <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.8"/>
              <path d="m9 12 2 2 4-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                Certificado digital SII
              </h3>
              <span style={{
                display: "inline-block", borderRadius: 9999,
                border: `1px solid ${activo ? "rgba(52,211,153,0.20)" : "rgba(251,113,133,0.20)"}`,
                background: activo ? "rgba(52,211,153,0.15)" : "rgba(251,113,133,0.15)",
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                color: activo ? "#86EFAC" : "#FDA4AF",
              }}>
                {activo ? "Activo" : "Inactivo"}
              </span>
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
              Permite firmar electrónicamente tus documentos.
            </p>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: activo ? "rgba(52,211,153,0.04)" : "rgba(251,113,133,0.04)",
          padding: "16px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: activo ? "#34d399" : "#fb7185",
              border: `1px solid ${activo ? "rgba(52,211,153,0.62)" : "rgba(251,113,133,0.62)"}`,
              fontSize: 13, fontWeight: 900, flexShrink: 0,
            }}>
              {activo ? "✓" : "!"}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 760, color: activo ? "#6ee7b7" : "#FDA4AF" }}>
                {activo ? "Certificado cargado correctamente" : "Certificado no configurado"}
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                {activo
                  ? "Válido hasta el 15 de marzo de 2026"
                  : "Activá el certificado para poder emitir DTEs"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            style={{
              position: "relative",
              width: 50, height: 28, flexShrink: 0,
              borderRadius: 9999,
              background: activo
                ? "linear-gradient(145deg, #1fcf83, #18a66a)"
                : "rgba(255,255,255,0.12)",
              boxShadow: activo
                ? "inset 0 1px 2px rgba(0,0,0,.25), 0 10px 25px rgba(52,211,153,.18)"
                : "none",
              border: "none",
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
            aria-label="Toggle certificado"
            role="switch"
            aria-checked={activo}
          >
            <span style={{
              position: "absolute",
              top: 2.5, width: 23, height: 23,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 4px 12px rgba(0,0,0,.28)",
              transition: "transform 160ms ease",
              transform: activo ? "translateX(24px)" : "translateX(2px)",
            }} />
          </button>
        </div>
      </div>
    </div>
  );
}
