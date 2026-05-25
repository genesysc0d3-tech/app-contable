"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { aprobarPropuesta, rechazarPropuesta } from "../../../revisar/actions";
import type { Tables } from "@/lib/database.types";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw"> & {
    documentos_subidos: { id: string; nombre_archivo: string; created_at: string };
  };
};

function fmt(n: number | null | undefined) { return `$${Math.round(n ?? 0).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  const d = new Date(s + "T12:00:00");
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const ms = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${ms[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function RevisarFullView({
  propuestas, empresaId,
}: {
  propuestas: (Tables<"propuestas_ia"> & {
    movimientos_raw: Tables<"movimientos_raw"> & {
      documentos_subidos: { id: string; nombre_archivo: string; created_at: string };
    };
  })[];
  empresaId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pendientes = useMemo(
    () => propuestas.filter(p => p.estado === "pendiente" && !p.notas?.startsWith("Agregado desde visor de omitidos")),
    [propuestas],
  );

  // Group by date → document
  const byDateDoc = useMemo(() => {
    const dateMap = new Map<string, Map<string, Propuesta[]>>();
    for (const p of pendientes) {
      const dateKey = p.created_at?.slice(0, 10) ?? "sin-fecha";
      const doc = p.movimientos_raw?.documentos_subidos;
      const docKey = doc?.id ?? "__sin__";
      const docName = doc?.nombre_archivo ?? "Sin documento";
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
      const docMap = dateMap.get(dateKey)!;
      const entry = docMap.get(docKey) ?? [];
      entry.push(p);
      docMap.set(docKey, entry);
    }
    return Array.from(dateMap.entries()).sort(([a], [b]) => b.localeCompare(a))
      .map(([date, docMap]) => ({ date, docs: Array.from(docMap.entries()).map(([docId, props]) => ({ docId, docName: props[0]?.movimientos_raw?.documentos_subidos?.nombre_archivo ?? "Sin doc", props })) }));
  }, [pendientes]);

  const totalPendientes = pendientes.length;

  async function handleAprobar(id: string) {
    const r = await aprobarPropuesta(id);
    if (r.error) toast(r.error, "error"); else { toast("Aprobada"); router.refresh(); }
  }
  async function handleRechazar(id: string) {
    const r = await rechazarPropuesta(id);
    if (r.error) toast(r.error, "error"); else { toast("Rechazada"); router.refresh(); }
  }

  if (totalPendientes === 0) return (
    <div style={{ minHeight: 320, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text2)" }}>
      <style>{`@keyframes revisarCheck{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 rgba(34,197,94,0))}50%{transform:scale(1.08);filter:drop-shadow(0 0 18px rgba(34,197,94,.36))}}@keyframes revisarRing{0%{transform:scale(.78);opacity:.52}100%{transform:scale(1.25);opacity:0}}`}</style>
      <div>
        <div style={{ position: "relative", width: 104, height: 104, margin: "0 auto 14px" }}>
          <div style={{ position: "absolute", inset: 11, borderRadius: "50%", border: "1px solid rgba(34,197,94,.24)", animation: "revisarRing 2.6s ease-out infinite" }} />
          <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "#22c55e", animation: "revisarCheck 2.8s ease-in-out infinite" }}><path d="M48 78c16.568 0 30-13.432 30-30S64.568 18 48 18 18 31.432 18 48s13.432 30 30 30Z" stroke="currentColor" strokeWidth="4"/><path d="m35 48 9 9 19-21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em" }}>Todo despejado</div>
        <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, maxWidth: 270 }}>No hay propuestas pendientes para revisar en esta mesa.</div>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
        Propuestas pendientes <span style={{ color: "var(--text2)", fontWeight: 400 }}>· {totalPendientes} pendientes</span>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16, scrollbarWidth: "none" }}>
        {byDateDoc.map(({ date, docs }) => {
          const totalInDate = docs.reduce((s, d) => s + d.props.length, 0);
          return (
            <div key={date} style={{ minWidth: 250, maxWidth: 280, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", padding: "0 4px 8px", borderBottom: "1px solid var(--border)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                {dayLabel(date)} <span style={{ color: "var(--text3)" }}>({totalInDate})</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {docs.map((doc, di) => (
                  <div key={di}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 6px", fontSize: 9, color: "var(--text2)", borderTop: di > 0 ? "1px solid var(--border)" : "none" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{doc.docName}</span>
                      <span style={{ color: "var(--text3)", fontSize: 8 }}>({doc.props.length})</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {doc.props.map(p => {
                        const confianza = p.confianza ?? 0;
                        const confColor = confianza >= 0.85 ? "var(--green)" : confianza >= 0.5 ? "var(--amber)" : "var(--accent)";
                        return (
                          <div key={p.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 4, height: 4, borderRadius: "50%", background: confColor, flexShrink: 0 }} />
                              <span style={{ fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.movimientos_raw?.descripcion ?? "—"}</span>
                              <span style={{ fontSize: 9, fontWeight: 600, color: confColor }}>{Math.round(confianza * 100)}%</span>
                            </div>
                            <div style={{ fontSize: 9, color: "var(--text2)", marginBottom: 6 }}>{fmt(p.movimientos_raw?.monto)} · {p.receptor_nombre ?? "Sin receptor"}</div>
                            <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,.06)", marginBottom: 6 }}><div style={{ height: "100%", borderRadius: 2, background: confColor, width: `${confianza * 100}%` }} /></div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={() => handleAprobar(p.id)} style={{ flex: 1, padding: "3px 0", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 600, background: "rgba(34,197,94,.1)", color: "var(--green)" }}>✓ Aprobar</button>
                              <button onClick={() => handleRechazar(p.id)} style={{ flex: 1, padding: "3px 0", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 600, background: "rgba(239,68,68,.1)", color: "var(--accent)" }}>✕ Rechazar</button>
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
        })}
      </div>
    </div>
  );
}
