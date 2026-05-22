"use client";

import { useMemo } from "react";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";
import VerBoletaButton from "@/components/boletas/VerBoletaButton";

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
  const ms = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; return ms[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

const TIPO_INFO: Record<number, { label: string; color: string; bg: string }> = {
  39: { label: "AFECTA", color: "#E8553E", bg: "rgba(232,85,62,.1)" },
  41: { label: "EXENTA", color: "#3B82F6", bg: "rgba(59,130,246,.1)" },
  61: { label: "N/C", color: "#7C3AED", bg: "rgba(124,58,237,.1)" },
};

function folioLabel(f: number | null): string {
  if (f == null) return "Folio N°---";
  return `Folio N°${String(f).padStart(3, "0")}`;
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

  const stats = useMemo(() => {
    let activas = 0, anuladas = 0, total = 0;
    for (const b of boletas) {
      if (b.estado === "anulada") anuladas++;
      else { activas++; total += b.monto_total; }
    }
    return { activas, anuladas, total };
  }, [boletas]);

  if (boletas.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="1.5" style={{ display: "block", margin: "0 auto 12px" }}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>No hay boletas emitidas</div>
        <div style={{ fontSize: 10, color: "var(--text2)" }}>Las boletas emitidas aparecerán aquí</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Summary card */}
      <div style={{
        background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)",
        padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "rgba(180,240,39,.08)", color: "#b4f027",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 500 }}>Total boletas emitidas</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {stats.activas} {stats.anuladas > 0 && <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 400 }}>({stats.anuladas} anulada{stats.anuladas !== 1 ? "s" : ""})</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 500 }}>Total $</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
              {fmt(stats.total)}
            </div>
          </div>
          <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "subir" } }))}
            style={{
              padding: "7px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,.08)",
              background: "transparent", color: "var(--text2)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 500,
              transition: "all .15s", whiteSpace: "nowrap",
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14m-7-7l7-7 7 7"/>
            </svg>
            Nueva carga
          </button>
        </div>
      </div>

      {byDate.map(([date, items]) => (
        <div key={date} style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text2)",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {dayLabel(date)}
            <span style={{ color: "var(--text3)", fontWeight: 400 }}>({items.length})</span>
          </div>

          <div style={{ padding: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 6px 6px" }}>
              {items.map(b => {
                const anulada = b.estado === "anulada";
                const info = TIPO_INFO[b.tipo_dte] ?? { label: `DTE ${b.tipo_dte}`, color: "var(--text2)", bg: "var(--bg-muted)" };
                return (
                  <div key={b.id} style={{
                    padding: "10px 12px", borderRadius: 8,
                    background: "rgba(255,255,255,.02)", border: "1px solid var(--border)",
                    opacity: anulada ? .5 : 1, transition: "all .15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                        background: "rgba(180,240,39,.08)", color: "#b4f027",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {b.folio ?? "—"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                            {folioLabel(b.folio)}
                          </span>
                          <span style={{
                            fontSize: 7, padding: "1px 6px", borderRadius: 3, fontWeight: 700,
                            background: info.bg, color: info.color,
                          }}>
                            {info.label}
                          </span>
                          {anulada && (
                            <span style={{
                              fontSize: 7, padding: "1px 6px", borderRadius: 3, fontWeight: 700,
                              background: "rgba(239,68,68,.1)", color: "#ef4444",
                            }}>
                              ANULADA
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--text2)" }}>
                          {b.receptor_razon_social ?? "Sin receptor"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
                          {fmt(b.monto_total)}
                        </div>
                        <div style={{ display: "flex", gap: 2 }}>
                          <VerBoletaButton id={b.id} />
                          <DescargarBoletaButton id={b.id} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Footer — Nueva carga */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, textAlign: "center" }}>
        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 10 }}>
          ¿Finalizaste con estas boletas?
        </div>
        <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "subir" } }))}
          style={{
            padding: "10px 28px", borderRadius: 8, border: "none",
            background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14m-7-7l7-7 7 7"/>
          </svg>
          Nueva carga
        </button>
      </div>
    </div>
  );
}
