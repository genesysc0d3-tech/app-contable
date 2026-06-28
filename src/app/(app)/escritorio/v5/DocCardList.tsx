"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import FieldMapper from "@/components/upload/FieldMapper";
import HintSelector from "@/components/upload/HintSelector";
import GlosaComunControl from "./GlosaComunControl";
import TermHint from "@/components/ui/TermHint";
import VisualizarArchivo from "./VisualizarArchivo";
import { formatDisplayDateEsCl } from "@/lib/display-date";
import { useMesaReload } from "./mesa-reload";

const st: Record<string, string> = {procesado:"#22c55e",procesando:"#5b9cf6",error:"#ef4444",subido:"#f59e0b"};
const sl: Record<string, string> = {procesado:"Listo",procesando:"Procesando",error:"Error",subido:"Pendiente"};
const lm: Record<string, string> = {procesado:"ls",procesando:"pc",error:"er",subido:"pd"};
// Mes corto fijo: Intl "month:short" difiere server ("jun") vs navegador ("jun.")
// → hydration mismatch. Lo construimos determinístico desde el número de mes.
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Alias de banco para ordenar las cartolas (el nombre real queda en el hover/title).
const BANCOS: [string, string][] = [
  ["santander", "Santander"], ["bci", "BCI"], ["scotiabank", "Scotiabank"], ["itau", "Itaú"],
  ["falabella", "Falabella"], ["bancoestado", "BancoEstado"], ["bancodechile", "Banco de Chile"],
  ["bancochile", "Banco de Chile"], ["security", "Security"], ["bice", "BICE"], ["ripley", "Ripley"],
  ["coopeuch", "Coopeuch"], ["tenpo", "Tenpo"], ["mercadopago", "Mercado Pago"], ["global66", "Global66"],
];
function aliasBanco(nombreArchivo: string): string {
  const norm = (nombreArchivo || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [tok, disp] of BANCOS) if (norm.includes(tok)) return `Cartola ${disp}`;
  return (nombreArchivo || "Cartola").replace(/\.[^.]+$/, "");
}
function fmtMonto(n: number | null | undefined): string {
  return n == null ? "" : `$${Math.round(n).toLocaleString("es-CL")}`;
}

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

export default function DocCardList({ docs: initialDocs, empresaId, tipoEmpresa, tipoMix, docProgress, periodoMode = "day", onSelectDoc, selectedDocId, forceTree, infoByDoc }: {
  docs: DocRaw[]; empresaId: string;
  tipoEmpresa?: string | null;
  tipoMix?: Record<string, { afectas: number; exentas: number; gastos: number }>;
  docProgress?: Record<string, DocProg>;
  periodoMode?: "day" | "week" | "month";
  infoByDoc?: Record<string, { nombre: string; monto: number | null }>;
  // Modo "mesa fusionada": el árbol reporta la selección hacia arriba (visor) en
  // vez de abrir el modal, fuerza vista árbol y resalta la fila activa.
  onSelectDoc?: (doc: DocRaw) => void;
  selectedDocId?: string | null;
  forceTree?: boolean;
}) {
  const router = useRouter();
  const ctxReload = useMesaReload();
  const [docs, setDocs] = useState(initialDocs);
  const [mappingDocId, setMappingDocId] = useState<string | null>(null);
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const { toast } = useToast();

  // Vista: lista (densa, para actuar) o grilla (cuadrados color=estado +
  // letra=tipo, para escanear estados rápido). Color = estado, letra = tipo:
  // dos canales, dos dimensiones. La info detallada va en el VISOR (arriba),
  // no dentro de cada cuadrado.
  const [viewMode, setViewMode] = useState<"list" | "grid">(forceTree ? "grid" : "list");
  useEffect(() => {
    if (forceTree) return;
    try { const v = localStorage.getItem("agregados-view"); if (v === "grid" || v === "list") setViewMode(v); } catch { /* noop */ }
  }, [forceTree]);
  const setView = (v: "list" | "grid") => { setViewMode(v); try { localStorage.setItem("agregados-view", v); } catch { /* noop */ } };
  // En modo mesa fusionada el árbol es la única vista (las configs viven en el visor).
  const mode: "list" | "grid" = forceTree ? "grid" : viewMode;

  const isBoletaTipo = (t: string) => (t ?? "").startsWith("boleta_");

  useEffect(() => { setDocs(initialDocs); }, [initialDocs]);

  const fetchDocs = useCallback(async () => {
    if (ctxReload) ctxReload(); else router.refresh();
  }, [ctxReload, router]);

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
        <span style={{fontSize:9,color:"var(--text2)",fontWeight:500}}>Agregados recientes</span>
        {!forceTree && (
          <div style={{position:"absolute",top:-4,right:0,zIndex:4,display:"flex",gap:2,padding:2,borderRadius:9,background:"rgba(20,20,24,.7)",border:"1px solid rgba(255,255,255,.08)",backdropFilter:"blur(8px)"}}>
            {(["grid","list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} title={v === "grid" ? "Vista por origen (escanear rápido)" : "Vista lista (detalle)"}
                style={{display:"grid",placeItems:"center",width:27,height:20,borderRadius:7,border:"none",cursor:"pointer",background: viewMode === v ? "rgba(232,85,62,.16)" : "transparent",color: viewMode === v ? "#E8553E" : "var(--text2)",transition:"all .15s ease"}}>
                {v === "grid"
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="9" height="3" rx="1.2"/><rect x="6" y="10" width="15" height="2.6" rx="1.2"/><rect x="6" y="15" width="15" height="2.6" rx="1.2"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="4" rx="1.6"/><rect x="3" y="13" width="18" height="4" rx="1.6"/></svg>}
              </button>
            ))}
          </div>
        )}
        {mode === "list" && docs.map((doc) => {
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
        {mode === "grid" && (() => {
          // Vista "por origen" (estilo Finder): agrupa por DE DÓNDE vino el doc
          // —MassDTE (cartolas), Telegram (comprobantes), Boleta única— y la marca
          // de tiempo escala con el calendario maestro: día→hora, semana→día+hora,
          // mes→semana+día+hora. Estado = punto de color a la izquierda. Sin líneas
          // conectoras (jerarquía falsa); encabezado de sección estilo Finder.
          const origenDe = (d: DocRaw): "massdte" | "telegram" | "boleta" =>
            isBoletaTipo(d.tipo) ? "boleta" : (d.nombre_archivo ?? "").startsWith("Telegram ") ? "telegram" : "massdte";
          const grupos: { key: "massdte" | "telegram" | "boleta"; label: string; sub: string; icon: ReactNode }[] = [
            { key: "massdte", label: "MassDTE", sub: "cartolas",
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 4h8a1 1 0 0 1 1 1v10.5" opacity=".5"/><path d="M5 7.5h8.5a1 1 0 0 1 1 1V21l-1.7-1-1.7 1-1.7-1-1.7 1-1.7-1V8.5a1 1 0 0 1 1-1Z"/><path d="M7.5 12h5"/><path d="M7.5 15h3.5"/></svg> },
            { key: "telegram", label: "Telegram", sub: "comprobantes",
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg> },
            { key: "boleta", label: "Boleta única", sub: "emisión directa",
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.2l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M9 8h6"/><path d="M9 11.5h5"/></svg> },
          ];
          const byOrigen: Record<string, DocRaw[]> = { massdte: [], telegram: [], boleta: [] };
          for (const d of docs) byOrigen[origenDe(d)].push(d);
          for (const k of Object.keys(byOrigen)) byOrigen[k].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          // Marca de tiempo escalada al modo del calendario maestro.
          const tsDe = (s: string): string => {
            const hh = formatDisplayDateEsCl(s, { hour: "2-digit", minute: "2-digit", hour12: false }, "");
            if (periodoMode === "day") return hh;
            const dn = Number(formatDisplayDateEsCl(s, { day: "numeric" }, "0")) || 1;
            const mn = Number(formatDisplayDateEsCl(s, { month: "numeric" }, "1")) || 1;
            const yn = Number(formatDisplayDateEsCl(s, { year: "numeric" }, "2026")) || 2026;
            const dow = new Date(Date.UTC(yn, mn - 1, dn)).getUTCDay(); // weekday determinístico (sin Intl → sin hidratación)
            return `${DIAS_CORTOS[dow]} ${dn} ${hh}`; // "sáb 13 22:18" (semana y mes — el día desambigua)
          };
          return (
            <div>
              <style>{`
                .agg-fgrp{margin-bottom:10px}
                .agg-fgrp:last-child{margin-bottom:0}
                .agg-fh{display:flex;align-items:center;gap:7px;padding:5px 2px;border-bottom:1px solid var(--bg-muted);margin-bottom:3px;color:var(--text2)}
                .agg-fh .lbl{font-size:10px;font-weight:800;letter-spacing:.02em;color:var(--text)}
                .agg-fh .sub{font-size:9px;color:var(--text3);font-weight:600}
                .agg-fh .cnt{margin-left:auto;font-size:9px;color:var(--text3);font-weight:700;font-variant-numeric:tabular-nums}
                .agg-fr{display:flex;align-items:center;gap:9px;width:100%;border:none;background:transparent;cursor:pointer;padding:6px 8px;border-radius:8px;text-align:left;color:inherit;transition:background .14s ease}
                .agg-fr:hover{background:rgba(255,255,255,.045)}
                .agg-fr.sel{background:rgba(232,85,62,.1)}
                .agg-fr.sel:hover{background:rgba(232,85,62,.14)}
                .agg-fr .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
                .agg-fr .nm{flex:1;min-width:0;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .agg-fr .meta{font-size:9.5px;flex-shrink:0;font-variant-numeric:tabular-nums}
                .agg-fr .ts{font-size:9px;color:var(--text3);flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums}
                @keyframes aggDotPulse{0%,100%{opacity:1}50%{opacity:.3}}
                .agg-fr .dot.pulse{animation:aggDotPulse 1.4s ease-in-out infinite}
              `}</style>
              {grupos.filter((g) => byOrigen[g.key].length > 0).map((g) => (
                <div key={g.key} className="agg-fgrp">
                  <div className="agg-fh">
                    {g.icon}
                    <span className="lbl">{g.label}</span>
                    <span className="sub">{g.sub}</span>
                    <span className="cnt">{byOrigen[g.key].length}</span>
                  </div>
                  {byOrigen[g.key].map((doc) => {
                    const c = st[doc.estado] ?? "#9ca3af";
                    const hollow = doc.estado === "subido";
                    const pulse = doc.estado === "procesando";
                    const prog = doc.progreso_ia as { folio?: number; receptor?: string; monto_total?: number } | null;
                    const info = infoByDoc?.[doc.id];
                    // Nombre + meta según el origen del documento.
                    let nm = doc.nombre_archivo;
                    let metaNorm = "";
                    if (g.key === "telegram") {
                      nm = info?.nombre || "Comprobante";
                      metaNorm = fmtMonto(info?.monto);
                    } else if (g.key === "boleta") {
                      nm = prog?.folio ? `Boleta #${prog.folio}${prog.receptor ? ` · ${prog.receptor}` : ""}` : doc.nombre_archivo;
                      metaNorm = fmtMonto(prog?.monto_total) || "emitida";
                    } else {
                      nm = aliasBanco(doc.nombre_archivo); // alias de banco; el nombre real queda en el hover (title)
                      metaNorm = doc.movimientos_detectados ? `${doc.movimientos_detectados} mov` : "";
                    }
                    const meta = doc.estado === "error" ? "Error"
                      : doc.estado === "procesando" ? "procesando"
                      : metaNorm;
                    const metaColor = doc.estado === "error" ? "#ef4444"
                      : doc.estado === "procesando" ? "#5b9cf6"
                      : (doc.estado === "procesado" && isBoletaTipo(doc.tipo)) ? "#22c55e"
                      : "var(--text2)";
                    return (
                      <button key={doc.id} type="button" className={`agg-fr${selectedDocId === doc.id ? " sel" : ""}`} title={doc.nombre_archivo}
                        onClick={() => { if (onSelectDoc) { onSelectDoc(doc); return; } if (isBoletaTipo(doc.tipo)) window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" })); else setViewDocId(doc.id); }}>
                        <span className={`dot${pulse ? " pulse" : ""}`} style={hollow ? { border: `1.5px solid ${c}`, background: "transparent" } : { background: c }} />
                        <span className="nm">{nm}</span>
                        {meta && <span className="meta" style={{ color: metaColor }}>{meta}</span>}
                        <span className="ts">{tsDe(doc.created_at)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
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
