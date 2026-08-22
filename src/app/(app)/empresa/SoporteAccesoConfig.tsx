"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import {
  estadoIntervencionCliente,
  revocarIntervencionSoporte,
  type EstadoIntervencionCliente,
} from "../escritorio/v5/actions";

/**
 * Apartado "Acceso de soporte" (Empresa, paso 7). El cliente ve acá el estado
 * del acceso de soporte a su empresa: normalmente "sin acceso" (solo lectura),
 * el código de 6 dígitos cuando soporte pide permiso (también le llega por
 * Telegram), y el corte inmediato cuando hay una intervención activa. El
 * permiso SIEMPRE es del cliente: código de un uso, ventana de 1 hora,
 * revocable, y cada cambio de soporte queda en el historial de la cuenta.
 */
export default function SoporteAccesoConfig() {
  const { toast } = useToast();
  const [estado, setEstado] = useState<EstadoIntervencionCliente | null>(null);
  const [cortando, setCortando] = useState(false);

  useEffect(() => {
    let cancel = false;
    const cargar = () => {
      estadoIntervencionCliente()
        .then((res) => { if (!cancel && !("error" in res)) setEstado(res); })
        .catch(() => {});
    };
    cargar();
    const onVisible = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  async function cortar() {
    if (cortando) return;
    setCortando(true);
    try {
      const res = await revocarIntervencionSoporte();
      if ("error" in res) {
        toast("No se pudo cortar el acceso", "error");
      } else {
        setEstado({ estado: "ninguna" });
        toast("Acceso de soporte cortado");
      }
    } finally {
      setCortando(false);
    }
  }

  const pendiente = estado?.estado === "pendiente" ? estado : null;
  const activa = estado?.estado === "activa" ? estado : null;
  const horaTermino = activa
    ? new Date(activa.expiraAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })
    : null;

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
              <path d="M12 3l7 4v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V7l7-4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M9.5 12l2 2 3.5-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)" }}>
                Acceso de soporte
              </h3>
              {estado && (
                <span style={{
                  display: "inline-block", borderRadius: 9999,
                  padding: "2px 10px", fontSize: 11, fontWeight: 700,
                  border: `1px solid ${activa ? "color-mix(in srgb, var(--accent, #E8553E) 30%, transparent)" : pendiente ? "color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)" : "color-mix(in srgb, var(--text3, #697080) 35%, transparent)"}`,
                  background: activa ? "color-mix(in srgb, var(--accent, #E8553E) 12%, transparent)" : pendiente ? "color-mix(in srgb, var(--amber, #f59e0b) 12%, transparent)" : "color-mix(in srgb, var(--text3, #697080) 10%, transparent)",
                  color: activa ? "var(--accent, #E8553E)" : pendiente ? "var(--amber, #f59e0b)" : "var(--text3, #697080)",
                }}>
                  {activa ? "Intervención activa" : pendiente ? "Permiso pedido" : "Sin acceso"}
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
              {activa
                ? "Autorizaste a soporte a trabajar en tu empresa. Cada cambio queda registrado en tu historial."
                : pendiente
                ? "Soporte pidió tu permiso para intervenir por 1 hora. El código también te llegó por Telegram."
                : "Nadie puede tocar tus datos. Si pides ayuda, soporte solo entra con un código que te llega a ti y dura 1 hora."}
            </p>
          </div>
        </div>

        <div style={{
          borderRadius: 14,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: activa
            ? "color-mix(in srgb, var(--accent, #E8553E) 6%, transparent)"
            : pendiente
            ? "color-mix(in srgb, var(--amber, #f59e0b) 6%, transparent)"
            : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
          padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: activa ? "var(--accent, #E8553E)" : pendiente ? "var(--amber, #f59e0b)" : "var(--text3, #697080)",
              border: `1px solid ${activa ? "color-mix(in srgb, var(--accent, #E8553E) 60%, transparent)" : pendiente ? "color-mix(in srgb, var(--amber, #f59e0b) 60%, transparent)" : "color-mix(in srgb, var(--text3, #697080) 55%, transparent)"}`,
              fontSize: 12, fontWeight: 900, flexShrink: 0,
            }}>
              {activa ? "●" : pendiente ? "!" : "–"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 760, color: "var(--text, #e8eaf0)" }}>
                {estado === null
                  ? "Cargando…"
                  : activa
                  ? "Soporte está trabajando en tu empresa"
                  : pendiente
                  ? "Compártele este código a soporte solo si TÚ pediste ayuda"
                  : "Soporte no tiene acceso a tu empresa"}
              </div>
              <div style={{ marginTop: 2, fontSize: 11, color: "var(--text3, #697080)" }}>
                {activa
                  ? `Termina solo a las ${horaTermino}. Puedes cortarlo cuando quieras.`
                  : pendiente
                  ? "Vence en 15 minutos · Si no pediste nada, recházalo"
                  : "Todo lo que soporte pueda ver es solo lectura."}
              </div>
            </div>
          </div>

          {pendiente && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{
                fontSize: 20, fontWeight: 900, letterSpacing: ".24em", fontVariantNumeric: "tabular-nums",
                border: "1px dashed color-mix(in srgb, var(--amber, #f59e0b) 45%, transparent)",
                borderRadius: 10, padding: "7px 14px",
                background: "color-mix(in srgb, var(--amber, #f59e0b) 8%, transparent)",
                color: "var(--text, #e8eaf0)",
              }}>
                {pendiente.codigo}
              </div>
              <button type="button" onClick={cortar} disabled={cortando} style={btnDanger(cortando)}>
                {cortando ? "Rechazando…" : "Rechazar"}
              </button>
            </div>
          )}
          {activa && (
            <button type="button" onClick={cortar} disabled={cortando} style={btnDanger(cortando)}>
              {cortando ? "Cortando…" : "Cortar acceso ahora"}
            </button>
          )}
        </div>

        {activa && (
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3, #697080)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text2, #8b92a3)" }}>Todo queda registrado:</strong>{" "}
            cada cambio que haga soporte durante esta hora aparece en el historial de tu cuenta, uno por uno.
          </div>
        )}
      </div>
    </div>
  );
}

function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    height: 36, borderRadius: 10,
    border: "1px solid rgba(232,85,62,.38)",
    background: "rgba(232,85,62,.14)",
    color: "var(--accent, #E8553E)",
    padding: "0 14px", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
}
