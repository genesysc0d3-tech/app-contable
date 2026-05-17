"use client";

import { useMemo } from "react";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";

interface BoletaRow {
  id: string; folio: number | null; tipo_dte: number; fecha_emision: string;
  receptor_razon_social: string | null; monto_total: number; estado: string;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  const d = new Date(s + "T12:00:00");
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const __meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; return __meses[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

export default function BoletasFullView({ boletas }: { boletas: BoletaRow[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, BoletaRow[]>();
    for (const b of boletas) {
      const key = b.fecha_emision?.slice(0, 10) ?? "sin-fecha";
      const arr = m.get(key) ?? [];
      arr.push(b);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [boletas]);

  const montoTotal = boletas.reduce((s, b) => s + (b.estado !== "anulada" ? b.monto_total : 0), 0);

  if (boletas.length === 0) {
    return <div style={{ textAlign: "center", padding: 60, fontSize: 11, color: "var(--text2)" }}>No hay boletas emitidas</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
        Boletas emitidas <span style={{ color: "var(--text2)", fontWeight: 400 }}>· {boletas.length} boletas · {fmt(montoTotal)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16, scrollbarWidth: "none" }}>
        {byDate.map(([date, items]) => (
          <div key={date} style={{ minWidth: 220, maxWidth: 240, flexShrink: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: "var(--text2)", padding: "0 4px 8px",
              borderBottom: "1px solid var(--border)", marginBottom: 8,
            }}>
              {dayLabel(date)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {items.map(b => {
                const anulada = b.estado === "anulada";
                return (
                  <div key={b.id} style={{
                    padding: "8px 10px", borderRadius: 8,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    opacity: anulada ? .5 : 1, transition: "all .15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 4, background: "var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--text2)",
                      }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600 }}>#{b.folio}</span>
                      <span style={{
                        fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600,
                        background: b.tipo_dte === 39 ? "rgba(232,85,62,.1)" : "rgba(91,156,246,.1)",
                        color: b.tipo_dte === 39 ? "#E8553E" : "var(--blue)",
                      }}>
                        {b.tipo_dte === 39 ? "AFE" : "EXE"}
                      </span>
                      {anulada && <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600, background: "var(--border)", color: "var(--text2)" }}>ANULADA</span>}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.receptor_razon_social ?? "Sin receptor"}
                      </span>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmt(b.monto_total)}</span>
                    </div>
                    <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>
                      <DescargarBoletaButton id={b.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
