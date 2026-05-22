"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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

const TIPO_BADGE: Record<number, { label: string; color: string }> = {
  39: { label: "AFECTA", color: "#E8553E" },
  41: { label: "EXENTA", color: "#3B82F6" },
  61: { label: "NC", color: "#7C3AED" },
};

export default function EmitirFullView({ empresaId }: { empresaId: string }) {
  const [items, setItems] = useState<EmitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [emitiendo, setEmitiendo] = useState<Set<string>>(new Set());
  const [emitiendoTodas, setEmitiendoTodas] = useState(false);
  const [emitidas, setEmitidas] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    fetch("/api/intermediaria/pendientes-emision")
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.items); })
      .catch(() => toast("Error al cargar", "error"))
      .finally(() => setLoading(false));
  }, []);

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

  async function handleEmitir(item: EmitItem) {
    setEmitiendo(p => new Set(p).add(item.id));
    try {
      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_dte: item.tipo_sugerido ?? 39,
          receptor_rut: item.receptor_rut || undefined,
          receptor_razon_social: item.receptor_nombre || undefined,
          monto_total: item.monto_total,
          detalles: [{ nombre: item.descripcion, monto: item.monto_total }],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmitidas(prev => new Set(prev).add(item.id));
        toast(`Boleta #${data.folio} emitida`);
      } else {
        toast(data.error ?? "Error al emitir", "error");
        setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
        return;
      }
    } catch {
      toast("Error de red", "error");
      setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
      return;
    }
    setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
  }

  function goToVisualizar() {
    window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "visualizar" } }));
  }

  async function handleEmitirTodas() {
    const listos = items.filter(i => i.listo_emitir);
    if (!listos.length) return;
    setEmitiendoTodas(true);
    let ok = 0, fail = 0;
    for (const item of listos) {
      try {
        setEmitiendo(p => new Set(p).add(item.id));
        const res = await fetch("/api/intermediaria/emitir-boleta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo_dte: item.tipo_sugerido ?? 39,
            receptor_rut: item.receptor_rut || undefined,
            receptor_razon_social: item.receptor_nombre || undefined,
            monto_total: item.monto_total,
            detalles: [{ nombre: item.descripcion, monto: item.monto_total }],
          }),
        });
        const data = await res.json();
        if (data.ok) { ok++; setEmitidas(prev => new Set(prev).add(item.id)); }
        else fail++;
      } catch { fail++; }
      setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
    }
    setEmitiendoTodas(false);
    if (ok > 0) toast(`${ok} boleta${ok > 1 ? "s" : ""} emitida${ok > 1 ? "s" : ""}`);
    if (fail > 0) toast(`${fail} fallaron`, "error");
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <span style={{ width: 20, height: 20, border: "2px solid rgba(255,255,255,.1)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "sp .5s linear infinite", display: "inline-block" }} />
      </div>
    );
  }

  const todasEmitidas = items.length > 0 && emitidas.size === items.length;

  if (items.length === 0 || todasEmitidas) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" style={{ display: "block", margin: "0 auto 14px" }}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Todo emitido</div>
        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 20 }}>
          {items.length} boleta{items.length !== 1 ? "s" : ""} emitida{items.length !== 1 ? "s" : ""} correctamente
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <button onClick={goToVisualizar}
            style={{
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            Ver boletas emitidas
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "subir" } }))}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)",
              background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14m-7-7l7-7 7 7"/>
            </svg>
            Nueva carga
          </button>
        </div>
      </div>
    );
  }

  const listos = items.filter(i => i.listo_emitir);
  const bloqueados = items.filter(i => !i.listo_emitir);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Emitir documentos</span>
          <span style={{ color: "var(--text2)", fontSize: 11, marginLeft: 8 }}>
            {items.length} pendiente{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 4px rgba(34,197,94,.4)" }} />
            {listos.length} listo{listos.length !== 1 ? "s" : ""}
          </span>
          {bloqueados.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
              {bloqueados.length} bloqueado{bloqueados.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {byDateDoc.map(({ date, docs }) => (
        <div key={date} style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text2)",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {dayLabel(date)}
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
                    {listos.length > 0 && emitidas.size < items.length && (
                      <button onClick={handleEmitirTodas} disabled={emitiendoTodas}
                        style={{
                          padding: "3px 10px", borderRadius: 5, border: "none", cursor: emitiendoTodas ? "not-allowed" : "pointer",
                          fontSize: 9, fontWeight: 700, background: "#E8553E", color: "#fff",
                          display: "flex", alignItems: "center", gap: 4, opacity: emitiendoTodas ? .6 : 1,
                        }}>
                        {emitiendoTodas ? (
                          <span style={{ width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                        )}
                        {emitiendoTodas ? "..." : `Emitir todas (${listos.length})`}
                      </button>
                    )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 6px 6px" }}>
                  {doc.items.map(item => {
                    const ready = item.listo_emitir;
                    const isProcessing = emitiendo.has(item.id);
                    const badge = item.tipo_sugerido ? TIPO_BADGE[item.tipo_sugerido] : null;
                    return (
                      <div key={item.id} style={{
                        padding: "10px 12px", borderRadius: 8,
                        background: "rgba(255,255,255,.02)", border: "1px solid var(--border)",
                        opacity: ready ? 1 : .6, transition: "all .15s",
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                            background: ready ? "rgba(34,197,94,.08)" : "rgba(245,158,11,.08)",
                            color: ready ? "var(--green)" : "var(--amber)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                          }}>
{ready ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", marginBottom: 2 }}>
                              {item.descripcion}
                            </div>
                            <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {badge && (
                                <span style={{
                                  fontSize: 7, padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                                  background: badge.color + "18", color: badge.color,
                                }}>
                                  {badge.label}
                                </span>
                              )}
                              <span>{item.fecha.slice(5)}</span>
                              {item.receptor_nombre && (
                                <>
                                  <span style={{ color: "var(--text3)" }}>·</span>
                                  <span>{item.receptor_nombre}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                              {fmt(item.monto_total)}
                            </div>
                          </div>
                        </div>

                        {!ready && item.motivo_no_listo && (
                          <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 8, padding: "4px 8px", borderRadius: 4, background: "rgba(245,158,11,.04)", border: "1px solid rgba(245,158,11,.08)" }}>
                            {item.motivo_no_listo}
                          </div>
                        )}

                        {ready && (
                          <button onClick={() => handleEmitir(item)} disabled={isProcessing || emitidas.has(item.id)}
                            style={{
                              width: "100%", padding: "7px 0", borderRadius: 6, border: "none",
                              cursor: isProcessing ? "not-allowed" : "pointer", fontSize: 10, fontWeight: 600,
                              background: emitidas.has(item.id) ? "rgba(34,197,94,.12)" : isProcessing ? "#E8553E" : "#E8553E",
                              color: emitidas.has(item.id) ? "var(--green)" : "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                              opacity: isProcessing ? .6 : 1, transition: "all .3s",
                            }}>
                            {emitidas.has(item.id) ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                              </svg>
                            ) : isProcessing ? (
                              <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 13l4 4L19 7"/>
                              </svg>
                            )}
                            {emitidas.has(item.id) ? "EMITIDA" : isProcessing ? (
                              <span>Emitiendo<span className="dots-anim" /></span>
                            ) : "EMITIR BOLETA"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
