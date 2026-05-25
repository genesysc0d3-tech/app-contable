"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { aprobarPropuesta, rechazarPropuesta, aprobarTodas, crearClienteDesdeRevisar } from "../../revisar/actions";
import { useToast } from "@/components/Toast";
import { clasificarBoleta } from "@/lib/sii/clasificador-tipo";
import type { Tables } from "@/lib/database.types";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw"> & {
    documentos_subidos: { id: string; nombre_archivo: string; created_at: string };
  };
};
type ClienteResumen = { id: string; nombre: string; rut: string | null };

const ALTA = 0.85;
const MEDIA = 0.5;

function classifyConfianza(p: Propuesta): "alta" | "media" | "baja" {
  const c = p.confianza ?? 0;
  return c >= ALTA ? "alta" : c >= MEDIA ? "media" : "baja";
}

function fmt(n: number | null | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString("es-CL")}`;
}

function fmtShort(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getDate()} ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][dt.getMonth()]} ${dt.getFullYear()}`;
}

function RevisarEmpty() {
  return (
    <div className="r-scroll" style={{display:"grid",placeItems:"center",minHeight:320,padding:"42px 18px",textAlign:"center",color:"var(--text2)"}}>
      <style>{`@keyframes revisarSonar{0%{transform:scale(.72);opacity:.46}70%,100%{transform:scale(1.22);opacity:0}}@keyframes revisarTrace{0%{stroke-dashoffset:42;opacity:.32}50%{opacity:1}100%{stroke-dashoffset:0;opacity:.5}}`}</style>
      <div style={{transform:"translateY(7px)"}}>
        <div style={{position:"relative",width:104,height:104,margin:"0 auto 16px"}}>
          <div style={{position:"absolute",inset:8,borderRadius:"50%",border:"1px solid rgba(34,197,94,.26)",animation:"revisarSonar 2.8s ease-out infinite"}} />
          <svg viewBox="0 0 96 96" fill="none" style={{position:"absolute",inset:0,color:"#22c55e"}}><path d="M48 78c16.568 0 30-13.432 30-30S64.568 18 48 18 18 31.432 18 48s13.432 30 30 30Z" stroke="currentColor" strokeWidth="4"/><path d="m35 48 9 9 19-21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="42" style={{animation:"revisarTrace 2.8s ease-in-out infinite"}}/></svg>
        </div>
        <div style={{fontSize:15,fontWeight:800,color:"var(--text)",letterSpacing:"-.025em"}}>Todo despejado</div>
        <div style={{marginTop:5,fontSize:11,lineHeight:1.45,maxWidth:270}}>No hay propuestas pendientes para revisar en esta mesa.</div>
      </div>
    </div>
  );
}

interface DocTab { docId: string; nombre: string; total: number; }

export default function RevisarTabContent({
  propuestas, clientes, empresaId, empresaGiro, empresaRazonSocial, empresaTipoContribuyente,
}: {
  propuestas: Propuesta[]; clientes: ClienteResumen[]; empresaId: string;
  empresaGiro?: string | null; empresaRazonSocial?: string; empresaTipoContribuyente?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();

  // Build document tabs from propuestas data
  const docMap = useMemo(() => {
    const m = new Map<string, DocTab & { props: Propuesta[] }>();
    for (const p of propuestas) {
      const doc = p.movimientos_raw?.documentos_subidos;
      if (!doc) continue;
      let ent = m.get(doc.id);
      if (!ent) ent = { docId: doc.id, nombre: doc.nombre_archivo, total: 0, props: [] };
      ent.props.push(p);
      ent.total++;
      m.set(doc.id, ent);
    }
    return Array.from(m.values()).sort((a,b) => b.props.length - a.props.length);
  }, [propuestas]);

  const [selDocId, setSelDocId] = useState<string | null>(null);
  const activeDoc = docMap.find(d => d.docId === (selDocId ?? docMap[0]?.docId));

  // Always call hooks — never after conditional returns
  const emptyProps: Propuesta[] = [];
  const fallbackDoc = { docId: "", nombre: "", total: 0, props: emptyProps } as DocTab & { props: Propuesta[] };
  const doc = activeDoc ?? fallbackDoc;
  const currentProps = useMemo(() => doc.props.filter(p => p.estado === "pendiente" || p.estado === "aprobado" || p.estado === "editado"), [doc]);

  const alta = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "alta"), [currentProps]);
  const media = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "media"), [currentProps]);
  const baja = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "baja"), [currentProps]);

  const totalPendientes = doc.props.filter(p => p.estado === "pendiente").length;

  if (!activeDoc) {
    return <RevisarEmpty />;
  }

  if (totalPendientes === 0) {
    return <RevisarEmpty />;
  }

  return (
    <>
      {/* Document sub-tabs + Aprobar todo */}
      <div className="dtabs">
        {docMap.length > 1 && docMap.map(dt => (
          <div key={dt.docId}
            className={`dtab ${dt.docId === activeDoc.docId ? "act" : ""}`}
            onClick={() => setSelDocId(dt.docId)}
            style={{cursor:"pointer"}}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {dt.nombre}
            <span className="cnt">{dt.total}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          {alta.length > 0 && <AprobarTodoBtn ids={alta.map(p => p.id)} />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="r-scroll" style={{padding:"0"}}>
        <ConfianzaGroupSection tipo="alta" label="Alta confianza" propuestas={alta} color="#22c55e" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
        <ConfianzaGroupSection tipo="media" label="Requiere revisión" propuestas={media} color="#f59e0b" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
        <ConfianzaGroupSection tipo="baja" label="Falta información" propuestas={baja} color="#E8553E" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
      </div>
    </>
  );
}

/* ─── Aprobar Todo Button ─── */
function AprobarTodoBtn({ ids }: { ids: string[] }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function handle() {
    if (ids.length === 0) return;
    setLoading(true);
    const r = await aprobarTodas(ids);
    if (r.error) toast(r.error, "error"); else toast(`${r.count} aprobadas`);
    router.refresh();
    setLoading(false);
  }
  return (
    <button className="btn-at" onClick={handle} disabled={loading} style={{
      border:"none",borderRadius:6,background:"#E8553E",color:"#fff",padding:"6px 10px",fontSize:10,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4,opacity:loading?0.5:1,
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      {loading ? "..." : `Aprobar todo (${ids.length})`}
      <span style={{width:14,height:14,borderRadius:"50%",background:"rgba(255,255,255,.2)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,lineHeight:1,flexShrink:0,color:"#fff",cursor:"help"}} title="Solo aprueba props con confianza ≥ 85%">?</span>
    </button>
  );
}

/* ─── Confianza Group Section ─── */
function ConfianzaGroupSection({ tipo, label, propuestas, color, clientes, empresaId, onAction, empresaTipoContribuyente, empresaGiro }: {
  tipo: string; label: string; propuestas: Propuesta[]; color: string; clientes: ClienteResumen[]; empresaId: string; onAction: () => void;
  empresaTipoContribuyente?: string | null; empresaGiro?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [activeBlock, setActiveBlock] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  if (propuestas.length === 0) return null;

  const useBlocks = propuestas.length > 10;
  const blockSize = 10;
  const totalBlocks = useBlocks ? Math.ceil(propuestas.length / blockSize) : 1;
  const curBlock = useBlocks ? activeBlock : 0;
  const visible = useBlocks ? propuestas.slice(curBlock * blockSize, (curBlock + 1) * blockSize) : propuestas;

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Padding */}
      <div style={{padding:"10px 16px 0"}}>
        <div className={`cg ${tipo}`} style={{borderBottom:"1px solid rgba(255,255,255,.03)"}}>
          {/* Accordion header */}
          <div className="cg-h" onClick={() => setExpanded(!expanded)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 0",cursor:"pointer"}}>
            <span className="arr" style={{fontSize:8,color:"var(--text2)",transform:expanded?"rotate(90deg)":"none",transition:"transform .2s",flexShrink:0}}>▶</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={color}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span className="lbl" style={{fontSize:10,fontWeight:600,flex:1,color}}>{label}</span>
            <span className="cnt" style={{fontSize:9,color:"var(--text2)"}}>{propuestas.length}</span>
            {tipo === "alta" && (
              <div className="act" style={{display:"flex",gap:4}} onClick={e => e.stopPropagation()}>
                <BlockApproveBtn ids={visible.map(p => p.id)} label={`Aprobar bloque ${curBlock + 1}`} />
                <ApproveAllBtn ids={propuestas.map(p => p.id)} />
              </div>
            )}
          </div>

          {/* Body */}
          {expanded && (
            <div className="cg-body op">
              {/* Block nav */}
              {useBlocks && (
                <div className="blocks" style={{display:"flex",gap:4,padding:"4px 0",overflowX:"auto",scrollbarWidth:"none"}}>
                  {Array.from({length:totalBlocks},(_,i) => (
                    <button key={i} className={`block-p ${i === curBlock ? "act" : "ina"}`}
                      onClick={() => setActiveBlock(i)}
                      style={{
                        width:28,height:20,borderRadius:4,border:"none",cursor:"pointer",fontSize:8,fontWeight:600,
                        background: i === curBlock ? "#E8553E" : "var(--bg-muted)",
                        color: i === curBlock ? "#fff" : "var(--text2)",
                        boxShadow: i === curBlock ? "0 0 8px rgba(232,85,62,.3)" : "none",
                      }}
                    >{i + 1}</button>
                  ))}
                </div>
              )}

              {/* Transaction rows */}
              {visible.map((p) => {
                const isExpanded = expandedRows.has(p.id);
                return (
                  <div key={p.id}>
                    {/* Thin row */}
                    <div className="tr" onClick={() => toggleRow(p.id)}
                      style={{display:"flex",alignItems:"center",gap:6,padding:"5px 16px",borderBottom:"1px solid rgba(255,255,255,.02)",cursor:"pointer"}}
                    >
                      <span className="exp" style={{transform:isExpanded?"rotate(90deg)":"none",color:isExpanded?"#E8553E":"var(--text2)",fontSize:10,transition:"transform .2s",flexShrink:0}}>▶</span>
                      <div className="info" style={{flex:1,minWidth:0}}>
                        <div className="tt" style={{fontSize:10,fontWeight:500,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.movimientos_raw.descripcion}</div>
                        <div className="mt" style={{fontSize:8,color:"var(--text2)",marginTop:1,display:"flex",alignItems:"center",gap:4}}>
                          {fmt(p.movimientos_raw.monto)} <span style={{color:"#2a2d36"}}>·</span> {fmtShort(p.movimientos_raw.fecha)}
                          {p.receptor_nombre && <><span style={{color:"#2a2d36"}}>·</span> {p.receptor_nombre}</>}
                        </div>
                      </div>
                      <span className={`cf ${(p.confianza ?? 0) >= ALTA ? "hi" : (p.confianza ?? 0) >= MEDIA ? "me" : "ba"}`}
                        style={{fontSize:9,fontWeight:600,textAlign:"right",minWidth:30,color:(p.confianza??0)>=ALTA?"#22c55e":(p.confianza??0)>=MEDIA?"#f59e0b":"var(--text2)"}}
                      >{Math.round((p.confianza??0)*100)}%</span>
                      <div className="ac" style={{display:"flex",gap:2,flexShrink:0}} onClick={e => e.stopPropagation()}>
                        <RowActionBtn type="aprove" onClick={async () => {const r=await aprobarPropuesta(p.id);if(r.error) toast(r.error,"error");else toast("Aprobada");onAction();}} icon="✓" />
                        <RowActionBtn type="edit" onClick={() => toggleRow(p.id)} icon="✎" />
                        <RowActionBtn type="reject" onClick={async () => {const r=await rechazarPropuesta(p.id);if(r.error) toast(r.error,"error");else toast("Rechazada");onAction();}} icon="✕" />
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <ExpandedDetail propuesta={p} clientes={clientes} empresaId={empresaId} onAction={onAction} onClose={() => toggleRow(p.id)} empresaTipoContribuyente={empresaTipoContribuyente} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Bottom separator */}
      <div style={{padding:"0 16px"}}><div style={{borderBottom:"1px solid rgba(255,255,255,.03)"}} /></div>
    </>
  );
}

/* ─── Row Action Button ─── */
function RowActionBtn({ onClick, icon, type }: { onClick: () => void; icon: string; type: "aprove"|"edit"|"reject" }) {
  const bg = type === "aprove" ? "rgba(34,197,94,.1)" : type === "edit" ? "rgba(245,158,11,.1)" : "rgba(239,68,68,.1)";
  const cl = type === "aprove" ? "#22c55e" : type === "edit" ? "#f59e0b" : "#ef4444";
  return (
    <button onClick={onClick}
      style={{width:22,height:22,borderRadius:4,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,background:bg,color:cl}}
    >{icon}</button>
  );
}

/* ─── Block Approve Button ─── */
function BlockApproveBtn({ ids, label }: { ids: string[]; label: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    if (ids.length === 0) return;
    setLoading(true);
    const r = await aprobarTodas(ids);
    if (r.error) toast(r.error, "error"); else toast(`${r.count} aprobadas en bloque`);
    router.refresh();
    setLoading(false);
  }
  return (
    <button onClick={handle} disabled={loading}
      style={{fontSize:8,padding:"3px 8px",borderRadius:4,border:"1px solid rgba(232,85,62,.3)",cursor:"pointer",fontWeight:600,background:"transparent",color:"#E8553E",opacity:loading?0.5:1}}
    >{loading ? "..." : label}</button>
  );
}

/* ─── Approve All Button ─── */
function ApproveAllBtn({ ids }: { ids: string[] }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    if (ids.length === 0) return;
    setLoading(true);
    const r = await aprobarTodas(ids);
    if (r.error) toast(r.error, "error"); else toast(`${r.count} aprobadas`);
    router.refresh();
    setLoading(false);
  }
  return (
    <button onClick={handle} disabled={loading}
      style={{fontSize:8,padding:"3px 8px",borderRadius:4,border:"none",cursor:"pointer",fontWeight:600,background:"#E8553E",color:"#fff",opacity:loading?0.5:1}}
    >{loading ? "..." : `Aprobar todas`}</button>
  );
}

/* ─── Expanded Detail ─── */
function ExpandedDetail({ propuesta, clientes, empresaId, onAction, onClose, empresaTipoContribuyente }: {
  propuesta: Propuesta; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; onClose: () => void;
  empresaTipoContribuyente?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selClienteId, setSelClienteId] = useState(propuesta.cliente_id ?? "");
  const [newClienteNombre, setNewClienteNombre] = useState("");
  const [newClienteRut, setNewClienteRut] = useState("");
  const [showNewCliente, setShowNewCliente] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAfecta = propuesta.tipo_propuesto === "boleta" || propuesta.tipo_propuesto === "factura";
  const empresaSugiereExenta = empresaTipoContribuyente === "exento";
  const empresaSugiereAfecta = empresaTipoContribuyente === "afecto";
  const desacuerdo = (isAfecta && empresaSugiereExenta) || (!isAfecta && empresaSugiereAfecta);

  const neto = propuesta.monto_neto ?? Math.round((propuesta.total ?? 0) / 1.19);
  const iva = propuesta.iva ?? Math.round(neto * 0.19);
  const total = propuesta.total ?? neto + iva;

  async function handleAprobar() {
    setBusy(true);
    let cid = selClienteId;
    if (showNewCliente && newClienteNombre.trim()) {
      const res = await crearClienteDesdeRevisar({empresa_id: empresaId, nombre: newClienteNombre.trim(), rut: newClienteRut.trim() || undefined});
      if ("cliente" in res && res.cliente) cid = res.cliente.id;
    }
    const r = await aprobarPropuesta(propuesta.id, cid || null);
    if (r.error) toast(r.error, "error"); else toast("Aprobada");
    router.refresh();
    onAction();
    setBusy(false);
    onClose();
  }

  async function handleRechazar() {
    setBusy(true);
    const r = await rechazarPropuesta(propuesta.id);
    if (r.error) toast(r.error, "error"); else toast("Rechazada");
    router.refresh();
    onAction();
    setBusy(false);
    onClose();
  }

  return (
    <div className="pc op" style={{padding:"0 16px 8px"}}>
      <div className="col" style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        <span className={`tag ${isAfecta ? "af" : "ex"}`}
          style={{fontSize:8,padding:"2px 7px",borderRadius:10,fontWeight:600,
            background: isAfecta ? "rgba(180,240,39,.1)" : "rgba(91,156,246,.1)",
            color: isAfecta ? "#b4f027" : "#5b9cf6",
          }}
        >{isAfecta ? "Boleta · afecta" : "Boleta · exenta"}</span>
        <span className="cf" style={{color: (propuesta.confianza??0) >= ALTA ? "#22c55e" : (propuesta.confianza??0) >= MEDIA ? "#f59e0b" : "var(--text2)", fontSize:12,fontWeight:700}}>
          {Math.round((propuesta.confianza ?? 0) * 100)}%
        </span>
        {empresaSugiereAfecta && !isAfecta && (
          <span style={{fontSize:7,padding:"1px 5px",borderRadius:8,fontWeight:600,background:"rgba(232,85,62,.1)",color:"#E8553E",marginLeft:4}}>Default empresa: AFE</span>
        )}
        {empresaSugiereExenta && isAfecta && (
          <span style={{fontSize:7,padding:"1px 5px",borderRadius:8,fontWeight:600,background:"rgba(91,156,246,.1)",color:"#5b9cf6",marginLeft:4}}>Default empresa: EXE</span>
        )}
      </div>
      <div className="desc" style={{fontSize:11,fontWeight:500,color:"var(--text)",marginBottom:4}}>{propuesta.movimientos_raw.descripcion}</div>
      <div className="sub" style={{fontSize:9,color:"var(--text2)",marginBottom:6}}>
        {fmt(total)} · {fmtShort(propuesta.movimientos_raw.fecha)} · {propuesta.receptor_nombre ?? "Sin receptor"}
      </div>
      <div className="fin" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:6}}>
        <div className="it" style={{padding:6,borderRadius:6,background:"rgba(255,255,255,.03)",textAlign:"center"}}>
          <div className="lb" style={{fontSize:7,color:"var(--text2)"}}>Neto</div>
          <div className="vl" style={{fontSize:11,fontWeight:600,color:"var(--text)"}}>{fmt(neto)}</div>
        </div>
        <div className="it" style={{padding:6,borderRadius:6,background:"rgba(255,255,255,.03)",textAlign:"center"}}>
          <div className="lb" style={{fontSize:7,color:"var(--text2)"}}>IVA</div>
          <div className="vl" style={{fontSize:11,fontWeight:600,color:"var(--text)"}}>{fmt(iva)}</div>
        </div>
        <div className="it" style={{padding:6,borderRadius:6,background:"rgba(255,255,255,.03)",textAlign:"center"}}>
          <div className="lb" style={{fontSize:7,color:"var(--text2)"}}>Total</div>
          <div className="vl ht" style={{fontSize:11,fontWeight:700,color:"#b4f027"}}>{fmt(total)}</div>
        </div>
      </div>
      <div className="cliente" style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,fontSize:9,color:"var(--text2)"}}>
        <span>Cliente:</span>
        <select value={selClienteId} onChange={e => {const v=e.target.value;if(v==="__new__"){setShowNewCliente(true);setSelClienteId("")}else{setShowNewCliente(false);setSelClienteId(v)}}
          } style={{flex:1,background:"var(--bg-muted)",border:"1px solid rgba(255,255,255,.06)",borderRadius:5,color:"var(--text)",fontSize:9,padding:"3px 6px"}}>
          <option value="">Sin cliente asignado</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.rut})</option>)}
          <option value="__new__" style={{borderTop:"1px solid rgba(255,255,255,.06)"}}>+ Crear cliente nuevo</option>
        </select>
      </div>
      {showNewCliente && (
        <div style={{display:"flex",gap:4,marginBottom:6}}>
          <input placeholder="Nombre" value={newClienteNombre} onChange={e => setNewClienteNombre(e.target.value)}
            style={{flex:1,background:"var(--bg-muted)",border:"1px solid rgba(255,255,255,.06)",borderRadius:5,color:"var(--text)",fontSize:9,padding:"3px 6px"}} />
          <input placeholder="RUT" value={newClienteRut} onChange={e => setNewClienteRut(e.target.value)}
            style={{width:100,background:"var(--bg-muted)",border:"1px solid rgba(255,255,255,.06)",borderRadius:5,color:"var(--text)",fontSize:9,padding:"3px 6px"}} />
        </div>
      )}
      <div className="notas" style={{fontSize:9,color:"var(--text2)",fontStyle:"italic",marginBottom:6}}>{propuesta.notas ?? ""}</div>
      <div className="actions" style={{display:"flex",gap:4}}>
        <button onClick={handleAprobar} disabled={busy}
          style={{flex:1,fontSize:10,padding:"5px 8px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:600,background:"#E8553E",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:4,opacity:busy?0.5:1}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          {busy ? "..." : "Aprobar"}
        </button>
        <button onClick={() => onClose()}
          style={{flex:1,fontSize:10,padding:"5px 8px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:600,background:"rgba(245,158,11,.1)",color:"var(--amber)",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          ✏️ Editar
        </button>
        <button onClick={handleRechazar} disabled={busy}
          style={{flex:1,fontSize:10,padding:"5px 8px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:600,background:"rgba(239,68,68,.1)",color:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",gap:4,opacity:busy?0.5:1}}>
          ✕ {busy ? "..." : "Rechazar"}
        </button>
      </div>
    </div>
  );
}
