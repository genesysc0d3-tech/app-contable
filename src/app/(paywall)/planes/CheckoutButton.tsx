"use client";

import { useState, type ReactNode } from "react";

/**
 * Botón de compra: pide el init_point a /api/pagos/checkout y redirige a
 * Mercado Pago. Si los pagos aún no están configurados (503), muestra el
 * mensaje "próximamente" sin romper la página.
 */
export default function CheckoutButton({
  tipo,
  plan,
  actual = false,
  label,
  recommended = false,
}: {
  tipo: "plan" | "refill" | "persona_adicional";
  plan?: string;
  actual?: boolean;
  label?: string;
  recommended?: boolean;
}) {
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<ReactNode>(null);

  if (actual) {
    return (
      <div
        style={{
          width: "100%",
          textAlign: "center",
          padding: "9px 12px",
          borderRadius: 9,
          border: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 650,
          color: "var(--muted)",
        }}
      >
        Plan vigente
      </div>
    );
  }

  async function comprar() {
    if (cargando) return;
    setCargando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/pagos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipo === "plan" ? { tipo, plan } : { tipo }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string; detalle?: string }
        | null;
      if (res.ok && data?.ok && data.url) {
        window.location.href = data.url;
        return; // mantiene "Abriendo…" mientras navega
      }
      if (res.status === 503 || data?.error === "MP_NO_CONFIGURADO") {
        // TODO: cablear correo de soporte cuando exista la casilla (AlphaCode SpA).
        setMensaje("Pagos próximamente — te contactaremos para activar tu plan.");
      } else if (res.status === 403) {
        setMensaje("Tu cuenta no puede contratar este plan desde este acceso.");
      } else {
        setMensaje(data?.detalle ?? "No se pudo iniciar el pago — intenta de nuevo.");
      }
    } catch {
      setMensaje("No se pudo iniciar el pago — revisa tu conexión.");
    }
    setCargando(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={comprar}
        disabled={cargando}
        style={{
          width: "100%",
          padding: "11px 12px",
          borderRadius: 11,
          border: recommended ? "1px solid #E8553E" : "1px solid rgba(232,85,62,.45)",
          background: recommended ? "#E8553E" : "rgba(232,85,62,.10)",
          color: recommended ? "#fff" : "#E8553E",
          fontSize: 13,
          fontWeight: 700,
          cursor: cargando ? "default" : "pointer",
          opacity: cargando ? 0.6 : 1,
          transition: "background .2s, border-color .2s, opacity .2s",
        }}
      >
        {cargando ? "Abriendo Mercado Pago…" : label ?? (tipo === "plan" ? "Contratar con Mercado Pago" : "Comprar extra")}
      </button>
      {mensaje && (
        <p style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", margin: 0 }}>{mensaje}</p>
      )}
    </div>
  );
}
