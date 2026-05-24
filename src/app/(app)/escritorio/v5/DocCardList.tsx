"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import FieldMapper from "@/components/upload/FieldMapper";
import VisualizarArchivo from "./VisualizarArchivo";

const st: Record<string, string> = {procesado:"#22c55e",procesando:"#5b9cf6",error:"#ef4444",subido:"#f59e0b"};
const sl: Record<string, string> = {procesado:"Listo",procesando:"Procesando",error:"Error",subido:"Pendiente"};
const lm: Record<string, string> = {procesado:"ls",procesando:"pc",error:"er",subido:"pd"};

function fmtCLP(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

interface DocRaw {
  id: string; nombre_archivo: string; tipo: string; estado: string;
  movimientos_detectados: number | null; created_at: string; progreso_ia: unknown;
}

export default function DocCardList({ docs: initialDocs, empresaId }: { docs: DocRaw[]; empresaId: string }) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [mappingDocId, setMappingDocId] = useState<string | null>(null);
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const { toast } = useToast();

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
        <span style={{fontSize:9,color:"var(--text2)",fontWeight:500}}>Documentos recientes</span>
        {docs.map((doc) => {
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
            <div key={doc.id} className="doc-card">
              <div className="dh">
                <span className={`dt ${lm[doc.estado] ?? "gn"}`} style={{background:st[doc.estado]??"var(--text2)",boxShadow:`0 0 5px ${st[doc.estado]??"var(--text2)"}40`}} />
                <span className="nm">{doc.nombre_archivo}</span>
                <span className={`st ${lm[doc.estado] ?? "ls"}`}>{sl[doc.estado] ?? doc.estado}</span>
                <span className="mt">{doc.movimientos_detectados ? `${doc.movimientos_detectados} mov` : "—"}</span>
              </div>
              <div className="db">
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
                  {(doc.estado === "procesado" || doc.estado === "subido") && (
                    <button className="ht" onClick={() => callApi("/api/procesar-documento", doc.id)}>↻ Reprocesar</button>
                  )}
                  {(doc.estado === "procesado" || doc.estado === "error") && (
                    <button className="ud" onClick={() => callApi("/api/deshacer-documento", doc.id)}>↩ Deshacer</button>
                  )}
                  {doc.estado === "procesando" && (
                    <button className="cl" onClick={() => callApi("/api/cancelar-documento", doc.id)}>✕ Cancelar</button>
                  )}
                  <button className="mp" onClick={() => setMappingDocId(doc.id)}>↔ Mapear</button>
                  <button className="mp" onClick={() => setViewDocId(doc.id)} style={{background:"rgba(59,130,246,.06)",color:"#5b9cf6"}}>Visualizar</button>
                </div>
              </div>
            </div>
          );
        })}
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
