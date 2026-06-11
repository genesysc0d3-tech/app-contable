"use client";

import { useMemo } from "react";

interface DocRaw {
  id: string; nombre_archivo: string; tipo: string; estado: string;
  movimientos_detectados: number | null; created_at: string; progreso_ia: unknown;
}

const stColors: Record<string, string> = { procesado: "#22c55e", procesando: "#5b9cf6", error: "#ef4444", subido: "#f59e0b" };
const stLabels: Record<string, string> = { procesado: "Listo", procesando: "Procesando", error: "Error", subido: "Pendiente" };
const tipoIcons: Record<string, string> = { excel: "XLS", pdf: "PDF", csv: "CSV", imagen: "IMG", whatsapp: "WP", boleta_unica: "DTE" };

function dayLabel(s: string) {
  const d = new Date(s + "T12:00:00");
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const __meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; return __meses[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

export default function SubidosFullView({ documentos }: { documentos: DocRaw[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, DocRaw[]>();
    for (const d of documentos) {
      const key = d.created_at?.slice(0, 10) ?? "sin-fecha";
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [documentos]);

  if (documentos.length === 0) {
    return (
      <div style={{ minHeight: 320, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text2)" }}>
        <style>{`@keyframes subidosFloat{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-8px) rotate(1deg)}}@keyframes subidosPulse{0%,100%{opacity:.28;transform:scale(.92)}50%{opacity:.7;transform:scale(1.05)}}`}</style>
        <div>
          <div style={{ position: "relative", width: 98, height: 98, margin: "0 auto 14px", animation: "subidosFloat 3.2s ease-in-out infinite" }}>
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 17, height: 14, borderRadius: "50%", background: "rgba(232,85,62,.22)", filter: "blur(10px)", animation: "subidosPulse 3.2s ease-in-out infinite" }} />
            <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "#E8553E" }}><path d="M30 72h36a8 8 0 0 0 8-8V34L56 16H30a8 8 0 0 0-8 8v40a8 8 0 0 0 8 8Z" stroke="currentColor" strokeWidth="4"/><path d="M55 16v17h18" stroke="currentColor" strokeWidth="4"/><path d="M35 49h26M35 59h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em" }}>Nada por aquí</div>
          <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, maxWidth: 260 }}>Cuando agregues documentos, aparecerán ordenados por fecha en esta mesa.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
        Documentos subidos <span style={{ color: "var(--text2)", fontWeight: 400 }}>· {documentos.length} total</span>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16, scrollbarWidth: "none" }}>
        {byDate.map(([date, docs]) => (
          <div key={date} style={{ minWidth: 200, maxWidth: 220, flexShrink: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: "var(--text2)", padding: "0 4px 8px",
              borderBottom: "1px solid var(--border)", marginBottom: 8,
            }}>
              {dayLabel(date)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {docs.map(doc => {
                const isBoletaUnica = doc.tipo === "boleta_unica";
                return (
                <div key={doc.id} style={{
                  padding: isBoletaUnica ? "6px 8px" : "8px 10px", borderRadius: 8, background: isBoletaUnica ? "rgba(232,85,62,.045)" : "var(--surface)",
                  border: isBoletaUnica ? "1px dashed rgba(232,85,62,.55)" : "1px solid var(--border)", transition: "all .15s", cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: isBoletaUnica ? 5 : 7, marginBottom: isBoletaUnica ? 3 : 4 }}>
                    {isBoletaUnica && (
                      <span style={{ width: 18, height: 18, borderRadius: 5, border: "1px dashed rgba(232,85,62,.75)", display: "grid", placeItems: "center", color: "#E8553E", fontSize: 7, fontWeight: 900, flexShrink: 0 }}>B1</span>
                    )}
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: stColors[doc.estado] ?? "var(--text2)", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: "var(--text)" }}>
                      {doc.nombre_archivo}
                    </span>
                    <span style={{ fontSize: 8, fontWeight: 600, color: stColors[doc.estado] ?? "var(--text2)" }}>
                      {stLabels[doc.estado] ?? doc.estado}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 8, color: "var(--text2)" }}>
                    <span style={{ padding: "1px 4px", borderRadius: 3, background: isBoletaUnica ? "rgba(232,85,62,.12)" : "var(--bg-muted)", color: isBoletaUnica ? "#E8553E" : undefined, fontWeight: isBoletaUnica ? 800 : undefined }}>
                      {tipoIcons[doc.tipo] ?? doc.tipo}
                    </span>
                    {isBoletaUnica && <span style={{ color: "#E8553E", fontWeight: 800 }}>Boleta unica</span>}
                    {doc.movimientos_detectados != null && (
                      <span>{doc.movimientos_detectados} mov</span>
                    )}
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
