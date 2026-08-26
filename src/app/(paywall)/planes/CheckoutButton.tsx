"use client";

import { useState, type ReactNode } from "react";

/**
 * Botón de compra: pide la URL a /api/pagos/checkout y redirige a la pasarela.
 * Si los pagos aún no están configurados (503), muestra "próximamente" sin
 * romper la página.
 *
 * El copy es NEUTRO a propósito (no nombra la pasarela): con Flow el cliente no
 * va a "pagar" sino a inscribir su tarjeta, y el nombre de la marca en el botón
 * ya obligó a cambiarlo una vez. Lo que el cliente necesita saber es a qué va,
 * no con quién.
 */
export default function CheckoutButton({
  tipo,
  plan,
  actual = false,
  label,
  recommended = false,
  inscribeTarjeta = false,
}: {
  tipo: "plan" | "refill" | "persona_adicional";
  plan?: string;
  actual?: boolean;
  label?: string;
  recommended?: boolean;
  /** Flow: contratar = inscribir tarjeta para cargo automático, no pagar una vez. */
  inscribeTarjeta?: boolean;
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
        | { ok?: boolean; url?: string; cobrado?: boolean; programado?: boolean; desde?: string; error?: string; detalle?: string }
        | null;
      if (res.ok && data?.ok && data.url) {
        window.location.href = data.url;
        return; // mantiene "Abriendo…" mientras navega
      }
      if (res.ok && data?.ok && data.programado) {
        // Downgrade: nada cambia hoy — el plan actual ya está pagado entero.
        setMensaje(`Listo: tu plan cambia el ${data.desde ?? "próximo cobro"}. Hasta entonces conservas el actual.`);
        setCargando(false);
        return;
      }
      if (res.ok && data?.ok && data.cobrado) {
        // Cobro directo a la tarjeta inscrita: no hay pasarela a la que ir.
        // Recarga para que la página muestre la cuota/el extra ya aplicado.
        setMensaje("¡Listo! Cobrado a tu tarjeta registrada.");
        setTimeout(() => window.location.reload(), 1400);
        return;
      }
      if (data?.error === "MISMO_PLAN") {
        setMensaje("Ese ya es tu plan actual.");
        setCargando(false);
        return;
      }
      if (data?.error === "SIN_TARJETA") {
        setMensaje("No tienes una tarjeta registrada — contrata o renueva tu plan primero.");
        setCargando(false);
        return;
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
        {cargando ? "Abriendo…" : label ?? (tipo === "plan" ? "Contratar plan" : "Comprar extra")}
      </button>
      {/* El cobro de validación de $50 se avisa ANTES de mandarlo, no después:
          es un cargo real que aparece en su cartola y, sin aviso, llama. */}
      {inscribeTarjeta && tipo === "plan" && !mensaje && (
        <p style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", margin: 0, lineHeight: 1.45 }}>
          Registras tu tarjeta y se cobra el primer mes. Sirve crédito, débito o prepago.
          <br />
          Al registrarla se hace un cargo de $50 que se devuelve.
        </p>
      )}
      {mensaje && (
        <p style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", margin: 0 }}>{mensaje}</p>
      )}
    </div>
  );
}
