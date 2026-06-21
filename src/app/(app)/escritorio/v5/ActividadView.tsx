"use client";

import { formatShortDateEsCl } from "@/lib/display-date";

export interface ActividadItem {
  id: string;
  tipo: "subida" | "emision" | "aprobacion" | "rechazo";
  descripcion: string;
  detalle: string;
  fecha: string;
  monto?: number;
}

function timeAgo(dateStr: string): string {
  return formatShortDateEsCl(dateStr) || "sin fecha";
}

export default function ActividadView({ items = [] }: { items?: ActividadItem[] }) {
  function volverAlDashboard() {
    window.dispatchEvent(new CustomEvent("switch-view", { detail: "dashboard" }));
  }

  const iconMap: Record<string, string> = {
    subida: "M12 5v14m-7-7l7-7 7 7",
    emision: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    aprobacion: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    rechazo: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={volverAlDashboard}
          style={{ width: 28, height: 28, borderRadius: 6, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 14 }}>
          ←
        </button>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Registro de Actividad</h2>
      </div>

      <div className="r-scroll" style={{ flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--text3)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <p style={{ fontSize: 11, color: "var(--text2)" }}>Aún no hay actividad registrada</p>
          </div>
        ) : (
          <div style={{ padding: "8px 16px" }}>
            {items.map(item => (
              <div key={item.id} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0",
                borderBottom: "1px solid var(--border)",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: item.tipo === "emision" ? "var(--accent-light)" : item.tipo === "subida" ? "rgba(180,240,39,.08)" : item.tipo === "aprobacion" ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
                  color: item.tipo === "emision" ? "#E8553E" : item.tipo === "subida" ? "#b4f027" : item.tipo === "aprobacion" ? "#22c55e" : "#ef4444",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={iconMap[item.tipo] ?? iconMap.subida} /></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", marginBottom: 1 }}>{item.descripcion}</div>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>{item.detalle}</div>
                  {item.monto != null && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", marginTop: 2 }}>
                      ${item.monto.toLocaleString("es-CL")}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 9, color: "var(--text3)", flexShrink: 0, whiteSpace: "nowrap" }}>{timeAgo(item.fecha)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
