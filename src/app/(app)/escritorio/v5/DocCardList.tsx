"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [hovered, setHovered] = useState<string | null>(null);
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
      <div className="sec" style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:9,color:"var(--text2)",fontWeight:500}}>Documentos recientes</span>
          <div style={{display:"flex",gap:2,padding:2,borderRadius:9,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)"}}>
            {(["grid","list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} title={v === "grid" ? "Vista cuadrícula (escanear rápido)" : "Vista lista (detalle)"}
                style={{display:"grid",placeItems:"center",width:27,height:22,borderRadius:7,border:"none",cursor:"pointer",background: viewMode === v ? "rgba(232,85,62,.16)" : "transparent",color: viewMode === v ? "#E8553E" : "var(--text2)",transition:"all .15s ease"}}>
                {v === "grid"
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="4" rx="1.6"/><rect x="3" y="13" width="18" height="4" rx="1.6"/></svg>}
              </button>
            ))}
          </div>
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
          const hd = hovered ? docs.find(d => d.id === hovered) : null;
          return (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {/* VISOR: preview arriba, info (detalle o leyenda) DEBAJO — no dentro de cada cuadrado */}
              <div style={{borderRadius:14,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.025)",overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",minHeight:60}}>
                  {hd ? (() => {
                    const c = st[hd.estado] ?? "var(--text2)";
                    return (
                      <>
                        <div style={{width:42,height:42,borderRadius:11,display:"grid",placeItems:"center",fontSize:18,fontWeight:900,flexShrink:0,background:`${c}1f`,border:`1.5px solid ${c}`,color:c,transition:"all .2s ease"}}>{tipoLetra(hd)}</div>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{hd.nombre_archivo}</div>
                          <div style={{fontSize:8.5,color:"var(--text2)",marginTop:3,letterSpacing:".12em",fontWeight:800}}>VISOR</div>
                        </div>
                      </>
                    );
                  })() : (
                    <div style={{display:"flex",alignItems:"center",gap:10,color:"var(--text2)"}}>
                      <div style={{width:42,height:42,borderRadius:11,display:"grid",placeItems:"center",border:"1.5px dashed rgba(255,255,255,.14)",flexShrink:0}}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </div>
                      <span style={{fontSize:11}}>Pasa el cursor por un cuadrado para ver su detalle acá.</span>
                    </div>
                  )}
                </div>
                <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding:"9px 14px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:9,fontSize:9.5}}>
                  {hd ? (() => {
                    const c = st[hd.estado] ?? "var(--text2)";
                    return (
                      <>
                        <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",borderRadius:7,background:`${c}18`,color:c,fontWeight:800}}><span style={{width:6,height:6,borderRadius:999,background:c}} />{sl[hd.estado] ?? hd.estado}</span>
                        <span style={{color:"var(--text2)",fontWeight:600}}>{tipoNombre(hd)}</span>
                        {hd.movimientos_detectados ? <span style={{color:"var(--text2)"}}>· {hd.movimientos_detectados} mov</span> : null}
                        {isBoletaTipo(hd.tipo)
                          ? <span style={{display:"inline-flex",alignItems:"center",gap:4,color:"#22c55e",fontWeight:800}}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>Emitida · en Boletas</span>
                          : <span style={{marginLeft:"auto",color:"#5b9cf6",fontWeight:700}}>Click para visualizar →</span>}
                      </>
                    );
                  })() : (
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
              </div>
              {/* GRILLA: color = estado, letra = tipo */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(66px, 1fr))",gap:9}}>
                {docs.map((doc) => {
                  const c = st[doc.estado] ?? "var(--text2)";
                  const active = hovered === doc.id;
                  return (
                    <button key={doc.id} type="button" onMouseEnter={() => setHovered(doc.id)} onMouseLeave={() => setHovered(h => h === doc.id ? null : h)} onFocus={() => setHovered(doc.id)}
                      onClick={() => { if (!isBoletaTipo(doc.tipo)) setViewDocId(doc.id); }}
                      title={`${doc.nombre_archivo} — ${sl[doc.estado] ?? doc.estado}`}
                      style={{position:"relative",aspectRatio:"1",borderRadius:12,cursor:"pointer",background:`${c}14`,border:`1.5px solid ${active ? c : `${c}55`}`,boxShadow: active ? `0 0 0 3px ${c}22, 0 12px 28px rgba(0,0,0,.32)` : "none",transform: active ? "translateY(-3px) scale(1.04)" : "none",transition:"transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s ease, border-color .15s ease",display:"grid",placeItems:"center",padding:0}}>
                      <span style={{fontSize:23,fontWeight:900,color:c,lineHeight:1,transition:"transform .2s ease",transform:active?"scale(1.08)":"none"}}>{tipoLetra(doc)}</span>
                      <span style={{position:"absolute",bottom:5,left:0,right:0,textAlign:"center",fontSize:7.5,fontWeight:700,color:"var(--text2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",padding:"0 4px"}}>{tileId(doc)}</span>
                      <span style={{position:"absolute",top:6,right:6,width:6,height:6,borderRadius:999,background:c,boxShadow:`0 0 5px ${c}`}} />
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
