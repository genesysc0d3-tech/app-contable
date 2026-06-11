"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import FieldMapper from "@/components/upload/FieldMapper";
import HintSelector from "@/components/upload/HintSelector";
import GlosaComunControl from "./GlosaComunControl";
import TermHint from "@/components/ui/TermHint";
import VisualizarArchivo from "./VisualizarArchivo";

const st: Record<string, string> = {procesado:"#22c55e",procesando:"#5b9cf6",error:"#ef4444",subido:"#f59e0b"};
const sl: Record<string, string> = {procesado:"Listo",procesando:"Procesando",error:"Error",subido:"Pendiente"};
const lm: Record<string, string> = {procesado:"ls",procesando:"pc",error:"er",subido:"pd"};

function fmtCLP(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

interface DocRaw {
  id: string; nombre_archivo: string; tipo: string; estado: string;
  movimientos_detectados: number | null; created_at: string; progreso_ia: unknown;
  tipo_operacion_hint?: string | null;
  glosa_comun?: string | null;
  glosa_activa?: boolean | null;
}

type DocProg = { total: number; emitida: number; lista: number; porRevisar: number; noAplica: number };

// Avance del documento por el pipeline. La barra mide sobre el "boleteable"
// (total − no aplican) para que refleje el avance real de emisión; el desglose
// reconcilia al total (incluye "no aplican": gastos/descartadas).
function DocProgressBar({ p }: { p: DocProg }) {
  const boleteable = p.total - p.noAplica;
  const seg = (n: number) => (boleteable > 0 ? `${(n / boleteable) * 100}%` : "0%");
  const parts = [
    { n: p.emitida, label: "emitidas", color: "#22c55e" },
    { n: p.lista, label: "listas", color: "#5b9cf6" },
    { n: p.porRevisar, label: "por revisar", color: "#f59e0b" },
  ];
  return (
    <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 8.5, color: "var(--text3)" }}>
        <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>Avance de emisión</span>
        <span><b style={{ color: "var(--text)" }}>{p.emitida}</b>/{boleteable} boletas{p.noAplica > 0 ? ` · ${p.total} mov` : ""}</span>
      </div>
      {boleteable > 0 && (
        <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
          {parts.map((s) => (s.n > 0 ? <div key={s.label} style={{ width: seg(s.n), background: s.color }} /> : null))}
        </div>
      )}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", fontSize: 8.5 }}>
        {parts.map((s) => (s.n > 0 ? (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text2)", fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />{s.n} {s.label}
          </span>
        ) : null))}
        {p.noAplica > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text3)" }} />{p.noAplica} no aplican
          </span>
        )}
      </div>
    </div>
  );
}

export default function DocCardList({ docs: initialDocs, empresaId, tipoEmpresa, tipoMix, docProgress }: {
  docs: DocRaw[]; empresaId: string;
  tipoEmpresa?: string | null;
  tipoMix?: Record<string, { afectas: number; exentas: number; gastos: number }>;
  docProgress?: Record<string, DocProg>;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [mappingDocId, setMappingDocId] = useState<string | null>(null);
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const { toast } = useToast();

  // Vista: lista (densa, para actuar) o grilla (cuadrados color=estado +
  // letra=tipo, para escanear estados rápido). Color = estado, letra = tipo:
  // dos canales, dos dimensiones. La info detallada va en el VISOR (arriba),
  // no dentro de cada cuadrado.
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem("agregados-view"); if (v === "grid" || v === "list") setViewMode(v); } catch { /* noop */ }
  }, []);
  const setView = (v: "list" | "grid") => { setViewMode(v); try { localStorage.setItem("agregados-view", v); } catch { /* noop */ } };

  const isBoletaTipo = (t: string) => (t ?? "").startsWith("boleta_");
  const tipoLetra = (doc: DocRaw): string => {
    if (isBoletaTipo(doc.tipo)) return "B";
    const mix = tipoMix?.[doc.id];
    if (mix) { const m = Math.max(mix.afectas, mix.exentas, mix.gastos); if (m > 0) return mix.afectas === m ? "A" : mix.exentas === m ? "E" : "G"; }
    return "C";
  };
  const tipoNombre = (doc: DocRaw): string =>
    isBoletaTipo(doc.tipo) ? "Boleta única" : tipoLetra(doc) === "A" ? "Cartola · afecta" : tipoLetra(doc) === "E" ? "Cartola · exenta" : tipoLetra(doc) === "G" ? "Cartola · gasto" : "Cartola";
  const tileId = (doc: DocRaw): string => {
    const f = doc.nombre_archivo.match(/#\s*(\d+)/);
    if (f) return `#${f[1]}`;
    return doc.movimientos_detectados ? `${doc.movimientos_detectados} mov` : doc.nombre_archivo.slice(0, 7);
  };

  useEffect(() => { setDocs(initialDocs); }, [initialDocs]);

  const fetchDocs = useCallback(async () => {
    router.refresh();
  }, [router]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("v5-docs")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        () => { fetchDocs(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        () => { fetchDocs(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDocs, empresaId]);

  // Polling while processing
  const hasProcessing = docs.some(d => d.estado === "procesando" || d.estado === "subido");
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocs(), 4000);
    return () => clearInterval(interval);
  }, [hasProcessing, fetchDocs]);

  async function callApi(path: string, docId: string) {
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documento_id: docId }) });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast(json.error ?? "Error en la operación", "error");
      } else {
        fetchDocs();
      }
    } catch { toast("Error de red", "error"); }
  }

  return (
    <>
      <div className="sec" style={{display:"flex",flexDirection:"column",gap:6,position:"relative"}}>
        <span style={{fontSize:9,color:"var(--text2)",fontWeight:500}}>Documentos recientes</span>
        <div style={{position:"absolute",top:-4,right:0,zIndex:4,display:"flex",gap:2,padding:2,borderRadius:9,background:"rgba(20,20,24,.7)",border:"1px solid rgba(255,255,255,.08)",backdropFilter:"blur(8px)"}}>
          {(["grid","list"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} title={v === "grid" ? "Vista cuadrícula (escanear rápido)" : "Vista lista (detalle)"}
              style={{display:"grid",placeItems:"center",width:27,height:20,borderRadius:7,border:"none",cursor:"pointer",background: viewMode === v ? "rgba(232,85,62,.16)" : "transparent",color: viewMode === v ? "#E8553E" : "var(--text2)",transition:"all .15s ease"}}>
              {v === "grid"
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="4" rx="1.6"/><rect x="3" y="13" width="18" height="4" rx="1.6"/></svg>}
            </button>
          ))}
        </div>
        {viewMode === "list" && docs.map((doc) => {
          // Registro de una boleta YA emitida (boleta_unica / boleta_sii_local /
          // boleta_baseapi, etc.): es solo el comprobante, no una cartola
          // procesable. Read-only — sin reprocesar/deshacer/mapear (ya está en
          // Boletas; para corregir, Nota de Crédito). Los uploads son tipo
          // "excel"/"pdf", nunca "boleta_*", así que no hay colisión.
          const isBoletaUnica = (doc.tipo ?? "").startsWith("boleta_");
          const prog = docProgress?.[doc.id];
          // Documento congelado: ya tiene ≥1 boleta emitida en el SII. No se
          // puede re-mapear ni deshacer (folio real; se corrige vía Nota de
          // Crédito). Solo aplica a documentos con propuestas (no boleta única).
          const frozen = (prog?.emitida ?? 0) > 0;
          const progreso = doc.progreso_ia as {
            estado?:string; lote_actual?:number; total_lotes?:number;
            movimientos_encontrados?:number; error?:string;
            duplicados_detalle?:{descripcion:string;monto:number;fecha:string;tipo_flujo:string;motivo:string;n_documento:string|null}[];
            falsos_duplicados_warning?:boolean; duplicados_saltados?:number;
          } | null;
          const dupDetalle = progreso?.duplicados_detalle ?? [];
          const dupCount = progreso?.duplicados_saltados ?? 0;
          const hasWarning = progreso?.falsos_duplicados_warning ?? false;
          const loteActual = progreso?.lote_actual ?? 0;
          const totalLotes = progreso?.total_lotes ?? 0;
          const movEncontrados = progreso?.movimientos_encontrados;
          const hasProgress = doc.estado === "procesando" && totalLotes > 0;
          const pct = hasProgress ? Math.round((loteActual / totalLotes) * 100) : 0;

          return (
            <div key={doc.id} className="doc-card" style={isBoletaUnica ? { border: "1px dashed rgba(232,85,62,.58)", background: "rgba(232,85,62,.045)" } : undefined}>
              <div className="dh" style={isBoletaUnica ? { padding: "6px 8px", gap: 5 } : undefined}>
                {isBoletaUnica && <span style={{width:18,height:18,borderRadius:5,border:"1px dashed rgba(232,85,62,.72)",display:"grid",placeItems:"center",color:"#E8553E",fontSize:7,fontWeight:900,flexShrink:0}}>B1</span>}
                <span className={`dt ${lm[doc.estado] ?? "gn"}`} style={{background:st[doc.estado]??"var(--text2)",boxShadow:`0 0 5px ${st[doc.estado]??"var(--text2)"}40`}} />
                <span className="nm">{doc.nombre_archivo}</span>
                {isBoletaUnica && <span style={{fontSize:6,padding:"1px 4px",borderRadius:999,background:"rgba(232,85,62,.12)",color:"#E8553E",fontWeight:900,whiteSpace:"nowrap"}}>BOLETA UNICA</span>}
                <span className={`st ${lm[doc.estado] ?? "ls"}`}>{sl[doc.estado] ?? doc.estado}</span>
                <span className="mt">{doc.movimientos_detectados ? `${doc.movimientos_detectados} mov` : "—"}</span>
                {(() => {
                  // Composición a primera vista: qué saldrá de esta cartola.
                  const mix = tipoMix?.[doc.id];
                  if (isBoletaUnica || doc.estado !== "procesado" || !mix) return null;
                  const chips: { n: number; sigla: string; color: string }[] = [
                    { n: mix.afectas, sigla: "AFE", color: "#b4f027" },
                    { n: mix.exentas, sigla: "EXE", color: "#5b9cf6" },
                    { n: mix.gastos, sigla: "GASTO", color: "#f59e0b" },
                  ].filter(c => c.n > 0);
                  if (chips.length === 0) return null;
                  return (
                    <span style={{display:"inline-flex",gap:4,flexShrink:0}}>
                      {chips.map(c => (
                        <span key={c.sigla} style={{fontSize:7,fontWeight:800,letterSpacing:".04em",padding:"2px 5px",borderRadius:8,background:`${c.color}1a`,color:c.color,whiteSpace:"nowrap"}}>
                          {c.n} {c.sigla}
                        </span>
                      ))}
                    </span>
                  );
                })()}
              </div>
              <div className="db" style={isBoletaUnica ? { padding: "0 8px 6px", gap: 2 } : undefined}>
                {doc.estado === "procesado" && hasWarning && (
                  <div className="warn">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Esta cartola tiene transferencias del mismo monto. Verifica.
                  </div>
                )}
                {doc.estado === "procesado" && (dupDetalle.length > 0 || dupCount > 0) && (
                  <details className="om-list" style={{marginTop:0}}>
                    <summary className="om-btn" style={{cursor:"pointer",listStyle:"none",display:"flex",alignItems:"center",gap:4,fontSize:9,color:"var(--amber)"}}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      Ver {dupDetalle.length > 0 ? dupDetalle.length : dupCount} omitido{(dupDetalle.length > 0 ? dupDetalle.length : dupCount) !== 1 ? "s" : ""} <span style={{fontSize:7}}>▼</span>
                    </summary>
                    {dupDetalle.map((dup, i) => (
                      <div key={i} className="om-it">
                        <span className="dt"></span>
                        <span className="nm">{dup.descripcion} · {fmtCLP(dup.monto)}</span>
                        <span className="ifo" style={{fontSize:8,color:"var(--text3)"}}>Ya registrado</span>
                      </div>
                    ))}
                    {dupDetalle.length === 0 && dupCount > 0 && (
                      <div className="om-it"><span className="dt"></span><span className="nm">{dupCount} movimiento{dupCount !== 1 ? "s" : ""} ya existía{dupCount !== 1 ? "n" : ""} en otras cartolas</span></div>
                    )}
                  </details>
                )}
                {doc.estado === "procesando" && (
                  <div className="pr">
                    <div className="prh"><span>Procesando {doc.nombre_archivo}</span><span>{pct > 0 ? `${pct}%` : "..."}</span></div>
                    <div className="prb"><div className="prf" style={{width:pct > 0 ? `${Math.max(pct,5)}%` : "5%"}}><div className="prs"></div></div></div>
                    <div className="prl">
                      <span className="pd"></span>
                      {loteActual > 0 && totalLotes > 0
                        ? `Analizando lote ${loteActual} de ${totalLotes}`
                        : movEncontrados ? `Guardando ${movEncontrados} movimientos...`
                        : "Preparando documento..."}
                      {movEncontrados !== undefined && movEncontrados > 0 && (
                        <span style={{color:"var(--text)",fontWeight:500}}> · {movEncontrados} encontrados</span>
                      )}
                    </div>
                  </div>
                )}
                {doc.estado === "error" && progreso?.error && (
                  <div className="warn">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Error: {progreso.error}
                  </div>
                )}
                <div className="da">
                  {/* Documento congelado: tiene boletas emitidas → bloqueado */}
                  {frozen && (
                    <span title="Documento con boletas emitidas en el SII. Para corregir o anular, emite una Nota de Crédito — no se puede re-mapear ni deshacer." style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:8.5,fontWeight:800,padding:"3px 7px",borderRadius:8,background:"rgba(34,197,94,.12)",color:"#22c55e",whiteSpace:"nowrap"}}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                      Listo · {prog!.emitida} emitida{prog!.emitida !== 1 ? "s" : ""}
                    </span>
                  )}
                  {!isBoletaUnica && !frozen && (doc.estado === "procesado" || doc.estado === "subido") && (
                    <button className="ht" onClick={() => callApi("/api/procesar-documento", doc.id)}>↻ Reprocesar</button>
                  )}
                  {!isBoletaUnica && !frozen && (doc.estado === "procesado" || doc.estado === "error") && (
                    <button className="ud" onClick={() => callApi("/api/deshacer-documento", doc.id)}>↩ Deshacer</button>
                  )}
                  {doc.estado === "procesando" && (
                    <button className="cl" onClick={() => callApi("/api/cancelar-documento", doc.id)}>✕ Cancelar</button>
                  )}
                  {!isBoletaUnica && !frozen && <button className="mp" onClick={() => setMappingDocId(doc.id)}>↔ Mapear</button>}
                  {!isBoletaUnica && <button className="mp" onClick={() => setViewDocId(doc.id)} style={{background:"rgba(59,130,246,.06)",color:"#5b9cf6"}}>Visualizar</button>}
                  {!isBoletaUnica && doc.estado === "procesado" && (
                    <span style={{marginLeft:"auto"}}>
                      <HintSelector documentoId={doc.id} current={doc.tipo_operacion_hint ?? null} />
                    </span>
                  )}
                  {isBoletaUnica && (
                    <span title="Esta boleta ya fue emitida en el SII. La ves en la pestaña Boletas." style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:8.5,fontWeight:800,padding:"3px 7px",borderRadius:8,background:"rgba(34,197,94,.12)",color:"#22c55e",whiteSpace:"nowrap"}}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                      Emitida · en Boletas
                    </span>
                  )}
                </div>
                {!isBoletaUnica && doc.estado === "procesado" && prog && prog.total > 0 && (
                  <DocProgressBar p={prog} />
                )}
                {!isBoletaUnica && doc.estado === "procesado" && (
                  <GlosaComunControl
                    documentoId={doc.id}
                    hint={doc.tipo_operacion_hint ?? null}
                    glosaInicial={doc.glosa_comun ?? null}
                    activaInicial={doc.glosa_activa ?? true}
                  />
                )}
                {(() => {
                  // La empresa fijó su tipo, pero esta cartola trae movimientos
                  // del tipo contrario (o mezcla): se recalca sin bloquear nada.
                  if (isBoletaUnica || doc.estado !== "procesado") return null;
                  const mix = tipoMix?.[doc.id];
                  if (!mix) return null;
                  const conflicto = tipoEmpresa === "exento" && mix.afectas > 0
                    ? { n: mix.afectas, clasif: "afectos (con IVA)", cfg: "exenta" }
                    : tipoEmpresa === "afecto" && mix.exentas > 0
                      ? { n: mix.exentas, clasif: "exentos (sin IVA)", cfg: "afecta" }
                      : null;
                  if (!conflicto) return null;
                  const esMixta = mix.afectas > 0 && mix.exentas > 0;
                  return (
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:7,padding:"5px 9px",borderRadius:8,background:"rgba(245,158,11,.07)",border:"1px solid rgba(245,158,11,.18)",color:"#f59e0b",fontSize:9,fontWeight:600,lineHeight:1.4}}>
                      <span style={{flexShrink:0}}>△</span>
                      <span style={{minWidth:0}}>
                        {esMixta
                          ? `Cartola mixta: ${mix.afectas} afecto${mix.afectas !== 1 ? "s" : ""} y ${mix.exentas} exento${mix.exentas !== 1 ? "s" : ""} — tu empresa está configurada ${conflicto.cfg}`
                          : `${conflicto.n} movimiento${conflicto.n !== 1 ? "s" : ""} clasificado${conflicto.n !== 1 ? "s" : ""} como ${conflicto.clasif}, y tu empresa está configurada ${conflicto.cfg}`}
                      </span>
                      <TermHint width={262} align="right">
                        La app los procesa igual y puedes corregir cada uno en Revisar antes de aprobar.
                        Para evitar este aviso, sube cartolas solo con los movimientos que quieres boletear,
                        o ajusta el <strong>Tipo</strong> del documento (el selector de la derecha) para guiar al clasificador.
                      </TermHint>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
        {viewMode === "grid" && (() => {
          const sd = selected ? docs.find(d => d.id === selected) : null;
          const sc = sd ? (st[sd.estado] ?? "#9ca3af") : null;
          // Barra = progreso de emisión (emitida/boleteable). Boleta = 100%.
          const pct = (doc: DocRaw): number => {
            if (isBoletaTipo(doc.tipo)) return 1;
            const p = docProgress?.[doc.id];
            if (p) { const b = p.total - p.noAplica; return b > 0 ? Math.min(1, p.emitida / b) : 0; }
            return 0;
          };
          const estadoIcon = (e: string) =>
            e === "procesado" ? <path d="M5 13l4 4L19 7" />
            : e === "procesando" ? <path d="M21 12a9 9 0 1 1-6.2-8.5" />
            : e === "error" ? <path d="M12 8v5m0 3.5h.01" />
            : <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.5l3 1.8" /></>;
          return (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <style>{`
                .agg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:9px}
                .agg-card{position:relative;aspect-ratio:1;border-radius:14px;cursor:pointer;overflow:hidden;padding:9px;display:flex;flex-direction:column;background:rgba(255,255,255,.04);border:1px solid var(--c-bd);box-shadow:0 3px 10px -5px rgba(0,0,0,.5);transition:transform .24s cubic-bezier(.16,1,.3,1),box-shadow .24s ease,border-color .2s ease}
                .agg-card::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 50% -10%,var(--c) 0%,transparent 60%);opacity:.07;transition:opacity .3s ease;pointer-events:none}
                .agg-card:hover{transform:translateY(-4px);box-shadow:0 16px 26px -12px rgba(0,0,0,.6);border-color:var(--c);z-index:20}
                .agg-card:hover::before{opacity:.15}
                .agg-card.sel{border-color:var(--c);box-shadow:0 0 0 1.5px var(--c)}
                .agg-top{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
                .agg-chip{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:7px;background:var(--c-bg);border:1px solid var(--c-bd);color:var(--c);font-size:10.5px;font-weight:900;letter-spacing:.02em}
                .agg-dot{width:7px;height:7px;border-radius:999px;background:var(--c);box-shadow:0 0 6px var(--c)}
                .agg-body{position:relative;flex:1;margin-top:7px}
                .agg-rest{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;transition:opacity .24s ease,transform .32s cubic-bezier(.16,1,.3,1)}
                .agg-card:hover .agg-rest{opacity:0;transform:translateY(-8px)}
                .agg-num{font-size:19px;font-weight:800;color:var(--text);letter-spacing:-.02em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .agg-bar{width:100%;height:4px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
                .agg-bar i{display:block;height:100%;border-radius:999px;background:var(--c);width:var(--p);transition:width .6s cubic-bezier(.16,1,.3,1)}
                .agg-info{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;opacity:0;transform:translateY(9px);transition:opacity .24s ease .02s,transform .32s cubic-bezier(.16,1,.3,1) .02s;pointer-events:none}
                .agg-card:hover .agg-info{opacity:1;transform:translateY(0)}
                .agg-info .s{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:var(--c);line-height:1.05}
                .agg-info .s svg{width:10px;height:10px;flex-shrink:0}
                .agg-info .d{font-size:8px;color:var(--text2);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .agg-info .e{display:flex;align-items:center;gap:3px;font-size:7.5px;font-weight:700;color:#22c55e}
              `}</style>
              {/* CARD-VISOR de tamaño FIJO — la card que fijaste con click */}
              <div style={{height:74,flexShrink:0,borderRadius:14,border:`1px solid ${sc ? `${sc}55` : "rgba(255,255,255,.08)"}`,background:"rgba(255,255,255,.025)",display:"flex",alignItems:"center",gap:12,padding:"0 14px",overflow:"hidden",transition:"border-color .25s ease"}}>
                {sd && sc ? (
                  <>
                    <div style={{width:42,height:42,borderRadius:999,flexShrink:0,display:"grid",placeItems:"center",background:sc,boxShadow:`0 5px 13px -4px ${sc}99`}}>
                      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{estadoIcon(sd.estado)}</svg>
                    </div>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sd.nombre_archivo}</div>
                      <div style={{fontSize:8,color:"var(--text2)",marginTop:3,letterSpacing:".16em",fontWeight:800}}>VISOR</div>
                    </div>
                    {!isBoletaTipo(sd.tipo) && <button type="button" onClick={() => setViewDocId(sd.id)} style={{flexShrink:0,fontSize:10,fontWeight:700,padding:"6px 12px",borderRadius:9,border:"1px solid rgba(91,156,246,.3)",background:"rgba(91,156,246,.1)",color:"#5b9cf6",cursor:"pointer"}}>Visualizar</button>}
                  </>
                ) : (
                  <div style={{display:"flex",alignItems:"center",gap:11,color:"var(--text2)"}}>
                    <div style={{width:44,height:44,borderRadius:12,display:"grid",placeItems:"center",border:"1.5px dashed rgba(255,255,255,.14)",flexShrink:0}}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l9 6 9-6"/></svg>
                    </div>
                    <span style={{fontSize:11,lineHeight:1.4}}>Haz <b style={{color:"var(--text)"}}>click</b> en un cuadrado para fijarlo aquí. Pasa el cursor para una vista rápida.</span>
                  </div>
                )}
              </div>
              {/* INFO debajo de la card-visor (no dentro) */}
              <div style={{padding:"0 2px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:9,fontSize:9.5,minHeight:16}}>
                {sd && sc ? (
                  <>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",borderRadius:7,background:`${sc}18`,color:sc,fontWeight:800}}><span style={{width:6,height:6,borderRadius:999,background:sc}} />{sl[sd.estado] ?? sd.estado}</span>
                    <span style={{color:"var(--text2)",fontWeight:600}}>{tipoNombre(sd)}</span>
                    {sd.movimientos_detectados ? <span style={{color:"var(--text2)"}}>· {sd.movimientos_detectados} mov</span> : null}
                    {isBoletaTipo(sd.tipo) && <span style={{display:"inline-flex",alignItems:"center",gap:4,color:"#22c55e",fontWeight:800}}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>Emitida · en Boletas</span>}
                  </>
                ) : (
                  <>
                    <span style={{color:"var(--text2)",fontWeight:800}}>Estado:</span>
                    {([["procesado","Listo"],["procesando","Procesando"],["error","Error"],["subido","Pendiente"]] as const).map(([k,l]) => (
                      <span key={k} style={{display:"inline-flex",alignItems:"center",gap:4,color:"var(--text2)"}}><span style={{width:8,height:8,borderRadius:3,background:st[k]}} />{l}</span>
                    ))}
                    <span style={{width:1,height:12,background:"rgba(255,255,255,.1)",margin:"0 3px"}} />
                    <span style={{color:"var(--text2)",fontWeight:800}}>Tipo:</span>
                    {([["A","Afecta"],["E","Exenta"],["G","Gasto"],["B","Boleta"]] as const).map(([k,l]) => (
                      <span key={k} style={{display:"inline-flex",alignItems:"center",gap:4,color:"var(--text2)"}}><b style={{color:"var(--text)",fontWeight:900}}>{k}</b>{l}</span>
                    ))}
                  </>
                )}
              </div>
              {/* GRILLA de cuadrados: color=estado, letra=tipo. Hover revela info; click lo fija en el visor */}
              <div className="agg-grid">
                {docs.map((doc) => {
                  const c = st[doc.estado] ?? "#9ca3af";
                  return (
                    <button key={doc.id} type="button" className={`agg-card${selected === doc.id ? " sel" : ""}`}
                      style={{ "--c": c, "--c-bd": `${c}66` } as CSSProperties}
                      onClick={() => setSelected(s => s === doc.id ? null : doc.id)} title={doc.nombre_archivo}>
                      <div className="agg-top">
                        <span className="agg-chip">{tipoLetra(doc)}</span>
                        <span className="agg-dot" />
                      </div>
                      <div className="agg-body">
                        <div className="agg-rest">
                          <div className="agg-num">{isBoletaTipo(doc.tipo) ? tileId(doc) : (doc.movimientos_detectados ? `${doc.movimientos_detectados}` : "—")}</div>
                          <div className="agg-bar"><i style={{ "--p": `${Math.round(pct(doc) * 100)}%` } as CSSProperties} /></div>
                        </div>
                        <div className="agg-info">
                          <span className="s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{estadoIcon(doc.estado)}</svg>{isBoletaTipo(doc.tipo) ? "Emitida" : (sl[doc.estado] ?? doc.estado)}</span>
                          <span className="d">{tipoNombre(doc)}{doc.movimientos_detectados ? ` · ${doc.movimientos_detectados} mov` : ""}</span>
                          {isBoletaTipo(doc.tipo) && <span className="e"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7"/></svg>en Boletas</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
      {mappingDocId && typeof document !== "undefined" && createPortal(
        <FieldMapper
          documentoId={mappingDocId}
          onClose={() => setMappingDocId(null)}
          onSaved={() => { setMappingDocId(null); fetchDocs(); }}
        />,
        document.body
      )}
      {viewDocId && typeof document !== "undefined" && createPortal(
        <VisualizarArchivo
          documentoId={viewDocId}
          onClose={() => setViewDocId(null)}
        />,
        document.body
      )}
    </>
  );
}
