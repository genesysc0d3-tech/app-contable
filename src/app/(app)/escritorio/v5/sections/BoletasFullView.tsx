"use client";

import { useMemo } from "react";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";
import PreviewBoletaButton from "@/components/boletas/PreviewBoletaButton";
import { formatShortDateEsCl } from "@/lib/display-date";
import { addDaysIso, chileDateString } from "@/lib/chile-date";

interface BoletaRow {
  id: string; folio: number | null; tipo_dte: number; fecha_emision: string;
  receptor_razon_social: string | null; monto_total: number; estado: string;
  // Emisión directa (boleta única): se marca distinto y muestra su glosa,
  // porque sin receptor el detalle es la única forma de reconocerla.
  es_unica?: boolean; detalle?: string;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  if (!s || s === "sin-fecha") return "Sin fecha";
  const hoy = chileDateString();
  if (s === hoy) return "Hoy";
  if (s === addDaysIso(hoy, -1)) return "Ayer";
  return formatShortDateEsCl(s, true).replace(/^(\d+) (\w+) (.+)$/, "$2 $1, $3");
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
    return (
      <div style={{ minHeight: 320, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text2)" }}>
        <style>{`@keyframes boletaDrift{0%,100%{transform:translateY(0) rotate(.5deg)}50%{transform:translateY(-7px) rotate(-.8deg)}}@keyframes boletaLine{0%{stroke-dashoffset:48;opacity:.25}50%{opacity:1}100%{stroke-dashoffset:0;opacity:.35}}`}</style>
        <div>
          <div style={{ position: "relative", width: 102, height: 104, margin: "0 auto 14px", animation: "boletaDrift 3.1s ease-in-out infinite" }}>
            <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "#3B82F6" }}><path d="M29 15h30l12 12v54H29a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="4"/><path d="M59 16v13h13" stroke="currentColor" strokeWidth="4"/><path d="M35 45h26M35 56h20M35 67h27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="48" style={{ animation: "boletaLine 2.8s ease-in-out infinite" }}/></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em" }}>Aún no hay boletas</div>
          <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, maxWidth: 270 }}>Las boletas emitidas desde esta mesa quedarán registradas aquí.</div>
        </div>
      </div>
    );
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
                    background: b.es_unica ? "rgba(232,85,62,.035)" : "var(--surface)",
                    border: b.es_unica ? "1px dashed rgba(232,85,62,.45)" : "1px solid var(--border)",
                    opacity: anulada ? .5 : 1, transition: "all .15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 4,
                        background: b.es_unica ? "rgba(232,85,62,.1)" : "var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        color: b.es_unica ? "#E8553E" : "var(--text2)",
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
                        {b.tipo_dte === 39 ? "AFECTA" : "EXENTA"}
                      </span>
                      {b.es_unica && <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 800, border: "1px dashed rgba(232,85,62,.55)", background: "rgba(232,85,62,.06)", color: "#E8553E" }}>ÚNICA</span>}
                      {anulada && <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600, background: "var(--border)", color: "var(--text2)" }}>ANULADA</span>}
                    </div>
                    {b.es_unica && b.detalle && (
                      <div style={{ fontSize: 9, color: "var(--text)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.detalle}</div>
                    )}
                    <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.receptor_razon_social ?? "Sin receptor"}
                      </span>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmt(b.monto_total)}</span>
                    </div>
                    <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>
                      <PreviewBoletaButton id={b.id} />
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
