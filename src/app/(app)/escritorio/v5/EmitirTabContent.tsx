"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { useEmissionLockStatus } from "./useEmissionLockStatus";
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

function providerLabel(proveedor: string | null | undefined): string {
  if (proveedor === "sii_local") return "SII local";
  if (proveedor === "simpleapi") return "SimpleAPI";
  return "modo de prueba";
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
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<PendientesResponse | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dteOverrides, setDteOverrides] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<"listas" | "por_revisar" | "bloqueadas" | "todas">("listas");
  const [typeFilter, setTypeFilter] = useState<"todos" | "afecta" | "exenta">("todos");
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lockedByOther, businessMode, lockMessage } = useEmissionLockStatus();

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intermediaria/pendientes-emision");
      const json = await res.json();
      if (json.ok) {
        setData(json);
      } else {
        const message = json.error ?? "No se pudieron cargar los pendientes";
        setData(null);
        setError(message);
        toast(message, "error");
      }
    } catch {
      setData(null);
      setError("Error al cargar pendientes");
      toast("Error al cargar pendientes", "error");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    // Con datos del server (initial), no re-fetch al montar: evita el flash de
    // carga al cambiar de pestaña. Solo fetch si no vinieron datos del server.
    if (initial) return;
    const timer = window.setTimeout(() => { void fetchData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData, initial]);

  const itemsList = useMemo(() => {
    if (!data) return [];
    let filtered = data.items;
    if (statusFilter === "listas") filtered = filtered.filter(i => i.balde === "listas");
    else if (statusFilter === "por_revisar") filtered = filtered.filter(i => i.balde === "por_revisar");
    else if (statusFilter === "bloqueadas") filtered = filtered.filter(i => i.balde === "bloqueadas");
    if (typeFilter === "afecta") filtered = filtered.filter(i => (dteOverrides[i.id] ?? i.tipo_sugerido) === 39);
    else if (typeFilter === "exenta") filtered = filtered.filter(i => (dteOverrides[i.id] ?? i.tipo_sugerido) === 41);
    return filtered;
  }, [data, statusFilter, typeFilter, dteOverrides]);

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

  function toggleTipo(id: string, tipo: number) {
    setDteOverrides(prev => ({ ...prev, [id]: tipo }));
    if (!selected.has(id)) setSelected(prev => new Set(prev).add(id));
  }

  function removeOverride(id: string) {
    setDteOverrides(prev => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  const selectedItems = useMemo(() =>
    data?.items.filter(i => selected.has(i.id)) ?? [],
    [data, selected]
  );
  const selectedTotal = selectedItems.reduce((s, i) => s + i.monto_total, 0);
  const selectedCount = selectedItems.length;

  if (loading) {
    return <EmitirEmpty loading />;
  }

  if (error) {
    return (
      <div className="r-scroll" style={{display:"grid",placeItems:"center",minHeight:320,padding:"42px 18px",textAlign:"center",color:"var(--text2)"}}>
        <div style={{maxWidth:300}}>
          <div style={{fontSize:15,fontWeight:800,color:"var(--text)",letterSpacing:"-.025em"}}>No se pudo cargar Emitir</div>
          <div style={{marginTop:6,fontSize:11,lineHeight:1.45}}>{error}</div>
          <button type="button" onClick={fetchData} style={{marginTop:14,border:0,borderRadius:999,padding:"9px 14px",background:"#E8553E",color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer"}}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!loading && totalCount === 0) {
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
      const body = { items: selectedItems.map(i => ({ id: i.id, tipo_dte: dteOverrides[i.id] ?? i.tipo_sugerido ?? 39 })) };
      const res = await fetch("/api/intermediaria/emitir-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        const provider = providerLabel(json.proveedor);
        const exitos = json.exitos ?? 0;
        const suffix = json.proveedor === "mock" ? ". No se informaron al SII." : "";
        toast(`${exitos} boletas ${json.proveedor === "mock" ? "simuladas" : "emitidas"} por $${Math.round(json.monto_emitido ?? 0).toLocaleString("es-CL")} (${provider})${suffix}`, exitos > 0 ? undefined : "error");
        if (exitos > 0) {
          setSelected(new Set());
          setDteOverrides({});
          fetchData();
          router.refresh();
        }
      } else {
        toast(json.error ?? "Error al emitir", "error");
      }
    } catch { toast("Error al emitir lote", "error"); }
    setEmitiendo(false);
  }

  function activeTipo(item: Item): number {
    return dteOverrides[item.id] ?? item.tipo_sugerido ?? 39;
  }

  return (
    <div className="r-scroll" style={{display:"flex",flexDirection:"column"}}>
      <div className="sec" style={{flex:1}}>
        {/* Header */}
        <div className="em-header">
          <span className="big">{listasCount}</span>
          <span className="lbl">listas para emitir</span>
          {bloqueadasCount > 0 && (
            <span className="blk">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {" "}{bloqueadasCount} bloqueadas
            </span>
          )}
          <button className="rf" onClick={fetchData}>↻</button>
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
            const isAuto = dteOverrides[item.id] === undefined;
            const tipo = activeTipo(item);
            const isAfecta = tipo === 39;
            const isExenta = tipo === 41;

            return (
              <div key={item.id} className={`em-item ${isDisabled ? "dis" : ""}`}>
                <div className={`cb ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}
                  onClick={() => !isDisabled && toggleItem(item.id)}
                  style={isDisabled ? {} : {cursor:"pointer"}}
                >{isSelected ? "✓" : ""}</div>
                <div className="inf">
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
                  {!isDisabled && item.confianza_clasif < 0.7 && (
                    <div className="sub rn">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {" "}Clasificado como {isAfecta ? "AFE" : "EXE"} automáticamente · Revisa antes de emitir
                    </div>
                  )}
                </div>
                <div className="tp">
                  <button className={isAuto ? "au" : "ina"} onClick={() => !isDisabled && removeOverride(item.id)} title="Programa decide">AUTO</button>
                  <button className={!isAuto && isAfecta ? "af" : "ina"} onClick={() => !isDisabled && toggleTipo(item.id, 39)}>AFE</button>
                  <button className={!isAuto && isExenta ? "ex" : "ina"} onClick={() => !isDisabled && toggleTipo(item.id, 41)}>EXE</button>
                  {isAuto && (
                    <span style={{fontSize:8,color:"var(--text2)",marginLeft:2}}>
                      {isAfecta ? "→ AFE" : "→ EXE"}
                    </span>
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
            <button className="emit" onClick={handleEmitir} disabled={emitiendo || selectedCount === 0 || lockedByOther}>
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
    </div>
  );
}
