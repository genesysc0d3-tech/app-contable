"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

interface EmitItem {
  id: string; descripcion: string; fecha: string;
  receptor_nombre: string | null; receptor_rut: string | null;
  monto_total: number; listo_emitir: boolean;
  motivo_no_listo: string | null; tipo_sugerido: number | null;
  documento_id: string | null; documento_nombre: string | null;
  documento_created_at: string | null;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  const d = new Date(s + "T12:00:00");
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const ms = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${ms[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtCorta(s: string) {
  const d = new Date(s); if (isNaN(d.getTime())) return "";
  const ms = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d.getDate()} ${ms[d.getMonth()]}`;
}

export default function EmitirFullView({ empresaId }: { empresaId: string }) {
  const [items, setItems] = useState<EmitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    fetch("/api/intermediaria/pendientes-emision")
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.items); })
      .catch(() => toast("Error al cargar", "error"))
      .finally(() => setLoading(false));
  }, []);

  // Group by document upload date → document → items
  const byDateDoc = useMemo(() => {
    const dateMap = new Map<string, Map<string, { docName: string; items: EmitItem[] }>>();
    for (const i of items) {
      const uploadDate = (i.documento_created_at ?? i.fecha).slice(0, 10);
      const docId = i.documento_id ?? "__sin__";
      const docName = i.documento_nombre ?? "Sin documento";
      if (!dateMap.has(uploadDate)) dateMap.set(uploadDate, new Map());
      const docMap = dateMap.get(uploadDate)!;
      if (!docMap.has(docId)) docMap.set(docId, { docName, items: [] });
      docMap.get(docId)!.items.push(i);
    }
    return Array.from(dateMap.entries()).sort(([a], [b]) => b.localeCompare(a))
      .map(([date, docMap]) => ({ date, docs: Array.from(docMap.values()) }));
  }, [items]);

  if (loading) return <div style={{ textAlign: "center", padding: 60, fontSize: 11, color: "var(--text2)" }}>Cargando...</div>;
  if (items.length === 0) return <div style={{ textAlign: "center", padding: 60, fontSize: 11, color: "var(--text2)" }}>No hay items para emitir</div>;

  const listos = items.filter(i => i.listo_emitir);
  const bloqueados = items.filter(i => !i.listo_emitir);

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
        Pendientes de emisión
        <span style={{ color: "var(--green)", fontWeight: 500, marginLeft: 8 }}>{listos.length} listos</span>
        {bloqueados.length > 0 && <span style={{ color: "var(--amber)", fontWeight: 500, marginLeft: 6 }}>· {bloqueados.length} bloqueados</span>}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16, scrollbarWidth: "none" }}>
        {byDateDoc.map(({ date, docs }) => (
          <div key={date} style={{ minWidth: 240, maxWidth: 260, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", padding: "0 4px 8px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
              {dayLabel(date)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {docs.map((doc, di) => (
                <div key={di}>
                  {/* Document header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 6px", fontSize: 9, color: "var(--text2)", borderTop: di > 0 ? "1px solid var(--border)" : "none" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{doc.docName}</span>
                  </div>
                  {/* Items */}
                  {doc.items.map(item => {
                    const ready = item.listo_emitir;
                    return (
                      <div key={item.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", opacity: ready ? 1 : .6, cursor: ready ? "pointer" : "not-allowed", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: ready ? "var(--green)" : "var(--amber)", flexShrink: 0, boxShadow: ready ? "0 0 5px rgba(34,197,94,.3)" : "0 0 5px rgba(245,158,11,.3)" }} />
                          <span style={{ fontSize: 10, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.descripcion}</span>
                          <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, fontWeight: 600, background: ready ? "rgba(34,197,94,.1)" : "rgba(245,158,11,.1)", color: ready ? "var(--green)" : "var(--amber)" }}>{ready ? "Listo" : "Bloqueado"}</span>
                        </div>
                        <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", justifyContent: "space-between" }}>
                          <span>{item.fecha.slice(5)} · {item.receptor_nombre ?? "Sin receptor"}</span>
                          <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmt(item.monto_total)}</span>
                        </div>
                        {!ready && item.motivo_no_listo && <div style={{ fontSize: 8, color: "var(--amber)", marginTop: 4 }}>{item.motivo_no_listo}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
