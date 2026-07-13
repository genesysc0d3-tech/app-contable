"use client";

import { useState, useMemo, useEffect, useRef, useId } from "react";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase";
import { useEmissionLockStatus } from "./useEmissionLockStatus";
import { useMesaReload } from "./mesa-reload";
import { formatShortDateEsCl } from "@/lib/display-date";
import EmitirLoteModal from "./EmitirLoteModal";

interface Item {
  id: string;
  descripcion: string;
  fecha: string;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  receptor_direccion?: string | null;
  receptor_comuna?: string | null;
  receptor_email?: string | null;
  receptor_telefono?: string | null;
  medio_pago?: string | null;
  // Glosa YA segura (resolverGlosa server-side) para armar el payload del lote real.
  detalle?: string | null;
  monto_total: number;
  balde: "listas" | "por_revisar" | "bloqueadas";
  listo_emitir: boolean;
  motivo_no_listo: string | null;
  motivo_code: "no_boletar" | "monto_invalido" | "falta_receptor" | "editado_sin_aprobar" | null;
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
    // Proveedor de boletas de la empresa (viaja en totales — Mesa.tsx arma este
    // payload solo con items/totales/aprobadas_otros_tipos). El lote HOY solo
    // emite con mock: con proveedor real se avisa y se bloquea el CTA.
    boletas_proveedor?: "mock" | "sii_local" | "simpleapi" | null;
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
    case "RECEPTOR_RAZON_SOCIAL_OBLIGATORIA": return "Falta identificar al receptor (sobre 135 UF).";
    case "MEDIO_PAGO_OBLIGATORIO": return "Falta el medio de pago.";
    case "ESTADO_INVALIDO": return "Apruébala en Check antes de emitir.";
    case "PROVEEDOR_NO_IMPLEMENTADO": return "La emisión masiva aún no está disponible para tu proveedor. Usa Boleta única por ahora.";
    case "NO_BOLETAR": return "No corresponde boletear (no es una venta).";
    case "SIN_FOLIOS_DISPONIBLES": return "No quedan folios disponibles.";
    case "AFECTA_IVA_CERO": return "Boleta afecta con IVA $0 — revisa el monto.";
    default: return msg || "No se pudo emitir.";
  }
}

// Traduce el error TOP-LEVEL del lote (falla toda la operación, no un ítem) a lenguaje
// humano. El server manda a veces `detalle` con copy listo — se prefiere ese; si solo
// viene el código, lo traducimos acá para no mostrarle jerga al usuario.
function errorLoteAmable(code?: string, detalle?: string): string {
  if (detalle && !/^[A-Z0-9_]+$/.test(detalle)) return detalle;
  switch (code) {
    case "EMPRESA_SIN_CUENTA": return "Tu cuenta aún no está activada para emitir. Escríbenos si no sabes por qué.";
    case "EMPRESA_SIN_DATOS_FISCALES": return "Faltan datos de tu empresa (RUT o razón social). Complétalos en Empresa.";
    case "CERTIFICADO_REQUERIDO": return "Falta tu certificado digital del SII para emitir en real.";
    case "EMISION_BLOQUEADA": return "Ya hay una emisión en curso en tu cuenta. Espera a que termine.";
    case "PLAN_INACTIVO":
    case "SIN_PLAN": return "Necesitas un plan activo para emitir. Actívalo en Planes.";
    case "ROL_SIN_PERMISO": return "Tu rol no permite emitir documentos.";
    case "DEMASIADAS_PROPUESTAS": return "Son demasiadas de una vez (máximo 200 por lote).";
    case "SIN_PROPUESTAS": return "No hay nada seleccionado para emitir.";
    case "QUERY_FAILED": return "No pudimos leer las propuestas. Reintenta en un momento.";
    case "NO_AUTH": return "Tu sesión expiró. Vuelve a entrar.";
    default: return detalle || "No se pudo emitir. Reintenta en un momento.";
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
      <div>
        <div style={{width:56,height:56,margin:"0 auto 14px",borderRadius:14,background:"var(--surface2)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text3)"}}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>
        </div>
        <div style={{fontSize:14,fontWeight:600,color:"var(--text)",letterSpacing:"-.02em"}}>{loading ? "Revisando la mesa" : "Nada listo para emitir"}</div>
        <div style={{marginTop:5,fontSize:12,lineHeight:1.45,maxWidth:280}}>{loading ? "Buscando pendientes de emisión…" : "Cuando una propuesta quede lista, aparecerá aquí."}</div>
        {!loading && (
          <div style={{marginTop:8,fontSize:11,lineHeight:1.45,maxWidth:280,color:"var(--text3)"}}>
            Estás viendo solo el período del calendario. Si aprobaste en otra fecha, cambia el día, semana o mes arriba.
          </div>
        )}
        {!loading && otros > 0 && (
          <div style={{margin:"14px auto 0",maxWidth:300,padding:"10px 12px",borderRadius:11,background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",color:"var(--amber)",fontSize:10,lineHeight:1.5,textAlign:"left"}}>
            {otros === 1 ? "1 propuesta aprobada quedó" : `${otros} propuestas aprobadas quedaron`} como gasto u otro tipo, por eso no se {otros === 1 ? "emite" : "emiten"} como boleta. Si corresponde boletear, cambia el tipo a Boleta en Check.
          </div>
        )}
      </div>
    </div>
  );
}

function nextActionLabel(code: Item["motivo_code"]): string | null {
  if (code === "falta_receptor") return "Completa receptor en Check";
  if (code === "monto_invalido") return "Corrige el monto en Check";
  if (code === "no_boletar") return "Revisa la clasificación antes de emitir";
  if (code === "editado_sin_aprobar") return "Apruébala en Check antes de emitir";
  return null;
}

export default function EmitirTabContent({ initial = null, empresaId }: { initial?: PendientesResponse | null; empresaId?: string }) {
  const { toast } = useToast();
  const reloadCtx = useMesaReload();
  const reload = useMemo(() => reloadCtx ?? (() => {}), [reloadCtx]);
  // La mesa (calendario maestro) es la fuente: `initial` ya viene filtrado por
  // periodo y es reactivo a la navegación del calendario. Refrescar = reloadMesa.
  const data = initial;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"listas" | "por_revisar" | "bloqueadas" | "todas">(
    () => initial && initial.totales.listas_emitir === 0 && (initial.totales.por_revisar ?? 0) > 0 ? "por_revisar" : "listas",
  );
  const [typeFilter, setTypeFilter] = useState<"todos" | "afecta" | "exenta">("todos");
  const [cols, setCols] = useState<1 | 2>(() => {
    if (typeof window === "undefined") return 1;
    try { return localStorage.getItem("emitir-cols") === "2" ? 2 : 1; } catch { return 1; }
  });
  const setColumns = (n: 1 | 2) => { setCols(n); try { localStorage.setItem("emitir-cols", String(n)); } catch { /* noop */ } };
  const [emitiendo, setEmitiendo] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loteOpen, setLoteOpen] = useState(false);
  const [lastResult, setLastResult] = useState<EmitirResult | null>(null);
  // Foto receptor/monto de lo enviado: el recibo de fallos la necesita aunque
  // la cola ya se haya recargado (reload() saca los items de `data`).
  const [emitSnapshot, setEmitSnapshot] = useState<Record<string, { receptor: string; monto: number }>>({});
  const { lockedByOther, businessMode, lockMessage } = useEmissionLockStatus();

  // Auto-refresh SILENCIOSO: la cola sigue al dato nuevo sin botón manual y sin que el
  // ojo lo note (reload silent = no atenúa la mesa). Canal único por instancia (mismo
  // patrón que DocCardList) + debounce para coalescer ráfagas. reloadRef evita re-suscribir.
  const channelId = useId().replace(/:/g, "");
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);
  useEffect(() => {
    if (!empresaId) return;
    const bump = () => { if (autoTimer.current) clearTimeout(autoTimer.current); autoTimer.current = setTimeout(() => reloadRef.current({ silent: true }), 500); };
    const ch = supabase
      .channel(`v5-emitir-${empresaId}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "propuestas_ia", filter: `empresa_id=eq.${empresaId}` }, bump)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "boletas_emitidas", filter: `empresa_id=eq.${empresaId}` }, bump)
      .subscribe();
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); supabase.removeChannel(ch); };
  }, [empresaId, channelId]);

  // Escape cierra el modal de confirmación (nunca a mitad de una emisión).
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emitiendo) { setConfirmOpen(false); setLastResult(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, emitiendo]);

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

  // El endpoint de lote solo emite con proveedor mock: con sii_local/simpleapi cada
  // ítem fallaría después de confirmar. Se avisa antes y se bloquea el CTA.
  const proveedorBoletas = data?.totales.boletas_proveedor ?? null;
  const proveedorReal = proveedorBoletas === "sii_local" || proveedorBoletas === "simpleapi";

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
    if (proveedorReal) {
      toast("La emisión masiva aún no está disponible para tu proveedor. Emite con Boleta única por ahora.", "error");
      return;
    }
    if (lockedByOther) {
      toast(lockMessage, "error");
      return;
    }
    setEmitiendo(true);
    setEmitSnapshot(Object.fromEntries(selectedItems.map((i) => [i.id, { receptor: i.receptor_nombre || i.descripcion || "Sin nombre", monto: i.monto_total }])));
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
        // 'detalle' trae el copy humano del server (p.ej. metering); si solo viene el
        // código, errorLoteAmable lo traduce (nunca mostrar jerga al usuario).
        toast(errorLoteAmable(json.error, json.detalle), "error");
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
        {/* Pills */}
        <div className="em-pills">
          <button className={`pl ${statusFilter === "listas" ? "act" : "ina"}`} onClick={() => setStatusFilter("listas")}>Listas ({listasCount})</button>
          <button className={`pl ${statusFilter === "por_revisar" ? "act" : "ina"}`} onClick={() => setStatusFilter("por_revisar")}>Por revisar ({porRevisarCount})</button>
          <button className={`pl ${statusFilter === "bloqueadas" ? "act" : "ina"}`} onClick={() => setStatusFilter("bloqueadas")}>Bloqueadas ({bloqueadasCount})</button>
          <button className={`pl ${statusFilter === "todas" ? "act" : "ina"}`} onClick={() => setStatusFilter("todas")}>Todas ({totalCount})</button>
          <span style={{fontSize:10,color:"var(--text3)",margin:"0 4px"}}>|</span>
          <button className={`pl ${typeFilter === "todos" ? "act" : "ina"}`} onClick={() => setTypeFilter("todos")}>Todos</button>
          <button className={`pl ${typeFilter === "afecta" ? "act" : "ina"}`} onClick={() => setTypeFilter("afecta")}>Afecta</button>
          <button className={`pl ${typeFilter === "exenta" ? "act" : "ina"}`} onClick={() => setTypeFilter("exenta")}>Exenta</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {selectableItems.length > 0 && (
              <label className="sc" style={{ marginLeft: 0 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{accentColor:"#E8553E"}} />
                {" "}Seleccionar todas ({selectableItems.length})
              </label>
            )}
            <div title="Columnas" style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg-muted)", border: "1px solid var(--border)", flexShrink: 0 }}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" onClick={() => setColumns(n)} title={n === 1 ? "Una columna" : "Dos columnas"}
                  style={{ display: "grid", placeItems: "center", width: 24, height: 18, borderRadius: 6, border: "none", cursor: "pointer", background: cols === n ? "rgba(232,85,62,.16)" : "transparent", color: cols === n ? "#E8553E" : "var(--text2)", transition: "all .15s ease" }}>
                  {n === 1 ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="12" height="16" rx="2"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="7" height="16" rx="1.5"/><rect x="13" y="4" width="7" height="16" rx="1.5"/></svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Items */}
        {itemsList.length === 0 ? (
          <EmitirEmpty />
        ) : (
          <div className={`em-grid ${cols === 2 ? "cols2" : ""}`}>{itemsList.map(item => {
            const isDisabled = !item.listo_emitir;
            const isSelected = selected.has(item.id);
            const tipo = activeTipo(item);
            const isAfecta = tipo === 39;

            return (
              <div key={item.id} className={`em-item ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}>
                <div className={`cb ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}
                  onClick={() => !isDisabled && toggleItem(item.id)}
                  style={isDisabled ? {} : {cursor:"pointer"}}
                >{isSelected ? "✓" : ""}</div>
                <div className="inf" onClick={() => { if (item.balde !== "listas") goToCheck(item); else if (!isDisabled) toggleItem(item.id); }}
                  style={((item.balde !== "listas" && item.documento_id) || (item.balde === "listas" && !isDisabled)) ? { cursor: "pointer" } : undefined}>
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
                    <div className="sub" style={{ color: "#E8553E", fontWeight: 600, marginTop: 2 }}>Resolver en Check →</div>
                  )}
                  {item.balde === "listas" && item.documento_id && (
                    <button onClick={(e) => { e.stopPropagation(); goToCheck(item); }} title="Corregir el tipo en Check"
                      style={{ fontSize: 10, fontWeight: 500, color: "var(--text2)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 2, textAlign: "left", display: "block" }}>Corregir en Check →</button>
                  )}
                </div>
                <div className="tp" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                  {item.balde === "por_revisar" ? (
                    // Sin decisión humana aún → no afirmar un tipo (evita contradecir a Check).
                    <span style={{ fontSize: 9, fontWeight: 600, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", color: "var(--amber)", background: "rgba(245,158,11,.12)" }}>Falta tipo</span>
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 600, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", color: isAfecta ? "var(--accent)" : "var(--blue)", background: isAfecta ? "rgba(232,85,62,.13)" : "rgba(91,156,246,.13)" }}>{isAfecta ? "Afecta · con IVA" : "Exenta · sin IVA"}</span>
                  )}
                </div>
                <div className="mo">{fmt(item.monto_total)}</div>
              </div>
            );
          })}</div>
        )}
      </div>

      {/* Bottom bar */}
      {data && (
        <div className="em-bar">
          <div className="l">
            <span className="b">{listasCount}</span> {listasCount === 1 ? "lista" : "listas"} para emitir · <span className="b">{selectedCount}</span> seleccionadas · Total: <span className="b">{fmt(selectedTotal)}</span>
          </div>
          {lockedByOther && (
            <div style={{ minWidth: 0, flex: 1, padding: "6px 9px", borderRadius: 9, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "var(--amber)", fontSize: 9, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>
              <strong style={{ fontSize: 9 }}>{businessMode ? "Equipo" : "Emisión en curso"}:</strong>{" "}{lockMessage}
            </div>
          )}
          <div className="r">
            <button className="emit" onClick={() => (proveedorReal ? setLoteOpen(true) : setConfirmOpen(true))} disabled={emitiendo || selectedCount === 0 || lockedByOther}>
              {emitiendo ? (
                <span className="sp" style={{display:"inline-block"}} />
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {" "}{lockedByOther ? "Emisión en curso" : emitiendo ? "Emitiendo..." : selectedCount === 0 ? "Selecciona boletas" : `Emitir ${selectedCount}`}
            </button>
          </div>
        </div>
      )}

      {/* Carril REAL (SII local): el motor masivo sale encima de la pestaña. */}
      {loteOpen && (
        <EmitirLoteModal
          items={selectedItems}
          empresaId={empresaId ?? ""}
          empresaRut={null}
          onClose={() => setLoteOpen(false)}
          onDone={() => { setSelected(new Set()); reload(); }}
        />
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
                  {lastResult.sandbox && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "var(--amber)", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● PRUEBA</span>}
                </div>
                {lastResult.exitos > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span style={{ fontSize: 30, fontWeight: 800, color: "var(--green)", letterSpacing: "-.03em" }}>{lastResult.exitos}</span>
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
                    {lastResult.resultados.filter((r) => !r.ok).map((r) => {
                      const it = emitSnapshot[r.propuesta_id];
                      return (
                        <div key={r.propuesta_id} style={{ fontSize: 11, color: "var(--red)", lineHeight: 1.5 }}>
                          · {it && <span style={{ color: "var(--text2)" }}>{it.receptor} · {fmt(it.monto)} — </span>}{errorAmable(r.error_code, r.error_message)}
                        </div>
                      );
                    })}
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
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text2)" }}>Vas a emitir</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "var(--amber)", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● MODO PRUEBA</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, color: "var(--text)", letterSpacing: "-.03em" }}>{selectedCount}</span>
                  <span style={{ fontSize: 14, color: "var(--text2)" }}>{selectedCount === 1 ? "boleta" : "boletas"}</span>
                </div>
                <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
                  {selAfecta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "rgba(232,85,62,.13)", padding: "4px 10px", borderRadius: 8 }}>{selAfecta} con IVA</span>}
                  {selExenta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", background: "rgba(91,156,246,.13)", padding: "4px 10px", borderRadius: 8 }}>{selExenta} sin IVA</span>}
                </div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 12, color: "var(--text2)" }}>
                  Total <b style={{ color: "var(--text)" }}>{fmt(selectedTotal)}</b>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>
                  Modo de prueba: se simula, no se informa al SII. Una boleta real no se puede deshacer. Si algo sale mal, escríbenos a soporte.
                </div>
                <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5 }}>
                  La boleta documenta el ingreso; el impuesto a la renta se declara aparte (F22) sobre la ganancia, no sobre el total.
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
