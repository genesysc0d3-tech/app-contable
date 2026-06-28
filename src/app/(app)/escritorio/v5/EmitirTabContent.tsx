"use client";

import { useState, useMemo } from "react";
import { useToast } from "@/components/Toast";
import { useEmissionLockStatus } from "./useEmissionLockStatus";
import { useMesaReload } from "./mesa-reload";
import { formatShortDateEsCl } from "@/lib/display-date";

interface Item {
  id: string;
  descripcion: string;
  fecha: string;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  monto_total: number;
  balde: "listas" | "por_revisar" | "bloqueadas";
  listo_emitir: boolean;
  motivo_no_listo: string | null;
  motivo_code: "no_boletar" | "monto_invalido" | "falta_receptor" | null;
  tipo_sugerido: number | null;
  sugerencia: string | null;
  confianza_clasif: number;
  razones: string[];
  documento_id: string | null;
  documento_created_at: string | null;
}

interface PendientesResponse {
  ok: boolean;
  items: Item[];
  totales: {
    total_pendientes: number;
    listas_emitir: number;
    por_revisar: number;
    bloqueadas: number;
    monto_total: number;
    monto_listo: number;
  };
  aprobadas_otros_tipos?: Record<string, number>;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

interface BatchItem {
  propuesta_id: string;
  ok: boolean;
  folio?: number;
  monto_total?: number;
  error_code?: string;
  error_message?: string;
}
type EmitirResult = { ok: boolean; exitos: number; fallos: number; monto_emitido: number; proveedor: string; sandbox: boolean; resultados: BatchItem[] };

function errorAmable(code?: string, msg?: string): string {
  switch (code) {
    case "YA_EMITIDA": return "Ya tenía una boleta emitida.";
    case "RECEPTOR_RUT_OBLIGATORIO":
    case "RECEPTOR_RAZON_SOCIAL_OBLIGATORIA":
    case "MEDIO_PAGO_OBLIGATORIO": return "Falta identificar al comprador (sobre 135 UF).";
    case "NO_BOLETAR": return "No corresponde boletear (no es una venta).";
    case "SIN_FOLIOS_DISPONIBLES": return "No quedan folios disponibles.";
    case "AFECTA_IVA_CERO": return "Boleta afecta con IVA $0 — revisa el monto.";
    default: return msg || "No se pudo emitir.";
  }
}

// Salta a Check de agregados y abre la tx (navega el mes si es de otro periodo).
// docsAgregados se filtra por el created_at del DOCUMENTO (cuándo se subió), no
// por la fecha del movimiento — por eso el mes a navegar sale de ahí.
function goToCheck(item: { documento_id: string | null; documento_created_at: string | null; fecha: string }) {
  if (!item.documento_id) return;
  const src = item.documento_created_at ?? item.fecha;
  const month = src && src.length >= 7 ? `${src.slice(0, 4)}-${Number(src.slice(5, 7)) - 1}` : undefined; // mes 0-11 (formato calendario)
  window.dispatchEvent(new CustomEvent("massdte:open-doc", { detail: { documentoId: item.documento_id, month } }));
}

function EmitirEmpty({ loading = false, otrosTipos = {} }: { loading?: boolean; otrosTipos?: Record<string, number> }) {
  const otros = Object.values(otrosTipos).reduce((s, n) => s + n, 0);
  return (
    <div className="r-scroll" style={{display:"grid",placeItems:"center",minHeight:320,padding:"42px 18px",textAlign:"center",color:"var(--text2)"}}>
      <style>{`@keyframes emitirSonar{0%{transform:scale(.72);opacity:.46}70%,100%{transform:scale(1.22);opacity:0}}@keyframes emitirTrace{0%{stroke-dashoffset:52;opacity:.12}35%{opacity:1}100%{stroke-dashoffset:0;opacity:.32}}@keyframes emitirSparkle{0%,100%{opacity:.18}35%{opacity:1}}`}</style>
      <div>
        <div style={{position:"relative",width:104,height:104,margin:"0 auto 16px"}}>
          <div style={{position:"absolute",inset:8,borderRadius:"50%",border:"1px solid rgba(180,240,39,.26)",animation:"emitirSonar 2.8s ease-out infinite"}} />
          <svg viewBox="0 0 96 96" fill="none" style={{position:"absolute",inset:0,color:"#b4f027"}}><path d="M56 11 25 53h22l-6 32 31-47H50l6-27Z" fill="rgba(180,240,39,.16)" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round"/><path d="M56 11 25 53h22l-6 32 31-47H50l6-27Z" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="52" style={{animation:"emitirTrace 2.35s ease-in-out infinite"}}/><circle cx="70" cy="27" r="2.4" fill="currentColor" style={{animation:"emitirSparkle 2.4s ease-in-out .2s infinite"}}/><circle cx="27" cy="67" r="1.8" fill="currentColor" style={{animation:"emitirSparkle 2.4s ease-in-out .8s infinite"}}/></svg>
        </div>
        <div style={{fontSize:15,fontWeight:800,color:"var(--text)",letterSpacing:"-.025em"}}>{loading ? "Revisando la mesa" : "Nada listo para emitir"}</div>
        <div style={{marginTop:5,fontSize:11,lineHeight:1.45,maxWidth:280}}>{loading ? "Buscando pendientes de emisión..." : "Cuando una propuesta quede lista, aparecerá aquí."}</div>
        {!loading && otros > 0 && (
          <div style={{margin:"14px auto 0",maxWidth:300,padding:"10px 12px",borderRadius:11,background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",color:"#f59e0b",fontSize:10,lineHeight:1.5,textAlign:"left"}}>
            {otros === 1 ? "1 propuesta aprobada quedó" : `${otros} propuestas aprobadas quedaron`} como gasto u otro tipo, por eso no se {otros === 1 ? "emite" : "emiten"} como boleta. Si corresponde boletear, cambia el tipo a Boleta en Revisar.
          </div>
        )}
      </div>
    </div>
  );
}

function nextActionLabel(code: Item["motivo_code"]): string | null {
  if (code === "falta_receptor") return "Completa receptor en Revisar";
  if (code === "monto_invalido") return "Corrige el monto en Revisar";
  if (code === "no_boletar") return "Revisa la clasificacion antes de emitir";
  return null;
}

export default function EmitirTabContent({ initial = null }: { initial?: PendientesResponse | null }) {
  const { toast } = useToast();
  const reload = useMesaReload() ?? (() => {});
  // La mesa (calendario maestro) es la fuente: `initial` ya viene filtrado por
  // periodo y es reactivo a la navegación del calendario. Refrescar = reloadMesa.
  const data = initial;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"listas" | "por_revisar" | "bloqueadas" | "todas">(
    () => initial && initial.totales.listas_emitir === 0 && (initial.totales.por_revisar ?? 0) > 0 ? "por_revisar" : "listas",
  );
  const [typeFilter, setTypeFilter] = useState<"todos" | "afecta" | "exenta">("todos");
  const [emitiendo, setEmitiendo] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<EmitirResult | null>(null);
  const { lockedByOther, businessMode, lockMessage } = useEmissionLockStatus();

  const itemsList = useMemo(() => {
    if (!data) return [];
    let filtered = data.items;
    if (statusFilter === "listas") filtered = filtered.filter(i => i.balde === "listas");
    else if (statusFilter === "por_revisar") filtered = filtered.filter(i => i.balde === "por_revisar");
    else if (statusFilter === "bloqueadas") filtered = filtered.filter(i => i.balde === "bloqueadas");
    if (typeFilter === "afecta") filtered = filtered.filter(i => i.tipo_sugerido === 39);
    else if (typeFilter === "exenta") filtered = filtered.filter(i => i.tipo_sugerido === 41);
    return filtered;
  }, [data, statusFilter, typeFilter]);

  const listasCount = data?.totales.listas_emitir ?? 0;
  const porRevisarCount = data?.totales.por_revisar ?? 0;
  const bloqueadasCount = data?.totales.bloqueadas ?? 0;
  const totalCount = data?.totales.total_pendientes ?? 0;

  const selectableItems = itemsList.filter(i => i.listo_emitir);
  const allSelected = selectableItems.length > 0 && selectableItems.every(i => selected.has(i.id));

  function toggleItem(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableItems.map(i => i.id)));
  }

  const selectedItems = useMemo(() =>
    data?.items.filter(i => selected.has(i.id)) ?? [],
    [data, selected]
  );
  const selectedTotal = selectedItems.reduce((s, i) => s + i.monto_total, 0);
  const selectedCount = selectedItems.length;
  const selAfecta = selectedItems.filter((i) => (i.tipo_sugerido ?? 39) === 39).length;
  const selExenta = selectedCount - selAfecta;

  if (!data) {
    return <EmitirEmpty loading />;
  }

  if (totalCount === 0) {
    return <EmitirEmpty otrosTipos={data?.aprobadas_otros_tipos ?? {}} />;
  }

  async function handleEmitir() {
    if (selectedItems.length === 0) return;
    if (lockedByOther) {
      toast(lockMessage, "error");
      return;
    }
    setEmitiendo(true);
    try {
      const body = { items: selectedItems.map(i => ({ id: i.id, tipo_dte: i.tipo_sugerido ?? 39 })) };
      const res = await fetch("/api/intermediaria/emitir-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setLastResult(json as EmitirResult); // el recibo se muestra en el modal
        if ((json.exitos ?? 0) > 0) {
          setSelected(new Set());
          reload();
        }
      } else {
        toast(json.error ?? "Error al emitir", "error");
        setConfirmOpen(false);
      }
    } catch { toast("Error al emitir lote", "error"); }
    setEmitiendo(false);
  }

  function activeTipo(item: Item): number {
    return item.tipo_sugerido ?? 39;
  }

  return (
    <div className="r-scroll" style={{display:"flex",flexDirection:"column"}}>
      <div className="sec" style={{flex:1}}>
        {/* Header */}
        <div className="em-header">
          {listasCount === 0 && porRevisarCount > 0 ? (
            <><span className="big" style={{ color: "#f59e0b" }}>{porRevisarCount}</span><span className="lbl">por revisar antes de emitir</span></>
          ) : (
            <><span className="big">{listasCount}</span><span className="lbl">listas para emitir</span></>
          )}
          {bloqueadasCount > 0 && (
            <span className="blk">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {" "}{bloqueadasCount} bloqueadas
            </span>
          )}
          <button className="rf" onClick={reload}>↻</button>
        </div>

        {/* Pills */}
        <div className="em-pills">
          <button className={`pl ${statusFilter === "listas" ? "act" : "ina"}`} onClick={() => setStatusFilter("listas")}>Listas ({listasCount})</button>
          <button className={`pl ${statusFilter === "por_revisar" ? "act" : "ina"}`} onClick={() => setStatusFilter("por_revisar")}>Por revisar ({porRevisarCount})</button>
          <button className={`pl ${statusFilter === "bloqueadas" ? "act" : "ina"}`} onClick={() => setStatusFilter("bloqueadas")}>Bloqueadas ({bloqueadasCount})</button>
          <button className={`pl ${statusFilter === "todas" ? "act" : "ina"}`} onClick={() => setStatusFilter("todas")}>Todas ({totalCount})</button>
          <span style={{fontSize:8,color:"var(--text2)",margin:"0 4px"}}>|</span>
          <button className={`pl ${typeFilter === "todos" ? "act" : "ina"}`} onClick={() => setTypeFilter("todos")}>Todos</button>
          <button className={`pl ${typeFilter === "afecta" ? "act" : "ina"}`} onClick={() => setTypeFilter("afecta")}>Afecta</button>
          <button className={`pl ${typeFilter === "exenta" ? "act" : "ina"}`} onClick={() => setTypeFilter("exenta")}>Exenta</button>
          {selectableItems.length > 0 && (
            <label className="sc">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{accentColor:"#E8553E"}} />
              {" "}Seleccionar todas ({selectableItems.length})
            </label>
          )}
        </div>

        {/* Items */}
        {itemsList.length === 0 ? (
          <EmitirEmpty />
        ) : (
          itemsList.map(item => {
            const isDisabled = !item.listo_emitir;
            const isSelected = selected.has(item.id);
            const tipo = activeTipo(item);
            const isAfecta = tipo === 39;

            return (
              <div key={item.id} className={`em-item ${isDisabled ? "dis" : ""}`}>
                <div className={`cb ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}
                  onClick={() => !isDisabled && toggleItem(item.id)}
                  style={isDisabled ? {} : {cursor:"pointer"}}
                >{isSelected ? "✓" : ""}</div>
                <div className="inf" onClick={() => { if (item.balde !== "listas") goToCheck(item); }}
                  style={item.balde !== "listas" && item.documento_id ? { cursor: "pointer" } : undefined}>
                  <div className="tt">{item.receptor_nombre || item.descripcion || "Sin nombre"}</div>
                  <div className="sub">
                    {item.receptor_rut ?? "Sin RUT"} · {formatShortDateEsCl(item.fecha, true)}
                  </div>
                  {item.motivo_no_listo && (
                    <div className="sub rn">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {" "}{item.motivo_no_listo}
                      {nextActionLabel(item.motivo_code) && <><br />{nextActionLabel(item.motivo_code)}</>}
                    </div>
                  )}
                  {item.balde !== "listas" && item.documento_id && (
                    <div className="sub" style={{ color: "#E8553E", fontWeight: 700, marginTop: 2 }}>Resolver en Check →</div>
                  )}
                </div>
                <div className="tp" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 7, whiteSpace: "nowrap", color: isAfecta ? "#22c55e" : "#5b9cf6", background: isAfecta ? "rgba(34,197,94,.13)" : "rgba(91,156,246,.13)" }}>{isAfecta ? "Afecta · con IVA" : "Exenta · sin IVA"}</span>
                  {item.balde === "listas" && item.documento_id && (
                    <button onClick={() => goToCheck(item)} title="Corregir el tipo en Check"
                      style={{ fontSize: 8, fontWeight: 600, color: "#E8553E", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Corregir en Check →</button>
                  )}
                </div>
                <div className="mo">{fmt(item.monto_total)}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom bar */}
      {data && (
        <div className="em-bar">
          <div className="l">
            <span className="b">{selectedCount}</span> seleccionadas · Total: <span className="b">{fmt(selectedTotal)}</span>
          </div>
          {lockedByOther && (
            <div style={{ minWidth: 0, flex: 1, padding: "6px 9px", borderRadius: 9, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "#f59e0b", fontSize: 9, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>
              <strong style={{ fontSize: 9 }}>{businessMode ? "Equipo" : "Emisión en curso"}:</strong>{" "}{lockMessage}
            </div>
          )}
          <div className="r">
            <button className="emit" onClick={() => setConfirmOpen(true)} disabled={emitiendo || selectedCount === 0 || lockedByOther}>
              {emitiendo ? (
                <span className="sp" style={{display:"inline-block"}} />
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {" "}{lockedByOther ? "Emisión en curso" : emitiendo ? "Emitiendo..." : `Emitir ${selectedCount}`}
            </button>
          </div>
        </div>
      )}

      {/* F1 — confirmar (pre-vuelo) · emitiendo · recibo, en una sola superficie */}
      {confirmOpen && (
        <div onClick={() => { if (!emitiendo) { setConfirmOpen(false); setLastResult(null); } }}
          style={{ position: "fixed", inset: 0, zIndex: 200, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 94vw)", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.5)", padding: "20px 22px" }}>
            {lastResult ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "-.02em" }}>{lastResult.exitos > 0 ? "Emisión lista" : "No se pudo emitir"}</span>
                  {lastResult.sandbox && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#f59e0b", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● PRUEBA</span>}
                </div>
                {lastResult.exitos > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span style={{ fontSize: 30, fontWeight: 800, color: "#22c55e", letterSpacing: "-.03em" }}>{lastResult.exitos}</span>
                      <span style={{ fontSize: 13, color: "var(--text2)" }}>{lastResult.exitos === 1 ? "boleta emitida" : "boletas emitidas"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
                      Folios: {lastResult.resultados.filter((r) => r.ok && r.folio).map((r) => `#${r.folio}`).join(", ") || "—"}
                    </div>
                  </div>
                )}
                {lastResult.fallos > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>No se pudieron ({lastResult.fallos})</div>
                    {lastResult.resultados.filter((r) => !r.ok).map((r) => (
                      <div key={r.propuesta_id} style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>· {errorAmable(r.error_code, r.error_message)}</div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" }))}
                    style={{ flex: 1, border: 0, borderRadius: 10, padding: "10px 14px", background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Ver en Boletas →</button>
                  <button onClick={() => { setConfirmOpen(false); setLastResult(null); }}
                    style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
                </div>
              </>
            ) : emitiendo ? (
              <div style={{ display: "grid", placeItems: "center", padding: "26px 0", gap: 12 }}>
                <span className="sp" style={{ display: "inline-block" }} />
                <span style={{ fontSize: 12, color: "var(--text2)" }}>Emitiendo {selectedCount}…</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text3)" }}>Vas a emitir</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#f59e0b", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● MODO PRUEBA</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, color: "var(--text)", letterSpacing: "-.03em" }}>{selectedCount}</span>
                  <span style={{ fontSize: 14, color: "var(--text2)" }}>{selectedCount === 1 ? "boleta" : "boletas"}</span>
                </div>
                <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
                  {selAfecta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,.13)", padding: "4px 10px", borderRadius: 8 }}>{selAfecta} con IVA</span>}
                  {selExenta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#5b9cf6", background: "rgba(91,156,246,.13)", padding: "4px 10px", borderRadius: 8 }}>{selExenta} sin IVA</span>}
                </div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 12, color: "var(--text2)" }}>
                  Total <b style={{ color: "var(--text)" }}>{fmt(selectedTotal)}</b>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
                  Modo de prueba: se simula, no se informa al SII. Una boleta real solo se corrige con Nota de Crédito.
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button onClick={() => setConfirmOpen(false)}
                    style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                  <button onClick={handleEmitir}
                    style={{ flex: 1, border: 0, borderRadius: 10, padding: "11px 14px", background: "#E8553E", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Emitir {selectedCount} →</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
