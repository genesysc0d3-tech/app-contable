"use client";

// Piezas compartidas del flujo Revisar — extraídas de RevisarTabContent para
// poder reusar la tarjeta de propuesta (ExpandedDetail) y el grupo por confianza
// (ConfianzaGroupSection) en el visor de la mesa unificada y en el popup MassDTE,
// sin duplicar código. Comportamiento idéntico al original.

import { useState, useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { rechazarPropuesta, ponerListo, crearClienteDesdeRevisar, editarPropuesta, editarGlosaEmitible } from "../../revisar/actions";
import { useToast } from "@/components/Toast";
import TermHint from "@/components/ui/TermHint";
import { esTipoPropuestoExento } from "@/lib/sii/tipos-propuesta";
import type { Tables } from "@/lib/database.types";
import { formatShortDateEsCl } from "@/lib/display-date";
import { validarRut, RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";
import { useMesaReload } from "./mesa-reload";
import { obtenerUmbralReceptorClp } from "./actions";

export type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw"> & {
    documentos_subidos: { id: string; nombre_archivo: string; created_at: string };
  };
};
export type ClienteResumen = { id: string; nombre: string; rut: string | null };
export interface DocTab { docId: string; nombre: string; total: number; }

export const ALTA = 0.85;
export const MEDIA = 0.5;

// Bulk gate compartido: nunca poner listas en lote las tx muy inseguras — esas
// se revisan 1×1. Mismo umbral que usa el bulk de CartolaEditor.
export const BULK_MIN_CONFIANZA = 0.8;

export function classifyConfianza(p: Propuesta): "alta" | "media" | "baja" {
  const c = p.confianza ?? 0;
  return c >= ALTA ? "alta" : c >= MEDIA ? "media" : "baja";
}

export function fmt(n: number | null | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString("es-CL")}`;
}

export function fmtShort(d: string | null | undefined): string {
  return formatShortDateEsCl(d, true);
}

// Tipo de la propuesta para decisión rápida: visible tanto en la fila
// colapsada (sigla) como en el detalle expandido (label completo).
export function tipoMeta(tipoPropuesto: string | null) {
  if (tipoPropuesto === "gasto_egreso") return { sigla: "GASTO", label: "Gasto · no se boletea", bg: "rgba(245,158,11,.12)", color: "var(--amber)" };
  if (tipoPropuesto === "no_comercial") return { sigla: "N/C", label: "No comercial · no se boletea", bg: "color-mix(in srgb, var(--text) 7%, transparent)", color: "var(--text2)" };
  const afecta = tipoPropuesto === "boleta" || tipoPropuesto === "factura";
  return afecta
    ? { sigla: "AFE", label: "Boleta · afecta", bg: "rgba(180,240,39,.1)", color: "var(--lime)" }
    : { sigla: "EXE", label: "Boleta · exenta", bg: "rgba(91,156,246,.1)", color: "var(--blue)" };
}

export function RevisarEmpty() {
  return (
    <div className="r-scroll" style={{display:"grid",placeItems:"center",minHeight:320,padding:"42px 18px",textAlign:"center",color:"var(--text2)"}}>
      <style>{`@keyframes revisarSonar{0%{transform:scale(.72);opacity:.46}70%,100%{transform:scale(1.22);opacity:0}}@keyframes revisarTrace{0%{stroke-dashoffset:42;opacity:.32}50%{opacity:1}100%{stroke-dashoffset:0;opacity:.5}}`}</style>
      <div style={{transform:"translateY(7px)"}}>
        <div style={{position:"relative",width:104,height:104,margin:"0 auto 16px"}}>
          <div style={{position:"absolute",inset:8,borderRadius:"50%",border:"1px solid rgba(34,197,94,.26)",animation:"revisarSonar 2.8s ease-out infinite"}} />
          <svg viewBox="0 0 96 96" fill="none" style={{position:"absolute",inset:0,color:"var(--green)"}}><path d="M48 78c16.568 0 30-13.432 30-30S64.568 18 48 18 18 31.432 18 48s13.432 30 30 30Z" stroke="currentColor" strokeWidth="4"/><path d="m35 48 9 9 19-21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="42" style={{animation:"revisarTrace 2.8s ease-in-out infinite"}}/></svg>
        </div>
        <div style={{fontSize:15,fontWeight:800,color:"var(--text)",letterSpacing:"-.025em"}}>Todo despejado</div>
        <div style={{marginTop:5,fontSize:11,lineHeight:1.45,maxWidth:270}}>No hay propuestas pendientes para revisar en esta mesa.</div>
      </div>
    </div>
  );
}

/* ─── Confianza Group Section ─── */
export function ConfianzaGroupSection({ tipo, label, propuestas, color, clientes, empresaId, onAction, empresaTipoContribuyente }: {
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
      {/* ✕ ghost (mismo patrón que .ce-reject de CartolaEditor): atenuado hasta hover
          y separado del ✎ para prevenir misclick */}
      <style>{`.rs-reject{opacity:.28;transition:opacity .15s;display:inline-flex;margin-left:8px;}
.tr:hover .rs-reject,.rs-reject:hover{opacity:1;}`}</style>
      {/* Padding */}
      <div style={{padding:"10px 16px 0"}}>
        <div className={`cg ${tipo}`} style={{borderBottom:"1px solid var(--border)"}}>
          {/* Accordion header */}
          <div className="cg-h" onClick={() => setExpanded(!expanded)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 0",cursor:"pointer"}}>
            <span className="arr" style={{fontSize:8,color:"var(--text2)",transform:expanded?"rotate(90deg)":"none",transition:"transform .2s",flexShrink:0}}>▶</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={color}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span className="lbl" style={{fontSize:10,fontWeight:600,flex:1,color}}>{label}</span>
            <span className="cnt" style={{fontSize:9,color:"var(--text2)"}}>{propuestas.length}</span>
            <div className="act" style={{display:"flex",gap:4}} onClick={e => e.stopPropagation()}>
              {useBlocks && <BlockApproveBtn ids={visible.map(p => p.id)} label="Poner página lista" />}
              <ApproveAllBtn propuestas={propuestas} />
            </div>
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
                        background: i === curBlock ? "var(--accent)" : "var(--bg-muted)",
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
                // 'aprobado' = comprometida a Emitir → bloqueada (no ✓/✎). 'editado'
                // sigue siendo borrador editable (auditoría #21).
                const enEmision = p.estado === "aprobado";
                return (
                  <div key={p.id}>
                    {/* Thin row */}
                    <div className="tr" onClick={() => toggleRow(p.id)}
                      style={{display:"flex",alignItems:"center",gap:6,padding:"5px 16px",borderBottom:"1px solid var(--border)",cursor:"pointer"}}
                    >
                      <span className="exp" style={{transform:isExpanded?"rotate(90deg)":"none",color:isExpanded?"var(--accent)":"var(--text2)",fontSize:10,transition:"transform .2s",flexShrink:0}}>▶</span>
                      {(() => { const tm = tipoMeta(p.tipo_propuesto); return (
                        <span title={tm.label} style={{flexShrink:0,minWidth:38,textAlign:"center",fontSize:7,fontWeight:800,letterSpacing:".04em",padding:"2px 5px",borderRadius:8,background:tm.bg,color:tm.color}}>{tm.sigla}</span>
                      ); })()}
                      <div className="info" style={{flex:1,minWidth:0}}>
                        <div className="tt" style={{fontSize:10,fontWeight:500,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.movimientos_raw.descripcion}</div>
                        <div className="mt" style={{fontSize:8,color:"var(--text2)",marginTop:1,display:"flex",alignItems:"center",gap:4}}>
                          {fmt(p.movimientos_raw.monto)} <span style={{color:"var(--border)"}}>·</span> {fmtShort(p.movimientos_raw.fecha)}
                          {p.receptor_nombre && <><span style={{color:"var(--border)"}}>·</span> {p.receptor_nombre}</>}
                        </div>
                      </div>
                      <span className={`cf ${(p.confianza ?? 0) >= ALTA ? "hi" : (p.confianza ?? 0) >= MEDIA ? "me" : "ba"}`}
                        style={{fontSize:9,fontWeight:600,textAlign:"right",minWidth:30,color:(p.confianza??0)>=ALTA?"var(--green)":(p.confianza??0)>=MEDIA?"var(--amber)":"var(--text2)"}}
                      >{Math.round((p.confianza??0)*100)}%</span>
                      {p.estado === "listo" && <span style={{fontSize:8,fontWeight:800,color:"var(--green)",flexShrink:0,letterSpacing:".05em"}}>LISTO</span>}
                      {enEmision && <span style={{fontSize:8,fontWeight:800,color:"var(--blue)",flexShrink:0,letterSpacing:".05em"}}>EN EMISIÓN</span>}
                      <div className="ac" style={{display:"flex",gap:2,flexShrink:0}} onClick={e => e.stopPropagation()}>
                        {!enEmision && <RowActionBtn type="aprove" onClick={async () => {const r=await ponerListo([p.id]);if(r.error) toast(r.error,"error");else toast("Lista");onAction();}} icon="✓" />}
                        <RowActionBtn type="edit" onClick={() => toggleRow(p.id)} icon="✎" />{/* EN EMISIÓN: abre el editor solo-glosa (corregir el Detalle sin degradar la boleta) */}
                        {!enEmision && (
                          <span className="rs-reject">
                            <RowActionBtn type="reject" onClick={async () => {const r=await rechazarPropuesta(p.id);if(r.error) toast(r.error,"error");else toast("Rechazada");onAction();}} icon="✕" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail. EN EMISIÓN (aprobado) → editor SOLO-glosa (corregir el
                        Detalle sin degradar la boleta); borrador → editor completo intacto. */}
                    {isExpanded && (
                      enEmision
                        ? <GlosaEmitibleInline propuesta={p} onAction={onAction} onClose={() => toggleRow(p.id)} />
                        : <ExpandedDetail propuesta={p} clientes={clientes} empresaId={empresaId} onAction={onAction} onClose={() => toggleRow(p.id)} empresaTipoContribuyente={empresaTipoContribuyente} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Bottom separator */}
      <div style={{padding:"0 16px"}}><div style={{borderBottom:"1px solid var(--border)"}} /></div>
    </>
  );
}

/* ─── Row Action Button ─── */
export function RowActionBtn({ onClick, icon, type }: { onClick: () => void; icon: string; type: "aprove"|"edit"|"reject" }) {
  const bg = type === "aprove" ? "rgba(34,197,94,.1)" : type === "edit" ? "rgba(245,158,11,.1)" : "rgba(239,68,68,.1)";
  const cl = type === "aprove" ? "var(--green)" : type === "edit" ? "var(--amber)" : "var(--red)";
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
  const ctxReload = useMesaReload();
  const { toast } = useToast();
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    if (ids.length === 0) return;
    setLoading(true);
    const r = await ponerListo(ids);
    if (r.error) toast(r.error, "error"); else toast(`${r.count} listas`);
    if (ctxReload) ctxReload(); else router.refresh();
    setLoading(false);
  }
  return (
    <button onClick={handle} disabled={loading}
      style={{fontSize:8,padding:"3px 8px",borderRadius:4,border:"1px solid rgba(34,197,94,.35)",cursor:"pointer",fontWeight:600,background:"transparent",color:"var(--green)",opacity:loading?0.5:1}}
    >{loading ? "..." : label}</button>
  );
}

/* ─── Approve All Button ─── */
function ApproveAllBtn({ propuestas }: { propuestas: Propuesta[] }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const ctxReload = useMesaReload();
  const { toast } = useToast();
  // Mismo gate que el bulk de CartolaEditor: las < BULK_MIN_CONFIANZA no se
  // stagean en lote — se revisan 1×1. El label muestra lo que de verdad se prepara.
  const elegibles = propuestas.filter((p) => (p.confianza ?? 0) >= BULK_MIN_CONFIANZA);
  const saltadas = propuestas.length - elegibles.length;
  const disabled = loading || elegibles.length === 0;
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    if (elegibles.length === 0) return;
    setLoading(true);
    const r = await ponerListo(elegibles.map((p) => p.id));
    if (r.error) toast(r.error, "error");
    else toast(saltadas > 0 ? `${r.count} listas · ${saltadas} quedan para revisar` : `${r.count} listas`);
    if (ctxReload) ctxReload(); else router.refresh();
    setLoading(false);
  }
  const label = saltadas > 0
    ? `Poner listas (${elegibles.length} de ${propuestas.length})`
    : `Poner listas (${propuestas.length})`;
  return (
    <button onClick={handle} disabled={disabled}
      style={{fontSize:8,padding:"3px 8px",borderRadius:4,border:"none",cursor:disabled?"default":"pointer",fontWeight:600,background:"var(--green)",color:"#08240f",opacity:disabled?0.5:1}}
    >{loading ? "..." : label}</button>
  );
}

const PAGOS_INLINE = ["Efectivo", "Transferencia electrónica", "Débito", "Crédito", "Otro"];

/* ─── Expanded Detail: el desplegable ES el editor. Mismos campos que el editor
   completo (tipo, detalle, monto, receptor, forma de pago) inline — sin popup
   aparte. "Poner listo" persiste los edits y stagea (lo que ves = lo que se emite). ─── */
// Editor SOLO-glosa para una boleta EN EMISIÓN (aprobado). Corrige el "Detalle" que se
// imprime, sin degradar la boleta ni sacarla de la cola de Emitir (server: editarGlosaEmitible).
// Nace del feedback del 1er contador: la boleta aprobada quedaba sin forma de guardar la glosa.
function GlosaEmitibleInline({ propuesta, onAction, onClose }: {
  propuesta: Propuesta; onAction: () => void; onClose: () => void;
}) {
  const { toast } = useToast();
  const [glosa, setGlosa] = useState<string>(propuesta.notas?.trim() ?? "");
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    if (busy) return;
    setBusy(true);
    const r = await editarGlosaEmitible(propuesta.id, glosa.trim() || null);
    setBusy(false);
    if (r.error) { toast(r.error, "error"); return; }
    toast("Detalle guardado");
    onAction();
    onClose();
  };
  return (
    <div className="pc op" style={{ padding: "6px 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 9, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
        Detalle de la boleta (lo que se imprime en el SII)
      </label>
      <input
        value={glosa}
        onChange={(e) => setGlosa(e.target.value.slice(0, 80))}
        onKeyDown={(e) => { if (e.key === "Enter") void guardar(); }}
        maxLength={80}
        placeholder="ej. Venta de productos"
        autoFocus
        style={{ width: "100%", fontSize: 11, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", outline: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 8, color: "var(--text3)" }}>{glosa.length}/80 · sigue en emisión</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onClose} style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", background: "transparent", border: "none", cursor: "pointer", padding: "6px 10px" }}>Cancelar</button>
          <button onClick={guardar} disabled={busy}
            style={{ fontSize: 10, padding: "6px 18px", borderRadius: 7, border: "none", cursor: busy ? "default" : "pointer", fontWeight: 700, background: "var(--green)", color: "#0a1f12", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Guardando…" : "Guardar detalle"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExpandedDetail({ propuesta, clientes, empresaId, onAction, onClose, empresaTipoContribuyente, compact = false }: {
  propuesta: Propuesta; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; onClose: () => void;
  empresaTipoContribuyente?: string | null; compact?: boolean;
}) {
  const { toast } = useToast();
  const extra = propuesta as unknown as { receptor_direccion?: string | null; receptor_comuna?: string | null; receptor_email?: string | null; receptor_telefono?: string | null; medio_pago?: string | null };

  // Cliente
  const [selClienteId, setSelClienteId] = useState(propuesta.cliente_id ?? "");
  const [newClienteNombre, setNewClienteNombre] = useState("");
  const [newClienteRut, setNewClienteRut] = useState("");
  const [showNewCliente, setShowNewCliente] = useState(false);
  const [busy, setBusy] = useState(false);

  // Umbral 135 UF con la UF VIVA (auditoría #10): arranca en la constante referencial
  // y se re-ancla al valor del server para que el gate coincida con la validación de
  // emisión. Si el fetch falla, queda el fallback referencial (nunca bloquea).
  const [umbralReceptor, setUmbralReceptor] = useState<number>(RECEPTOR_OBLIGATORIO_DESDE);
  useEffect(() => {
    let vivo = true;
    obtenerUmbralReceptorClp()
      .then((u) => { if (vivo && u > 0) setUmbralReceptor(u); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const isGasto = propuesta.tipo_propuesto === "gasto_egreso";
  const isNoComercial = propuesta.tipo_propuesto === "no_comercial";
  const noBoletea = isGasto || isNoComercial;

  // Campos editables (editable, sin lock). El tipo lo decide PRIMERO la clasificación
  // de la propuesta (tipo_dte persistido → tipo_propuesto), y SOLO como desempate la
  // sugerencia de la empresa. Un default de empresa 'afecto'/'auto' NUNCA puede pisar
  // una exención POR LEY (cripto/forex/P2P, Of. SII 963/2018): eso fabricaría IVA
  // inexistente sobre una venta exenta (el footgun que el clasificador ya prohíbe).
  const AFECTOS_POR_TIPO = ["boleta", "factura", "factura_afecta"];
  const tipoInicial: "afecta" | "exenta" =
    propuesta.tipo_dte === 41 ? "exenta"
      : propuesta.tipo_dte === 39 ? "afecta"
        : esTipoPropuestoExento(propuesta.tipo_propuesto) ? "exenta"
          : AFECTOS_POR_TIPO.includes(propuesta.tipo_propuesto) ? "afecta"
            : empresaTipoContribuyente === "exento" ? "exenta"
              : empresaTipoContribuyente === "afecto" ? "afecta"
                : "exenta"; // default seguro: nunca fabricar IVA sobre algo sin clasificar
  const [tipo, setTipo] = useState<"afecta" | "exenta">(tipoInicial);
  const [total, setTotal] = useState<number>(Math.round(propuesta.total ?? propuesta.movimientos_raw?.monto ?? 0));
  // Detalle = SOLO el detalle editado por el humano (notas). NO se prellena con la glosa
  // bancaria: si se prellenara y "Poner listo" lo persistiera sin tocar, notas (máxima
  // precedencia en armar-boleta) pisaría la glosa común de la cartola. Vacío → la glosa
  // cae a glosa común o a la del banco (ver resolverGlosa). La glosa bancaria se ve en el
  // header como referencia y como placeholder.
  const [detalle, setDetalle] = useState<string>(propuesta.notas?.trim() ?? "");
  const [rut, setRut] = useState<string>(propuesta.receptor_rut ?? "");
  const [razon, setRazon] = useState<string>(propuesta.receptor_nombre ?? "");
  const [direccion, setDireccion] = useState<string>(extra.receptor_direccion ?? "");
  const [comuna, setComuna] = useState<string>(extra.receptor_comuna ?? "");
  const [email, setEmail] = useState<string>(extra.receptor_email ?? "");
  const [telefono, setTelefono] = useState<string>(extra.receptor_telefono ?? "");
  const [medioPago, setMedioPago] = useState<string>(extra.medio_pago ?? "");
  // Progresivos (gobernados por 135 UF): bajo el umbral el receptor va escondido tras
  // un link; dirección/comuna detrás de "más datos" (nunca obligatorias). Se abren si
  // ya traen dato o si el usuario los despliega.
  const [showReceptorManual, setShowReceptorManual] = useState(false);
  const [showMasDatos, setShowMasDatos] = useState<boolean>(!!(extra.receptor_direccion || extra.receptor_comuna || extra.receptor_email || extra.receptor_telefono));

  const isAfecta = tipo === "afecta";
  const neto = isAfecta ? Math.round(total / 1.19) : total;
  const iva = isAfecta ? total - neto : 0;
  const conflicto = isAfecta && total > 0 && iva === 0; // afecta con IVA $0 → el SII la rechaza
  const requiereReceptor = total > umbralReceptor; // 135 UF (UF viva, fallback referencial)
  const rutTrim = rut.trim();
  const rutValido = !rutTrim || validarRut(rutTrim);
  const receptorOk = !requiereReceptor || (!!rutTrim && validarRut(rutTrim) && !!razon.trim());
  // Sobre 135 UF el medio de pago es tan obligatorio como el RUT (Res. Ex. SII 44/2025).
  const medioOk = !requiereReceptor || !!medioPago.trim();
  // Detalle OPCIONAL (igual que el flujo masivo): el SII no exige glosa detallada en
  // una boleta a consumidor final; si va vacío, sale un genérico limpio (resolverGlosa).
  const puedeStagear = noBoletea || (total > 0 && !conflicto && rutValido && receptorOk && medioOk);
  const tieneReceptorData = !!rutTrim || !!razon.trim() || !!medioPago.trim() || !!direccion.trim() || !!comuna.trim();
  const receptorAbierto = requiereReceptor || showReceptorManual || tieneReceptorData;

  async function handleAprobar() {
    if (!puedeStagear || busy) return;
    setBusy(true);
    let cid = selClienteId;
    if (showNewCliente && newClienteNombre.trim()) {
      const res = await crearClienteDesdeRevisar({empresa_id: empresaId, nombre: newClienteNombre.trim(), rut: newClienteRut.trim() || undefined});
      if ("cliente" in res && res.cliente) cid = res.cliente.id;
    }
    // Persistir los edits ANTES de stagear: lo que ves = lo que se emite.
    const patch = noBoletea
      ? { notas: detalle.trim() || null }
      : {
          tipo_propuesto: isAfecta ? "boleta" : "exenta",
          tipo_dte: isAfecta ? 39 : 41,
          total: Math.round(total), monto_neto: neto, iva,
          receptor_rut: rutTrim || null, receptor_nombre: razon.trim() || null,
          receptor_direccion: direccion.trim() || null, receptor_comuna: comuna.trim() || null,
          receptor_email: email.trim() || null, receptor_telefono: telefono.trim() || null,
          medio_pago: medioPago.trim() || null, notas: detalle.trim() || null,
        };
    const e = await editarPropuesta(propuesta.id, patch);
    if (e?.error) { toast(e.error, "error"); setBusy(false); return; }
    const r = await ponerListo([propuesta.id], cid || null);
    // Aprender-al-clasificar: si al resolver este movimiento la app acomodó a los
    // hermanos de la misma contraparte en la cartola, lo mostramos (el "momento
    // mágico"). Si solo aprendió la regla para la próxima, un aviso más suave.
    const ap = e && "aprendizaje" in e ? e.aprendizaje : null;
    if (r.error) toast(r.error, "error");
    else if (ap && ap.propagadas > 0) toast(`Lista · acomodé ${ap.propagadas} más de la misma contraparte`);
    else if (ap && (ap.creada || ap.actualizada)) toast("Lista · aprendí esta contraparte");
    else toast("Lista");
    onAction();
    setBusy(false);
    onClose();
  }

  async function handleRechazar() {
    setBusy(true);
    const r = await rechazarPropuesta(propuesta.id);
    if (r.error) toast(r.error, "error"); else toast("Rechazada");
    onAction();
    setBusy(false);
    onClose();
  }

  const lbl: CSSProperties = { fontSize: 9, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 3 };
  const inp: CSSProperties = { width: "100%", fontSize: 11, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", outline: "none" };
  const linkBtn: CSSProperties = { background: "none", border: "none", padding: "3px 0", cursor: "pointer", fontSize: 9, fontWeight: 600, color: "var(--text3)", textAlign: "left" };
  const conf = Math.round((propuesta.confianza ?? 0) * 100);
  const confCol = (propuesta.confianza ?? 0) >= ALTA ? "var(--green)" : (propuesta.confianza ?? 0) >= MEDIA ? "var(--amber)" : "var(--text2)";

  return (
    <div className="pc op" style={{padding:"2px 16px 12px"}}>
      {/* Header: confianza + glosa bancaria de referencia (el tipo vive en el toggle, no repetido) */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
        <span style={{color:confCol,fontSize:11,fontWeight:700}}>{conf}%</span>
        {!compact && <TermHint width={250}>Qué tan segura está la IA de esta clasificación, según la glosa bancaria, el monto y tu historial. Verde (≥85%) es confiable; bajo eso, dale una mirada.</TermHint>}
        <span style={{marginLeft:"auto",fontSize:8,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"46%"}} title={propuesta.movimientos_raw.descripcion}>del banco (no se imprime): {propuesta.movimientos_raw.descripcion}</span>
      </div>

      {noBoletea ? (
        <>
          <div style={{fontSize:10,color:"var(--text2)",marginBottom:8,lineHeight:1.4}}>
            {/* Copy corregido (feedback fundador): decía "cambia el tipo en Emitir",
                pero a Emitir solo llegan aprobadas — el cambio se hace acá mismo
                con el lápiz. Nunca apuntar a otra pestaña para un gesto local. */}
            Este movimiento se registra pero {isGasto ? "es plata que salió (gasto): " : ""}no genera boleta. Si en realidad fue una venta tuya, ábrela con el lápiz ✎ y cámbiale el tipo a boleta (afecta o exenta).
          </div>
          <div style={{marginBottom:8}}>
            <label style={lbl}>Detalle (opcional)</label>
            <input value={detalle} maxLength={80} onChange={e=>setDetalle(e.target.value)} style={inp} />
          </div>
        </>
      ) : (
        <>
          {/* Detalle — única fila full-width: es la glosa que se imprime (máx 80 chars) */}
          <div style={{marginBottom:8}}>
            <label style={{...lbl,display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span>Detalle (opcional)</span>
              <span style={{fontWeight:600,color:detalle.length>=80?"var(--red)":"var(--text3)"}}>{detalle.length}/80</span>
            </label>
            <input value={detalle} maxLength={80} onChange={e=>setDetalle(e.target.value)} placeholder="Qué se vendió o prestó (se imprime en la boleta)" style={inp} />
          </div>

          {/* Fila resumen: Tipo + Monto + neto/IVA vivo — todo en un renglón denso */}
          <div style={{display:"grid",gridTemplateColumns:"auto 150px 1fr",gap:12,alignItems:"end",marginBottom:8}}>
            <div>
              <label style={lbl}>Tipo</label>
              <div style={{display:"flex",width:"fit-content",borderRadius:8,border:"1px solid var(--border)",overflow:"hidden"}}>
                {([["exenta","Exenta · 41","var(--blue)"],["afecta","Afecta · 39","var(--accent)"]] as const).map(([k,l,c])=>{
                  const active = tipo===k;
                  return <button key={k} onClick={()=>setTipo(k)} style={{fontSize:9,fontWeight:700,padding:"6px 12px",border:"none",cursor:active?"default":"pointer",background:active?`color-mix(in srgb, ${c} 20%, transparent)`:"transparent",color:active?c:"var(--text3)",transition:"all .12s"}}>{l}</button>;
                })}
              </div>
            </div>
            <div>
              <label style={lbl}>Monto</label>
              <input type="number" value={total} onChange={e=>setTotal(Math.round(Number(e.target.value)||0))} style={{...inp,fontWeight:700,fontSize:13,textAlign:"right"}} />
            </div>
            <div style={{fontSize:9,fontWeight:600,color:conflicto?"var(--amber)":"var(--text3)",paddingBottom:8,textAlign:"right",whiteSpace:"nowrap"}}>
              {conflicto ? "⚠ afecta con IVA $0" : isAfecta ? <>neto {fmt(neto)} · IVA {fmt(iva)}</> : "exenta · sin IVA"}
            </div>
          </div>

          {/* Receptor + forma de pago: progresivo por 135 UF (el 95% de las tx no lo necesita) */}
          {receptorAbierto ? (
            <div style={{marginBottom:8}}>
              <label style={lbl}>Receptor{requiereReceptor && <span style={{color:"var(--amber)",textTransform:"none",letterSpacing:0}}> · obligatorio sobre 135 UF (RUT, nombre y medio de pago)</span>}</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1.3fr 1fr",gap:6}}>
                <input value={rut} onChange={e=>setRut(e.target.value)} placeholder="RUT" aria-label="RUT del receptor" aria-invalid={!rutValido || undefined} style={{...inp,borderColor:!rutValido?"var(--red)":requiereReceptor&&!rutTrim?"var(--amber)":"var(--border)"}} />
                <input value={razon} onChange={e=>setRazon(e.target.value)} placeholder="Nombre / razón social" aria-label="Nombre o razón social del receptor" style={inp} />
                <select value={medioPago} onChange={e=>setMedioPago(e.target.value)} aria-label="Medio de pago" style={{...inp,cursor:"pointer",borderColor:requiereReceptor&&!medioPago.trim()?"var(--amber)":"var(--border)"}}>
                  <option value="">Medio de pago…</option>
                  {PAGOS_INLINE.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {!rutValido && <div role="alert" style={{fontSize:10,color:"var(--red)",marginTop:2}}>RUT no válido</div>}
              {showMasDatos ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
                  <input value={direccion} onChange={e=>setDireccion(e.target.value)} placeholder="Dirección (opcional)" style={inp} />
                  <input value={comuna} onChange={e=>setComuna(e.target.value)} placeholder="Comuna (opcional)" style={inp} />
                  <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail (opcional)" type="email" style={inp} />
                  <input value={telefono} onChange={e=>setTelefono(e.target.value)} placeholder="Teléfono (opcional)" type="tel" style={inp} />
                </div>
              ) : (
                <button onClick={()=>setShowMasDatos(true)} style={{...linkBtn,marginTop:4}}>+ dirección, comuna y contacto</button>
              )}
            </div>
          ) : (
            <button onClick={()=>setShowReceptorManual(true)} style={{...linkBtn,marginBottom:8}}>+ identificar receptor (opcional)</button>
          )}
        </>
      )}

      {/* Pie denso: Cliente (izq, opcional, no imprime) + acciones (der) */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
        <span style={{fontSize:9,color:"var(--text3)",flexShrink:0}}>Cliente</span>
        <select value={selClienteId} onChange={e => {const v=e.target.value;if(v==="__new__"){setShowNewCliente(true);setSelClienteId("")}else{setShowNewCliente(false);setSelClienteId(v)}}}
          style={{width:200,background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:7,color:"var(--text)",fontSize:10,padding:"6px 8px",cursor:"pointer"}}>
          <option value="">Sin cliente asignado</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.rut})</option>)}
          <option value="__new__">+ Crear cliente nuevo</option>
        </select>
        <div style={{flex:1}} />
        <button onClick={handleAprobar} disabled={busy || !puedeStagear}
          title={!puedeStagear ? "Falta el monto y —sobre 135 UF— RUT, nombre y medio de pago del receptor" : undefined}
          style={{fontSize:10,padding:"7px 22px",borderRadius:7,border:"none",cursor:busy||!puedeStagear?"default":"pointer",fontWeight:700,background:"var(--green)",color:"#0a1f12",display:"flex",alignItems:"center",justifyContent:"center",gap:5,opacity:busy||!puedeStagear?0.45:1}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          {busy ? "..." : "Poner listo"}
        </button>
        <button onClick={handleRechazar} disabled={busy}
          style={{fontSize:10,padding:"7px 14px",borderRadius:7,border:"none",cursor:"pointer",fontWeight:700,background:"rgba(239,68,68,.08)",color:"var(--accent)",opacity:busy?0.5:1}}>
          ✕ {busy ? "..." : "Rechazar"}
        </button>
      </div>
      {showNewCliente && (
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <input placeholder="Nombre" value={newClienteNombre} onChange={e => setNewClienteNombre(e.target.value)} style={{...inp,flex:1}} />
          <input placeholder="RUT" value={newClienteRut} onChange={e => setNewClienteRut(e.target.value)} style={{...inp,width:120}} />
        </div>
      )}
    </div>
  );
}
