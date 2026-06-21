"use client";

import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/components/Toast";
import { formatShortDateEsCl } from "@/lib/display-date";
import { addDaysIso, chileDateString } from "@/lib/chile-date";

interface EmitItem {
  id: string; descripcion: string; fecha: string;
  receptor_nombre: string | null; receptor_rut: string | null;
  monto_total: number; listo_emitir: boolean;
  motivo_no_listo: string | null; tipo_sugerido: number | null;
  motivo_code: "no_boletar" | "monto_invalido" | "falta_receptor" | null;
  documento_id: string | null; documento_nombre: string | null;
  documento_created_at: string | null;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  if (!s || s === "sin-fecha") return "Sin fecha";
  const hoy = chileDateString();
  if (s === hoy) return "Hoy";
  if (s === addDaysIso(hoy, -1)) return "Ayer";
  return formatShortDateEsCl(s, true).replace(/^(\d+) (\w+) (.+)$/, "$2 $1, $3");
}

function nextActionLabel(code: EmitItem["motivo_code"]): string | null {
  if (code === "falta_receptor") return "Completa receptor en Revisar";
  if (code === "monto_invalido") return "Corrige el monto en Revisar";
  if (code === "no_boletar") return "Revisa la clasificacion antes de emitir";
  return null;
}

export default function EmitirFullView({}: { empresaId: string }) {
  const [items, setItems] = useState<EmitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/intermediaria/pendientes-emision")
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.items); })
      .catch(() => toast("Error al cargar", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

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
  if (items.length === 0) return (
    <div style={{ minHeight: 320, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text2)" }}>
      <style>{`@keyframes emitirBolt{0%,100%{transform:translateY(0) scale(1);filter:drop-shadow(0 0 0 rgba(180,240,39,0))}45%{transform:translateY(-7px) scale(1.04);filter:drop-shadow(0 0 20px rgba(180,240,39,.34))}}@keyframes emitirSpark{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-6px)}}`}</style>
      <div>
        <div style={{ position: "relative", width: 106, height: 106, margin: "0 auto 14px", animation: "emitirBolt 2.7s ease-in-out infinite" }}>
          <span style={{ position: "absolute", left: 22, top: 23, width: 5, height: 5, borderRadius: "50%", background: "#b4f027", animation: "emitirSpark 2.1s ease-in-out infinite" }} />
          <span style={{ position: "absolute", right: 22, bottom: 25, width: 4, height: 4, borderRadius: "50%", background: "#b4f027", animation: "emitirSpark 2.1s ease-in-out .45s infinite" }} />
          <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "#b4f027" }}><path d="M56 11 25 53h22l-6 32 31-47H50l6-27Z" fill="rgba(180,240,39,.16)" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round"/><path d="M56 11 25 53h22l-6 32 31-47H50l6-27Z" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="52" style={{animation:"emitirSpark 2.2s ease-in-out infinite"}}/></svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em" }}>Nada listo para emitir</div>
        <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, maxWidth: 280 }}>Cuando una propuesta quede lista, aparecerá aquí para emitirla sin salir de la mesa.</div>
      </div>
    </div>
  );

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
                        {!ready && item.motivo_no_listo && <div style={{ fontSize: 8, color: "var(--amber)", marginTop: 4 }}>{item.motivo_no_listo}{nextActionLabel(item.motivo_code) ? <><br />{nextActionLabel(item.motivo_code)}</> : null}</div>}
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
