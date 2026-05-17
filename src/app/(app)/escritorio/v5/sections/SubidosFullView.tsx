"use client";

import { useMemo } from "react";

interface DocRaw {
  id: string; nombre_archivo: string; tipo: string; estado: string;
  movimientos_detectados: number | null; created_at: string; progreso_ia: unknown;
}

const stColors: Record<string, string> = { procesado: "#22c55e", procesando: "#5b9cf6", error: "#ef4444", subido: "#f59e0b" };
const stLabels: Record<string, string> = { procesado: "Listo", procesando: "Procesando", error: "Error", subido: "Pendiente" };
const tipoIcons: Record<string, string> = { excel: "XLS", pdf: "PDF", csv: "CSV", imagen: "IMG", whatsapp: "WP" };

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
    return <div style={{ textAlign: "center", padding: 60, fontSize: 11, color: "var(--text2)" }}>No hay documentos subidos</div>;
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
              {docs.map(doc => (
                <div key={doc.id} style={{
                  padding: "8px 10px", borderRadius: 8, background: "var(--surface)",
                  border: "1px solid var(--border)", transition: "all .15s", cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: stColors[doc.estado] ?? "var(--text2)", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: "var(--text)" }}>
                      {doc.nombre_archivo}
                    </span>
                    <span style={{ fontSize: 8, fontWeight: 600, color: stColors[doc.estado] ?? "var(--text2)" }}>
                      {stLabels[doc.estado] ?? doc.estado}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 8, color: "var(--text2)" }}>
                    <span style={{ padding: "1px 4px", borderRadius: 3, background: "var(--bg-muted)" }}>
                      {tipoIcons[doc.tipo] ?? doc.tipo}
                    </span>
                    {doc.movimientos_detectados != null && (
                      <span>{doc.movimientos_detectados} mov</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
