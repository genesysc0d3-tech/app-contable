"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { aprobarPropuesta, rechazarPropuesta, aprobarTodas, editarMovimientoPropuesta } from "../../../revisar/actions";
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

const TIPO_LABELS: Record<string, string> = {
  boleta: "Boleta", factura_afecta: "Factura Afecta", factura_exenta: "Factura Exenta",
  boleta_honorarios: "Boleta Honorarios", transferencia_p2p: "Transferencia P2P",
  operacion_forex: "Forex", gasto_egreso: "Gasto", no_comercial: "No Comercial",
  compraventa_crypto: "Crypto", impuesto: "Impuesto", remuneracion: "Remuneración",
  arriendo: "Arriendo", comision: "Comisión", interes: "Interés", donacion: "Donación",
};

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
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<{ id: string; desc: string; monto: string } | null>(null);
  const [aprobandoTodas, setAprobandoTodas] = useState(false);

  const pendientes = useMemo(
    () => propuestas.filter(p => p.estado === "pendiente" && !p.notas?.startsWith("Agregado desde visor de omitidos")),
    [propuestas],
  );

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

  async function handleAprobar(id: string) {
    setProcessing(p => new Set(p).add(id));
    const r = await aprobarPropuesta(id);
    setProcessing(p => { const n = new Set(p); n.delete(id); return n; });
    if (r.error) toast(r.error, "error"); else { toast("Aprobada"); router.refresh(); }
  }
  async function handleRechazar(id: string) {
    setProcessing(p => new Set(p).add(id));
    const r = await rechazarPropuesta(id);
    setProcessing(p => { const n = new Set(p); n.delete(id); return n; });
    if (r.error) toast(r.error, "error"); else { toast("Rechazada"); router.refresh(); }
  }
  async function handleAprobarTodas() {
    const ids = pendientes.map(p => p.id);
    if (!ids.length) return;
    setAprobandoTodas(true);
    const r = await aprobarTodas(ids);
    if (r.error) toast(r.error, "error"); else toast(`${r.count} aprobadas`);
    setAprobandoTodas(false);
    router.refresh();
  }
  function goToEmitir() {
    window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "emitir" } }));
  }

  function startEdit(p: Propuesta) {
    setEditando({ id: p.id, desc: p.movimientos_raw?.descripcion ?? "", monto: String(p.movimientos_raw?.monto ?? "") });
  }

  async function guardarEdit() {
    if (!editando) return;
    setProcessing(p => new Set(p).add(editando.id));
    const prop = pendientes.find(p => p.id === editando.id);
    const editMontoNum = parseInt(editando.monto.replace(/\D/g, ""), 10) || 0;
    const r = await editarMovimientoPropuesta(editando.id, prop?.movimiento_id ?? "", { descripcion: editando.desc, monto: editMontoNum });
    setProcessing(p => { const n = new Set(p); n.delete(editando.id); return n; });
    if (r.error) toast(r.error, "error"); else { toast("Editada"); setEditando(null); router.refresh(); }
  }

  if (pendientes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" style={{ display: "block", margin: "0 auto 12px" }}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Todo revisado</div>
        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 20 }}>No hay propuestas pendientes de revisión</div>
        <button onClick={goToEmitir}
          style={{
            padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Continuar a Emitir
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Revisar propuestas</span>
          <span style={{ color: "var(--text2)", fontSize: 11, marginLeft: 8 }}>
            {pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {byDateDoc.map(({ date, docs }) => {
        const totalInDate = docs.reduce((s, d) => s + d.props.length, 0);
        return (
          <div key={date} style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{
              padding: "10px 14px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text2)",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
              {dayLabel(date)}
              <span style={{ color: "var(--text3)", fontWeight: 400 }}>({totalInDate})</span>
            </div>

            <div style={{ padding: 8 }}>
              {docs.map((doc, di) => (
                <div key={di}>
                  {di > 0 && <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 8px", fontSize: 10, color: "var(--text2)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{doc.docName}</span>
                    <span style={{ fontSize: 9, color: "var(--text3)", marginRight: 6 }}>{doc.props.length} movimiento{doc.props.length !== 1 ? "s" : ""}</span>
                    <button onClick={handleAprobarTodas} disabled={aprobandoTodas}
                      style={{
                        padding: "3px 10px", borderRadius: 5, border: "none", cursor: aprobandoTodas ? "not-allowed" : "pointer",
                        fontSize: 9, fontWeight: 700, background: "#E8553E", color: "#fff",
                        display: "flex", alignItems: "center", gap: 4, opacity: aprobandoTodas ? .6 : 1,
                      }}>
                      {aprobandoTodas ? (
                        <span style={{ width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                      {aprobandoTodas ? "..." : `Aprobar todas (${pendientes.length})`}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 6px 6px" }}>
                    {doc.props.map(p => {
                      const confianza = p.confianza ?? 0;
                      const isProcessing = processing.has(p.id);
                      const editing = editando?.id === p.id;
                      return (
                        <div key={p.id} style={{
                          padding: "10px 12px", borderRadius: 8,
                          background: "rgba(255,255,255,.02)", border: "1px solid var(--border)",
                          transition: "all .15s",
                        }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                              background: "rgba(232,85,62,.08)", color: "#E8553E",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {p.tipo_propuesto === "boleta" || p.tipo_propuesto === "boleta_honorarios" ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M9 18h6"/>
                                </svg>
                              ) : p.tipo_propuesto?.includes("factura") ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 12h8"/><path d="M8 15h6"/><path d="M8 18h4"/>
                                </svg>
                              ) : p.tipo_propuesto === "transferencia_p2p" ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
                                </svg>
                              ) : p.tipo_propuesto === "gasto_egreso" ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/><path d="M7 15h.01"/><path d="M11 15h.01"/>
                                </svg>
                              ) : p.tipo_propuesto === "operacion_forex" ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                                </svg>
                              )}
                            </div>

                            {editing ? (
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <input value={editando.desc} onChange={e => setEditando(prev => prev ? { ...prev, desc: e.target.value } : prev)}
                                  style={{ width: "100%", background: "var(--bg-muted)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "var(--text)", fontSize: 11, padding: "5px 8px", marginBottom: 4 }} />
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 9, color: "var(--text2)" }}>Monto CLP:</span>
                                  <input value={editando.monto} onChange={e => setEditando(prev => prev ? { ...prev, monto: e.target.value.replace(/\D/g, "") } : prev)}
                                    style={{ width: 140, background: "var(--bg-muted)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "var(--text)", fontSize: 11, padding: "3px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
                                </div>
                              </div>
                            ) : (
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", marginBottom: 2 }}>
                                  {p.movimientos_raw?.descripcion ?? "—"}
                                </div>
                                <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmt(p.movimientos_raw?.monto)}</span>
                                  <span style={{ color: "var(--text3)" }}>·</span>
                                  <span>{TIPO_LABELS[p.tipo_propuesto] ?? p.tipo_propuesto}</span>
                                  {p.receptor_nombre && (
                                    <>
                                      <span style={{ color: "var(--text3)" }}>·</span>
                                      <span>{p.receptor_nombre}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}

                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 18, fontWeight: 300, color: confianza >= 0.85 ? "var(--green)" : confianza >= 0.5 ? "var(--amber)" : "var(--accent)" }}>
                                {Math.round(confianza * 100)}%
                              </div>
                              <div style={{ fontSize: 7, color: "var(--text3)", textTransform: "uppercase" }}>Confianza</div>
                            </div>
                          </div>

                          <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,.04)", marginBottom: 10, overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 3, background: confianza >= 0.85 ? "var(--green)" : confianza >= 0.5 ? "var(--amber)" : "var(--accent)", width: `${confianza * 100}%`, transition: "width .4s" }} />
                          </div>

                          {editing ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={guardarEdit} disabled={isProcessing}
                                style={{
                                  flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                                  cursor: isProcessing ? "not-allowed" : "pointer", fontSize: 10, fontWeight: 600,
                                  background: "#22c55e", color: "#fff",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                  opacity: isProcessing ? .6 : 1, transition: "all .15s",
                                }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                {isProcessing ? "..." : "Guardar cambios"}
                              </button>
                              <button onClick={() => setEditando(null)}
                                style={{
                                  flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                                  cursor: "pointer", fontSize: 10, fontWeight: 600,
                                  background: "rgba(255,255,255,.06)", color: "var(--text2)",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                }}>
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => handleAprobar(p.id)} disabled={isProcessing}
                                style={{
                                  flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                                  cursor: isProcessing ? "not-allowed" : "pointer", fontSize: 10, fontWeight: 600,
                                  background: "rgba(34,197,94,.1)", color: "var(--green)",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                  opacity: isProcessing ? .6 : 1, transition: "all .15s",
                                }}>
                                {isProcessing ? (
                                  <span style={{ width: 12, height: 12, border: "2px solid rgba(34,197,94,.3)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                                ) : (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                )}
                                {isProcessing ? "Aprobando..." : "Aprobar"}
                              </button>
                              <button onClick={() => startEdit(p)}
                                style={{
                                  flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                                  cursor: "pointer", fontSize: 10, fontWeight: 600,
                                  background: "rgba(245,158,11,.08)", color: "var(--amber)",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                  transition: "all .15s",
                                }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                                Editar
                              </button>
                              <button onClick={() => handleRechazar(p.id)} disabled={isProcessing}
                                style={{
                                  flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                                  cursor: isProcessing ? "not-allowed" : "pointer", fontSize: 10, fontWeight: 600,
                                  background: "rgba(239,68,68,.08)", color: "#ef4444",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                  opacity: isProcessing ? .6 : 1, transition: "all .15s",
                                }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                Rechazar
                              </button>
                            </div>
                          )}
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
  );
}
