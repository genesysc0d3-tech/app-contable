"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { CreditCard, ExternalLink, Receipt } from "lucide-react";
import {
  obtenerFacturacion,
  listarResumenCupos,
  type FacturacionData,
  type ResumenCupos,
} from "./actions";
import UsageCountersPanel from "./UsageCountersPanel";

function fmtClp(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "America/Santiago",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const ESTADO_PAGO: Record<string, { label: string; color: string }> = {
  aprobado: { label: "Aprobado", color: "var(--green)" },
  approved: { label: "Aprobado", color: "var(--green)" },
  pendiente: { label: "Pendiente", color: "var(--amber)" },
  pending: { label: "Pendiente", color: "var(--amber)" },
  rechazado: { label: "Rechazado", color: "var(--red)" },
  rejected: { label: "Rechazado", color: "var(--red)" },
};

const ESTADO_SUB: Record<string, { label: string; color: string }> = {
  activa: { label: "Activa", color: "var(--green)" },
  pendiente: { label: "Pendiente de pago", color: "var(--amber)" },
  morosa: { label: "Morosa", color: "var(--red)" },
  pausada: { label: "Pausada", color: "var(--amber)" },
  cancelada: { label: "Cancelada", color: "var(--text3)" },
};

const TIPO_PAGO: Record<string, string> = {
  plan: "Plan mensual",
  refill: "Recarga de boletas",
  persona_adicional: "Persona adicional",
};

const cardStyle: CSSProperties = {
  padding: "14px 15px",
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  display: "grid",
  gap: 10,
};
const iconBox: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  color: "var(--accent)",
  background: "rgba(232,85,62,.1)",
  border: "1px solid var(--border)",
};
const badge: CSSProperties = {
  fontSize: 11,
  fontWeight: 850,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  whiteSpace: "nowrap",
  height: "fit-content",
};
const infoLine: CSSProperties = { fontSize: 10, color: "var(--text2)" };
const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 34,
  borderRadius: 10,
  border: "1px solid rgba(232,85,62,.5)",
  background: "linear-gradient(135deg,var(--accent),#cd5832)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 800,
  textDecoration: "none",
};

export default function FacturacionUsoPanel() {
  const [data, setData] = useState<FacturacionData | null>(null);
  const [resumen, setResumen] = useState<ResumenCupos | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "sin-cuenta" | "error">("cargando");

  // setState solo dentro del .then/.catch (callbacks async): llamarlo síncrono
  // en el efecto dispara react-hooks/set-state-in-effect. El estado inicial ya
  // es "cargando", así que el efecto no necesita resetearlo.
  const cargar = useCallback(
    () =>
      Promise.all([obtenerFacturacion(), listarResumenCupos()])
        .then(([fact, res]) => {
          if (fact.ok) setData(fact.data);
          if (res.ok) setResumen(res.resumen);
          if (fact.ok) setEstado("ok");
          else if (fact.error === "EMPRESA_SIN_CUENTA" || fact.error === "USUARIO_SIN_CUENTA")
            // Sin cuenta no es un error técnico: es "todavía no tienes plan".
            setEstado("sin-cuenta");
          else setEstado("error");
        })
        .catch(() => setEstado("error")),
    []
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const reintentar = () => {
    setEstado("cargando");
    void cargar();
  };

  if (estado === "cargando") {
    return <div style={{ padding: 20, color: "var(--text2)", fontSize: 12 }}>Cargando facturación…</div>;
  }
  if (estado === "sin-cuenta") {
    // Cuenta inexistente = usuario sin plan contratado: mismo diseño que la
    // card "Sin plan", no un bloque de error con Reintentar.
    return (
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={iconBox}>
            <CreditCard size={16} strokeWidth={2.2} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 850, color: "var(--text)" }}>Sin plan</div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 1 }}>
              Contrata un plan para emitir boletas masivas
            </div>
          </div>
        </div>
        <a href="/planes" style={primaryBtn}>
          Ver planes
          <ExternalLink size={13} strokeWidth={2.2} />
        </a>
      </section>
    );
  }
  if (estado === "error" || !data) {
    return (
      <div style={{ padding: 20, display: "grid", gap: 10, justifyItems: "start" }}>
        <div style={{ color: "var(--text2)", fontSize: 12 }}>No se pudo cargar la facturación.</div>
        <button
          type="button"
          onClick={reintentar}
          style={{ height: 30, padding: "0 14px", borderRadius: 10, border: "1px solid rgba(232,85,62,.5)", background: "rgba(232,85,62,.1)", color: "var(--accent)", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  const subEstado = data.suscripcion
    ? ESTADO_SUB[data.suscripcion.estado] ?? { label: data.suscripcion.estado, color: "var(--text2)" }
    : null;
  const enTrial = Boolean(data.trial?.activo) && !data.suscripcion;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Plan actual */}
      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={iconBox}>
              <CreditCard size={16} strokeWidth={2.2} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 850, color: "var(--text)" }}>
                {data.plan ? data.plan.nombre : enTrial ? "Prueba gratis" : "Sin plan"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 1 }}>
                {data.plan
                  ? `UF ${data.plan.ufMensual} / mes · ≈ ${fmtClp(data.plan.clpMensualConIva)} con IVA`
                  : "Contrata un plan para emitir boletas masivas"}
              </div>
            </div>
          </div>
          {subEstado ? (
            <span style={{ ...badge, color: subEstado.color, borderColor: `color-mix(in srgb, ${subEstado.color} 33%, transparent)` }}>
              {subEstado.label}
            </span>
          ) : enTrial ? (
            <span style={{ ...badge, color: "var(--amber)", borderColor: "color-mix(in srgb, var(--amber) 33%, transparent)" }}>Prueba</span>
          ) : null}
        </div>

        {enTrial && data.trial && (
          <div style={infoLine}>
            {data.trial.inicio
              ? `Prueba activa · ${data.trial.diasRestantes} ${data.trial.diasRestantes === 1 ? "día" : "días"} · ${data.trial.boletasUsadas}/${data.trial.boletasMax} boletas`
              : `Prueba gratis: tu primera emisión masiva activa ${data.trial.diasRestantes} días o ${data.trial.boletasMax} boletas.`}
          </div>
        )}
        {data.suscripcion?.estado === "activa" && data.suscripcion.proximoCobro && (
          <div style={infoLine}>
            Próximo cobro: {fmtFecha(data.suscripcion.proximoCobro)}
            {data.suscripcion.ultimoCobroClp != null && ` · último: ${fmtClp(data.suscripcion.ultimoCobroClp)}`}
          </div>
        )}

        <a href="/planes" style={primaryBtn}>
          {data.plan ? "Gestionar plan" : "Ver planes"}
          <ExternalLink size={13} strokeWidth={2.2} />
        </a>
      </section>

      {/* Uso del mes — reutiliza el panel existente en modo plano (la card
          "Plan actual" de arriba ya cumple el rol de la cara B del flip) */}
      {resumen && <UsageCountersPanel resumen={resumen} plain />}

      {/* Historial de pagos */}
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={iconBox}>
            <Receipt size={15} strokeWidth={2.2} />
          </span>
          <h3 style={{ fontSize: 11, fontWeight: 900, color: "var(--text)" }}>Historial de pagos</h3>
        </div>
        {data.pagos.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>
            Aún no hay pagos registrados.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {data.pagos.map((p) => {
              const e = ESTADO_PAGO[p.estado] ?? { label: p.estado, color: "var(--text2)" };
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "var(--bg-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {TIPO_PAGO[p.tipo] ?? p.tipo}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text2)" }}>{fmtFecha(p.fecha)}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 850, color: "var(--text)", whiteSpace: "nowrap" }}>
                    {fmtClp(p.montoClp)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 850, color: e.color, whiteSpace: "nowrap" }}>{e.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
