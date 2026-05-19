"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

interface Item {
  id: string;
  descripcion: string;
  fecha: string;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  monto_total: number;
  listo_emitir: boolean;
  motivo_no_listo: string | null;
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
    bloqueadas: number;
    monto_total: number;
    monto_listo: number;
  };
  aprobadas_otros_tipos?: Record<string, number>;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

export default function EmitirTabContent() {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<PendientesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dteOverrides, setDteOverrides] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<"listas" | "bloqueadas" | "todas">("listas");
  const [typeFilter, setTypeFilter] = useState<"todos" | "afecta" | "exenta">("todos");
  const [emitiendo, setEmitiendo] = useState(false);

  async function fetchData() {
    try {
      const res = await fetch("/api/intermediaria/pendientes-emision");
      const json = await res.json();
      if (json.ok) setData(json);
    } catch { toast("Error al cargar pendientes", "error"); }
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  const itemsList = useMemo(() => {
    if (!data) return [];
    let filtered = data.items;
    if (statusFilter === "listas") filtered = filtered.filter(i => i.listo_emitir);
    else if (statusFilter === "bloqueadas") filtered = filtered.filter(i => !i.listo_emitir);
    if (typeFilter === "afecta") filtered = filtered.filter(i => (dteOverrides[i.id] ?? i.tipo_sugerido) === 39);
    else if (typeFilter === "exenta") filtered = filtered.filter(i => (dteOverrides[i.id] ?? i.tipo_sugerido) === 41);
    return filtered;
  }, [data, statusFilter, typeFilter, dteOverrides]);

  const listasCount = data?.totales.listas_emitir ?? 0;
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

  async function handleEmitir() {
    if (selectedItems.length === 0) return;
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
        toast(`${json.exitos ?? 0} boletas emitidas por $${Math.round(json.monto_emitido ?? 0).toLocaleString("es-CL")}`);
        setSelected(new Set());
        setDteOverrides({});
        fetchData();
        router.refresh();
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
        {loading ? (
          <div className="em-empty"><p>Cargando...</p></div>
        ) : itemsList.length === 0 ? (
          <div className="em-empty">
            <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg></div>
            <h4>Nada pendiente</h4>
            <p>No hay propuestas listas para emitir en esta vista</p>
          </div>
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
                    {item.receptor_rut ?? "Sin RUT"} · {(function(){const d=new Date(item.fecha);const ms=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];return d.getDate()+" "+ms[d.getMonth()]+" "+d.getFullYear()})()}
                  </div>
                  {item.motivo_no_listo && (
                    <div className="sub rn">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {" "}{item.motivo_no_listo}
                    </div>
                  )}
                  {!isDisabled && item.confianza_clasif < 0.7 && (
                    <div className="sub rn">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {" "}Clasificado como {isAfecta ? "AFE" : "EXE"} automáticamente · Revisá antes de emitir
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
          <div className="r">
            <button className="emit" onClick={handleEmitir} disabled={emitiendo || selectedCount === 0}>
              {emitiendo ? (
                <span className="sp" style={{display:"inline-block"}} />
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {" "}{emitiendo ? "Emitiendo..." : `Emitir ${selectedCount}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
