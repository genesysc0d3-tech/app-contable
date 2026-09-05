"use client";

import { useState, useMemo, useEffect, useRef, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase";
import { useEmissionLockStatus } from "./useEmissionLockStatus";
import { useMesaReload } from "./mesa-reload";
import { formatShortDateEsCl } from "@/lib/display-date";
import dynamic from "next/dynamic";
import { type LoteItemInput } from "./EmitirLoteModal";
import InstalarExtension from "./InstalarExtension";
import { leerLotePendiente, limpiarLotePendiente, type LotePendiente } from "@/lib/emission/lote-persist";
import { devolverCartola, ultimaMiradaCartola } from "../../revisar/actions";

// Perf: el modal de emisión en lote sale del bundle inicial; se precarga en idle
// tras montar la pestaña (effect abajo) — abrirlo sigue siendo instantáneo.
// El import type de LoteItemInput arriba se borra al compilar (no arrastra el módulo).
const EmitirLoteModal = dynamic(() => import("./EmitirLoteModal"), { ssr: false });

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
  /** Facturas: giro del receptor (viaja al motor masivo real). */
  receptor_giro?: string | null;
  medio_pago?: string | null;
  // Glosa YA segura (resolverGlosa server-side) para armar el payload del lote real.
  detalle?: string | null;
  monto_total: number;
  balde: "listas" | "por_revisar" | "bloqueadas";
  listo_emitir: boolean;
  /** Avisos que NO impiden emitir (NO_BOLETAR aprobado, TIPO_ASUMIDO…): triángulo, no veto. */
  advertencias?: { code: string; msg: string }[];
  motivo_no_listo: string | null;
  motivo_code: "no_boletar" | "monto_invalido" | "falta_receptor" | "editado_sin_aprobar" | null;
  tipo_sugerido: number | null;
  sugerencia: string | null;
  confianza_clasif: number;
  razones: string[];
  documento_id: string | null;
  documento_nombre?: string | null;
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
    facturas_proveedor?: "mock" | "sii_local" | "simpleapi" | null;
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
    case "CERTIFICADO_REQUERIDO": return "Falta el certificado digital del SII de tu empresa para el carril SimpleAPI. Si emites con la extensión, no lo necesitas: revisa el carril en Empresa → Emisión.";
    case "EMISION_BLOQUEADA": return "Ya hay una emisión en curso en tu cuenta. Espera a que termine.";
    case "PLAN_INACTIVO":
    case "SIN_PLAN": return "Necesitas un plan activo para emitir. Actívalo en Planes.";
    case "CUOTA_AGOTADA": return "Se acabó tu cupo de documentos masivos de este período (boletas y facturas comparten cuota).";
    case "TRIAL_TERMINADO": return "Tu período de prueba terminó — contrata un plan para seguir emitiendo.";
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
        {/* Vocabulario EXACTO del flujo: acá llegan las APROBADAS. Decir "lista"
            confundía (caso real de beta: 73 listas sin aprobar y este texto le
            confirmaba al usuario que "deberían" estar acá). */}
        <div style={{fontSize:14,fontWeight:600,color:"var(--text)",letterSpacing:"-.02em"}}>{loading ? "Revisando la mesa" : "Nada aprobado para emitir"}</div>
        <div style={{marginTop:5,fontSize:12,lineHeight:1.45,maxWidth:280}}>{loading ? "Buscando pendientes de emisión…" : "Acá aparecen las boletas aprobadas. ¿Tienes boletas «listas» en el Check de agregados? Apriétales «Aprobar» y llegan solas."}</div>
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

export default function EmitirTabContent({ initial = null, empresaId, mesa = "boleta" }: { initial?: PendientesResponse | null; empresaId?: string; mesa?: "boleta" | "factura" }) {
  const esFacturas = mesa === "factura";
  // Criterio 7 de Matías: la forma de pago del lote es OBLIGATORIA y SIN
  // default — el usuario la elige expresamente en la revisión, el sistema no
  // presupone cómo se hizo la operación. Solo aplica a facturas.
  // FORMA DE PAGO POR FACTURA (2026-08-27): antes era UNA sola para todo el
  // lote y se preguntaba recién en el modal final. Ahora se decide en la lista
  // —por factura o de una para el grupo— porque un lote real mezcla contado y
  // crédito. Sigue sin default: la elección es expresa (criterio de Matías).
  const [formaPagoItems, setFormaPagoItems] = useState<Record<string, "contado" | "credito">>({});
  const setFormaPagoDe = useCallback((ids: string[], fp: "contado" | "credito") => {
    setFormaPagoItems((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = fp;
      return next;
    });
  }, []);
  const { toast } = useToast();
  const reloadCtx = useMesaReload();
  const reload = useMemo(() => reloadCtx ?? (() => {}), [reloadCtx]);
  // La mesa (calendario maestro) es la fuente: `initial` ya viene filtrado por
  // periodo y es reactivo a la navegación del calendario. Refrescar = reloadMesa.
  const data = initial;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"listas" | "por_revisar" | "bloqueadas" | "todas">(() => {
    // Filtro inicial: mostrar SIEMPRE algo. Con 0 listas el default caía en
    // "Listas" (vacío) aunque hubiera bloqueadas — el usuario veía una pestaña
    // "trabada" sin sus documentos (cazado por el fundador 2026-09-01: aprobó 2
    // no-boleteables y Emitir se veía vacía en vez de mostrarlas con su motivo).
    if (!initial || initial.totales.listas_emitir > 0) return "listas";
    if ((initial.totales.por_revisar ?? 0) > 0) return "por_revisar";
    if ((initial.totales.bloqueadas ?? 0) > 0) return "bloqueadas";
    return "listas";
  });
  const [typeFilter, setTypeFilter] = useState<"todos" | "afecta" | "exenta" | "mixta">("todos");
  const [emitiendo, setEmitiendo] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loteOpen, setLoteOpen] = useState(false);
  // Reanudar un lote a medias (se cerró la pestaña emitiendo, o el SII lo congeló).
  // lotePendiente = los IDs que faltan (leídos de localStorage); loteResume = esos
  // items re-hidratados del server para pasárselos al modal; null = emisión fresca.
  const [lotePendiente, setLotePendiente] = useState<LotePendiente | null>(null);
  const [loteResume, setLoteResume] = useState<LoteItemInput[] | null>(null);
  const [loteResumeTotal, setLoteResumeTotal] = useState<number | null>(null);
  const [resumiendo, setResumiendo] = useState(false);
  // Precarga en idle del chunk del EmitirLoteModal (dynamic import arriba).
  useEffect(() => {
    const t = window.setTimeout(() => { void import("./EmitirLoteModal"); }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    const p = leerLotePendiente(empresaId, esFacturas ? "factura" : "boleta");
    if (!p) return;
    // Lectura de localStorage post-montaje (no existe en SSR): se hace en effect a
    // propósito, para no romper la hidratación (server y cliente-1er-render = null).
    setLotePendiente(p);
  }, [empresaId, esFacturas]);
  // File-first: qué documentos están expandidos + qué popup de "por revisar" está abierta.
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  // Última mirada del conglomerado (pedido fundador 2026-09-01): las juzgadas
  // (sin boleta) de cada cartola, cargadas on-demand al expandir, en un
  // desplegable tachado. Y "Devolver a Check": la cartola completa retrocede.
  const [juzgadasByDoc, setJuzgadasByDoc] = useState<Record<string, { loading: boolean; juzgadas: Array<{ id: string; descripcion: string; monto: number; fecha: string | null }>; emitidas: Array<{ id: string; descripcion: string; monto: number; folio: number | null }> }>>({});
  const [juzgadasOpen, setJuzgadasOpen] = useState<Set<string>>(new Set());
  const [devolviendo, setDevolviendo] = useState<string | null>(null);

  const cargarJuzgadas = useCallback((docId: string) => {
    setJuzgadasByDoc((prev) => {
      if (prev[docId]) return prev; // ya cargadas o cargando
      void ultimaMiradaCartola(docId).then((r) => {
        setJuzgadasByDoc((p) => ({ ...p, [docId]: { loading: false, juzgadas: r.juzgadas, emitidas: r.emitidas } }));
      });
      return { ...prev, [docId]: { loading: true, juzgadas: [], emitidas: [] } };
    });
  }, []);

  const dataRef = useRef(data);
  const expandedDocsRef = useRef(expandedDocs);
  expandedDocsRef.current = expandedDocs;
  useEffect(() => {
    if (dataRef.current === data) return;
    dataRef.current = data;
    setJuzgadasByDoc({});
    for (const key of expandedDocsRef.current) if (key !== "__sueltas__") cargarJuzgadas(key);
  }, [data, cargarJuzgadas]);

  // Una BLOQUEADA vive en una cartola ya aprobada: para editarla hay que
  // devolver la cartola completa primero (modelo cartola-unidad). El botón
  // viejo "Resolver en Check" aterrizaba en el visor decidida, que te mandaba
  // de vuelta a Emitir — loop circular cazado en la auditoría 2026-09-02.
  async function devolverYCorregir(item: { documento_id: string | null; documento_created_at: string | null; fecha: string }) {
    if (!item.documento_id || devolviendo) return;
    setDevolviendo(item.documento_id);
    try {
      const r = await devolverCartola(item.documento_id);
      if (r.error) { toast(r.error, "error"); return; }
      toast(`Cartola devuelta a Check (${r.count} quedan listas) — corrige y aprueba de nuevo`);
      goToCheck(item);
      reload();
    } finally { setDevolviendo(null); }
  }

  async function handleDevolverCartola(docId: string, nombre: string) {
    if (devolviendo) return;
    setDevolviendo(docId);
    try {
      const r = await devolverCartola(docId);
      if (r.error) toast(r.error, "error");
      else toast(`${nombre}: ${r.count} devueltas a Check (quedan listas)`);
      reload();
    } finally { setDevolviendo(null); }
  }
  const [popupDoc, setPopupDoc] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<EmitirResult | null>(null);
  // Foto receptor/monto de lo enviado: el recibo de fallos la necesita aunque
  // la cola ya se haya recargado (reload() saca los items de `data`).
  const [emitSnapshot, setEmitSnapshot] = useState<Record<string, { receptor: string; monto: number }>>({});
  // Cupo/plan agotado: banner persistente con CTA a /planes (un toast se esfuma
  // y "te sugiere pagar" no es "te lleva a pagar").
  const [planCta, setPlanCta] = useState<string | null>(null);
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
    if (typeFilter === "afecta") filtered = filtered.filter(i => i.tipo_sugerido === 39 || i.tipo_sugerido === 33);
    else if (typeFilter === "exenta") filtered = filtered.filter(i => i.tipo_sugerido === 41 || i.tipo_sugerido === 34);
    else if (typeFilter === "mixta") {
      // Mixta = la CARTOLA trae de los dos mundos (afectas Y exentas). Se
      // muestran completas — el filtro es lupa sobre documentos, no recorta filas.
      const afectas = new Set<string>(), exentas = new Set<string>();
      for (const i of filtered) {
        const doc = i.documento_id ?? "sueltas";
        const t = i.tipo_sugerido ?? (esFacturas ? 33 : 39);
        if (t === 39 || t === 33) afectas.add(doc); else exentas.add(doc);
      }
      filtered = filtered.filter(i => { const doc = i.documento_id ?? "sueltas"; return afectas.has(doc) && exentas.has(doc); });
    }
    return filtered;
  }, [data, statusFilter, typeFilter, esFacturas]);

  const listasCount = data?.totales.listas_emitir ?? 0;
  const porRevisarCount = data?.totales.por_revisar ?? 0;
  const bloqueadasCount = data?.totales.bloqueadas ?? 0;
  const totalCount = data?.totales.total_pendientes ?? 0;

  // El endpoint de lote solo emite con proveedor mock: con sii_local/simpleapi cada
  // ítem fallaría después de confirmar. Se avisa antes y se bloquea el CTA.
  // Cada mesa mira SU proveedor: boletas → boletas_proveedor; facturas →
  // facturas_proveedor (el carril real de facturas es sii_local vía extensión).
  const proveedorBoletas = data?.totales.boletas_proveedor ?? null;
  const proveedorFacturas = data?.totales.facturas_proveedor ?? null;
  const proveedorReal = esFacturas
    ? proveedorFacturas === "sii_local"
    : proveedorBoletas === "sii_local" || proveedorBoletas === "simpleapi";

  // Universo de selección = TODO lo emitible, sin filtros: los pills de arriba
  // son lupa para mirar, jamás selección (cartola = unidad; si el filtro
  // recortara la selección, alguien emitiría más o menos de lo que cree ver).
  const selectableItems = useMemo(() => (data?.items ?? []).filter(i => i.listo_emitir), [data]);

  // File-first: agrupar la lista visible por DOCUMENTO (cartola/archivo). En vez de
  // N filas sueltas, se ve el archivo y se expande. documento_id null → "sueltas".
  const grupos = useMemo(() => {
    const map = new Map<string, { docId: string | null; nombre: string; created: string | null; items: Item[] }>();
    for (const it of itemsList) {
      const key = it.documento_id ?? "__sueltas__";
      let g = map.get(key);
      if (!g) { g = { docId: it.documento_id, nombre: it.documento_nombre ?? "Movimientos sueltos", created: it.documento_created_at ?? null, items: [] }; map.set(key, g); }
      g.items.push(it);
    }
    return [...map.values()];
  }, [itemsList]);

  // "Por revisar" (no-listas) por documento, desde TODOS los items (no el filtro) → popup.
  const porRevisarByDoc = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of data?.items ?? []) {
      if (it.balde === "listas") continue;
      const key = it.documento_id ?? "__sueltas__";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [data]);
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
  const selAfecta = selectedItems.filter((i) => {
    const t = i.tipo_sugerido ?? (esFacturas ? 33 : 39);
    return t === 39 || t === 33;
  }).length;
  const selExenta = selectedCount - selAfecta;
  // POSIBLES REPETIDAS (2026-08-27): un intento fallido deja la propuesta
  // aprobada; varios intentos dejan VARIAS por la misma venta. Emitirlas todas
  // = varios documentos reales por una sola operación, y una factura emitida no
  // se deshace. Se AVISA (nunca se bloquea: repetir a un mismo cliente el mismo
  // día por el mismo monto es legítimo) — criterio 3 de Matías.
  const gruposRepetidos = useMemo(() => {
    const porClave = new Map<string, number>();
    for (const i of selectedItems) {
      const clave = `${i.receptor_rut ?? i.receptor_nombre ?? "s/r"}|${i.monto_total}|${i.fecha}`;
      porClave.set(clave, (porClave.get(clave) ?? 0) + 1);
    }
    return [...porClave.values()].filter((n) => n > 1);
  }, [selectedItems]);
  const posiblesRepetidas = gruposRepetidos.reduce((s, n) => s + n, 0);
  // Facturas: reparto de la forma de pago entre lo seleccionado + las que aún
  // no la tienen (bloquean la emisión, sin default).
  const selSinFormaPago = useMemo(
    () => (esFacturas ? selectedItems.filter((i) => !formaPagoItems[i.id]) : []),
    [esFacturas, selectedItems, formaPagoItems],
  );
  const selContado = selectedItems.filter((i) => formaPagoItems[i.id] === "contado").length;
  const selCredito = selectedItems.filter((i) => formaPagoItems[i.id] === "credito").length;

  if (!data) {
    return <EmitirEmpty loading />;
  }

  if (totalCount === 0) {
    return <EmitirEmpty otrosTipos={data?.aprobadas_otros_tipos ?? {}} />;
  }

  async function handleEmitir() {
    if (selectedItems.length === 0) return;
    if (esFacturas && selSinFormaPago.length > 0) {
      toast(`Falta elegir la forma de pago de ${selSinFormaPago.length === 1 ? "1 factura" : `${selSinFormaPago.length} facturas`} — márcalas en la lista`, "error");
      return;
    }
    if (proveedorReal) {
      if (esFacturas) {
        // Carril REAL de facturas: la confirmación (con la forma de pago ya
        // elegida acá) salta al motor masivo de la extensión.
        setConfirmOpen(false);
        setLoteOpen(true);
        return;
      }
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
      const body = {
        items: selectedItems.map(i => ({
          id: i.id,
          tipo_dte: i.tipo_sugerido ?? (esFacturas ? 33 : 39),
          ...(esFacturas ? { forma_pago: formaPagoItems[i.id] } : {}),
        })),
        // Compat: el carril mock del server aún lee forma_pago_lote. Si TODAS
        // comparten forma, se manda; si el lote es mixto, manda la de la
        // primera y cada ítem lleva la suya en `forma_pago`.
        ...(esFacturas ? { forma_pago_lote: formaPagoItems[selectedItems[0].id] ?? null } : {}),
      };
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
        const mensaje = errorLoteAmable(json.error, json.detalle);
        // Errores de plan/cupo (402 del metering): banner persistente con CTA a
        // Planes en vez de un toast que desaparece.
        if (["SIN_PLAN", "PLAN_INACTIVO", "CUOTA_AGOTADA", "TRIAL_TERMINADO"].includes(json.error)) {
          setPlanCta(mensaje);
        } else {
          toast(mensaje, "error");
        }
        setConfirmOpen(false);
      }
    } catch { toast("Error al emitir lote", "error"); }
    setEmitiendo(false);
  }

  function activeTipo(item: Item): number {
    return item.tipo_sugerido ?? 39;
  }

  function toggleDoc(key: string) {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        // Al abrir una cartola real, trae sus juzgadas para la última mirada.
        if (key !== "__sueltas__") cargarJuzgadas(key);
      }
      return next;
    });
  }

  // Selección a nivel documento (cartola = UNIDAD, decisión fundador 2026-09-01):
  // marca/desmarca TODO lo emitible de esa cartola, ignorando los filtros-lupa.
  // Dentro de una cartola no se selecciona por fila — se emite completa o se
  // devuelve completa a Check.
  function toggleDocSelect(items: Item[]) {
    const docId = items[0]?.documento_id ?? null;
    const universo = docId ? (data?.items ?? []).filter((i) => i.documento_id === docId) : items;
    const emitibles = universo.filter(i => i.listo_emitir).map(i => i.id);
    const todasSel = emitibles.length > 0 && emitibles.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (todasSel) emitibles.forEach(id => next.delete(id));
      else emitibles.forEach(id => next.add(id));
      return next;
    });
  }

  // Fila de un movimiento (la misma que había en el em-grid); ahora vive dentro del
  // documento expandido.
  function renderItem(item: Item) {
    const isDisabled = !item.listo_emitir;
    const isSelected = selected.has(item.id);
    const tipo = activeTipo(item);
    const isAfecta = tipo === 39;
    // Cartola = unidad: sus filas NO se seleccionan de a una (el checkbox vive en
    // el header del conglomerado). Solo las sueltas conservan checkbox propio.
    const enCartola = Boolean(item.documento_id);
    return (
      <div key={item.id} className={`em-item ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}>
        {enCartola ? (
          <div style={{ width: 16, flexShrink: 0 }} />
        ) : (
          <div className={`cb ${isSelected ? "sel" : ""} ${isDisabled ? "dis" : ""}`}
            onClick={() => !isDisabled && toggleItem(item.id)}
            style={isDisabled ? {} : {cursor:"pointer"}}
          >{isSelected ? "✓" : ""}</div>
        )}
        <div className="inf" onClick={() => { if (item.balde === "bloqueadas" && item.documento_id) void devolverYCorregir(item); else if (item.balde !== "listas") goToCheck(item); else if (!enCartola && !isDisabled) toggleItem(item.id); }}
          style={((item.balde !== "listas" && item.documento_id) || (item.balde === "listas" && !enCartola && !isDisabled)) ? { cursor: "pointer" } : undefined}>
          <div className="tt">{item.receptor_nombre || item.descripcion || "Sin nombre"}</div>
          <div className="sub">
            {item.receptor_rut ?? "Sin RUT"} · {formatShortDateEsCl(item.fecha, true)}
          </div>
          {/* EL DETALLE SE VE — SOLO MESA FACTURAS (2026-08-27): sin esto, tres
              facturas al mismo receptor por el mismo monto son indistinguibles
              en la lista. Es LO QUE dice el documento, el dato que guía al
              cliente. Boletas NO se toca: su lista ya funciona y ahí el título
              suele SER la glosa de la cartola. */}
          {esFacturas && (() => {
            const glosa = (item.detalle ?? "").trim() || (item.descripcion ?? "").trim();
            const titulo = item.receptor_nombre || item.descripcion || "";
            if (!glosa || glosa === titulo) return null;
            return <div className="sub" style={{ color: "var(--text)", opacity: .78 }} title={glosa}>{glosa}</div>;
          })()}
          {/* Advertencias sin veto (el humano manda, la app solo dice "ojo"):
              triángulo ámbar con el aviso — la fila sigue seleccionable. */}
          {item.listo_emitir && (item.advertencias?.length ?? 0) > 0 && (
            <div className="sub" style={{ color: "var(--amber, #f59e0b)", display: "flex", alignItems: "flex-start", gap: 5 }} title={item.advertencias!.map((a) => a.msg).join("\n")}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>{item.advertencias![0].msg}{item.advertencias!.length > 1 ? ` (+${item.advertencias!.length - 1})` : ""}</span>
            </div>
          )}
          {item.motivo_no_listo && (
            <div className="sub rn">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {" "}{item.motivo_no_listo}
              {nextActionLabel(item.motivo_code) && <><br />{nextActionLabel(item.motivo_code)}</>}
            </div>
          )}
          {item.balde === "bloqueadas" && item.documento_id ? (
            <button onClick={(e) => { e.stopPropagation(); void devolverYCorregir(item); }}
              disabled={devolviendo === item.documento_id}
              style={{ fontSize: 10, fontWeight: 700, color: "#E8553E", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 2, textAlign: "left", display: "block" }}>
              ← Devolver la cartola y corregir
            </button>
          ) : item.balde !== "listas" && item.documento_id ? (
            <div className="sub" style={{ color: "#E8553E", fontWeight: 600, marginTop: 2 }}>Resolver en Check →</div>
          ) : null}
          {item.balde === "listas" && item.documento_id && (
            <button onClick={(e) => { e.stopPropagation(); goToCheck(item); }} title="Corregir el tipo en Check"
              style={{ fontSize: 10, fontWeight: 500, color: "var(--text2)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 2, textAlign: "left", display: "block" }}>Corregir en Check →</button>
          )}
          {/* FORMA DE PAGO POR FACTURA — SOLO MESA FACTURAS. Un lote real mezcla
              contado y crédito; una sola elección global obligaba a partir el
              lote en dos. Sin default: la elección es expresa. */}
          {esFacturas && item.balde === "listas" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }} onClick={(e) => e.stopPropagation()}>
              {(["contado", "credito"] as const).map((fp) => {
                const activo = formaPagoItems[item.id] === fp;
                return (
                  <button key={fp} type="button" onClick={(e) => { e.stopPropagation(); setFormaPagoDe([item.id], fp); }}
                    title={fp === "contado" ? "La prestación ya está pagada" : "Por pagar"}
                    style={{ padding: "2px 9px", borderRadius: 7, fontSize: 9.5, fontWeight: 800, cursor: "pointer", font: "inherit", lineHeight: 1.7,
                      border: activo ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
                      background: activo ? "rgba(201,242,75,.1)" : "transparent",
                      color: activo ? "var(--lime)" : "var(--text3)" }}>
                    {fp === "contado" ? "Contado" : "Crédito"}
                  </button>
                );
              })}
              {!formaPagoItems[item.id] && <span style={{ fontSize: 9, color: "var(--amber)", fontWeight: 700 }}>elige forma de pago</span>}
            </div>
          )}
        </div>
        <div className="tp" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {item.balde === "por_revisar" ? (
            <span style={{ fontSize: 9, fontWeight: 600, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", color: "var(--amber)", background: "rgba(245,158,11,.12)" }}>Falta tipo</span>
          ) : (
            <span style={{ fontSize: 9, fontWeight: 600, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", color: isAfecta ? "var(--accent)" : "var(--blue)", background: isAfecta ? "rgba(232,85,62,.13)" : "rgba(91,156,246,.13)" }}>{isAfecta ? "Afecta · con IVA" : "Exenta · sin IVA"}</span>
          )}
        </div>
        <div className="mo">{fmt(item.monto_total)}</div>
      </div>
    );
  }

  return (
    <div className="r-scroll" style={{display:"flex",flexDirection:"column"}}>
      <div className="sec" style={{flex:1}}>
        {/* Recordatorio de la extensión: el carril real (sii_local) emite vía la
            extensión local, así que si falta la avisamos acá antes de intentar emitir. */}
        {proveedorBoletas === "sii_local" && (
          <InstalarExtension
            escalera={{
              docNombre: grupos.find((g) => g.docId)?.nombre ?? null,
              listas: selectableItems.length,
              montoListo: data?.totales.monto_listo ?? null,
            }}
          />
        )}
        {/* Plan/cupo agotado: el 402 del metering aterriza acá con su copy y un
            botón real a Planes (no solo la sugerencia en texto). */}
        {planCta && (
          <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 10px", padding:"10px 13px", borderRadius:10, background:"color-mix(in srgb, var(--accent) 8%, transparent)", border:"1px solid color-mix(in srgb, var(--accent) 26%, transparent)" }}>
            <span style={{fontSize:14}}>⚡</span>
            <span style={{fontSize:11.5,color:"var(--text)",flex:1,lineHeight:1.4}}>{planCta}</span>
            <a href="/planes" style={{ flexShrink:0, fontSize:11.5, fontWeight:600, color:"#fff", background:"var(--accent)", padding:"6px 12px", borderRadius:8, textDecoration:"none" }}>
              Ver planes
            </a>
            <button aria-label="Cerrar aviso" onClick={() => setPlanCta(null)} style={{ flexShrink:0, background:"none", border:"none", color:"var(--text3)", cursor:"pointer", fontSize:13, padding:2 }}>✕</button>
          </div>
        )}
        {/* Reanudar lote a medias (se cerró la pestaña emitiendo, o el SII lo congeló).
            Re-hidrata contra los pendientes del server a nivel EMPRESA (endpoint sin
            filtro de período): así reanudar no depende de qué mes muestre el calendario.
            Lo ya emitido / en revisión salió de "pendientes" → no vuelve al lote; y solo
            se descarta el rastro cuando el server confirma que ya no queda nada. */}
        {lotePendiente && !loteOpen && (
          <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 10px", padding:"10px 13px", borderRadius:10, background:"color-mix(in srgb, var(--amber) 9%, transparent)", border:"1px solid color-mix(in srgb, var(--amber) 28%, transparent)" }}>
            <span style={{fontSize:14}}>⏸</span>
            <span style={{fontSize:11.5,color:"var(--text)",flex:1,lineHeight:1.4}}>
              Quedó un lote a medias: faltan <b>{lotePendiente.remainingIds.length} de {lotePendiente.total}</b>. Retoma desde donde quedó.
            </span>
            <button disabled={resumiendo} onClick={async () => {
              setResumiendo(true);
              try {
                const res = await fetch(`/api/intermediaria/pendientes-emision?mesa=${mesa}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json?.ok || !Array.isArray(json.items)) {
                  toast("No pude cargar el lote para reanudar. Reintenta en un momento.", "error");
                  return; // NO limpiar: el rastro sigue para reintentar
                }
                const byId = new Map((json.items as Array<LoteItemInput & { listo_emitir?: boolean }>).map((i) => [i.id, i] as const));
                // Presentes = siguen pendientes en el server. Emitibles = además `listo_emitir`
                // (nunca reanudar una que se volvió "por revisar": emitiría con tipo por defecto).
                const presentes = lotePendiente.remainingIds.map((id) => byId.get(id)).filter(Boolean) as Array<LoteItemInput & { listo_emitir?: boolean }>;
                const resume = presentes.filter((i) => i.listo_emitir !== false) as LoteItemInput[];
                if (presentes.length === 0) {
                  // El server (empresa-wide) confirma que ninguno sigue pendiente → ya
                  // emitidas o en revisión. Ahora sí es seguro descartar el rastro.
                  limpiarLotePendiente(empresaId ?? "", esFacturas ? "factura" : "boleta"); setLotePendiente(null);
                  toast("Ese lote ya quedó emitido, no queda nada por reanudar.", "success");
                  return;
                }
                if (resume.length === 0) {
                  // Siguen pendientes pero ninguna está lista (volvieron a "por revisar").
                  // No las emitimos a ciegas; el usuario las resuelve en Check. Quedan en la cola.
                  limpiarLotePendiente(empresaId ?? "", esFacturas ? "factura" : "boleta"); setLotePendiente(null);
                  toast("El resto del lote quedó en “por revisar”. Resuélvelo en Check y emítelo de nuevo.", "error");
                  return;
                }
                setLoteResume(resume); setLoteResumeTotal(lotePendiente.total); setLoteOpen(true);
              } catch {
                toast("No pude cargar el lote para reanudar. Reintenta en un momento.", "error");
              } finally {
                setResumiendo(false);
              }
            }}
              style={{fontSize:11,fontWeight:700,color:"#fff",background:"var(--accent)",border:"none",borderRadius:8,padding:"7px 13px",cursor:resumiendo?"default":"pointer",opacity:resumiendo?0.6:1}}>{resumiendo ? "Cargando…" : `Reanudar ${lotePendiente.remainingIds.length} →`}</button>
            <button onClick={() => { limpiarLotePendiente(empresaId ?? "", esFacturas ? "factura" : "boleta"); setLotePendiente(null); }}
              style={{fontSize:10,fontWeight:600,color:"var(--text3)",background:"transparent",border:"none",cursor:"pointer"}}>Descartar</button>
          </div>
        )}
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
          <button className={`pl ${typeFilter === "mixta" ? "act" : "ina"}`} title="Cartolas que traen afectas Y exentas juntas" onClick={() => setTypeFilter("mixta")}>Mixta</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {selectableItems.length > 0 && (
              <label className="sc" style={{ marginLeft: 0 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{accentColor:"#E8553E"}} />
                {" "}Seleccionar todas ({selectableItems.length})
              </label>
            )}
            {grupos.length > 1 && (
              <button type="button"
                onClick={() => setExpandedDocs(prev => prev.size >= grupos.length ? new Set() : new Set(grupos.map(g => g.docId ?? "__sueltas__")))}
                style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 9px", cursor: "pointer", flexShrink: 0 }}>
                {expandedDocs.size >= grupos.length ? "Colapsar todo" : "Expandir todo"}
              </button>
            )}
          </div>
        </div>

        {/* Items — agrupados por DOCUMENTO (file-first): ves el archivo, expandís al detalle. */}
        {itemsList.length === 0 ? (
          <EmitirEmpty />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {grupos.map((g) => {
              const key = g.docId ?? "__sueltas__";
              const isOpen = expandedDocs.has(key);
              const rev = porRevisarByDoc.get(key)?.length ?? 0;
              const listas = g.items.filter(i => i.balde === "listas").length;
              const monto = g.items.reduce((s, i) => s + i.monto_total, 0);
              const universoDoc = g.docId ? (data?.items ?? []).filter((i) => i.documento_id === g.docId) : g.items;
              const emitibles = universoDoc.filter(i => i.listo_emitir);
              const docSel = emitibles.length > 0 && emitibles.every(i => selected.has(i.id));
              return (
                <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-muted)", overflow: "hidden" }}>
                  <div onClick={() => toggleDoc(key)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", cursor: "pointer" }}>
                    <span style={{ color: "var(--text3)", display: "flex", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .18s" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="9 6 15 12 9 18"/></svg>
                    </span>
                    {emitibles.length > 0 && (
                      <div role="checkbox" aria-checked={docSel} aria-label={`Seleccionar la cartola completa (${emitibles.length} boletas)`}
                        title={`Selecciona la cartola COMPLETA: sus ${emitibles.length} boletas por emitir. Acá no se emite a pedazos — si algo no te cuadra, devuélvela a Check.`}
                        onClick={(e) => { e.stopPropagation(); toggleDocSelect(g.items); }}
                        style={{ width: 19, height: 19, borderRadius: 6, border: docSel ? "1.5px solid var(--accent)" : "1.5px solid var(--text2)", background: docSel ? "var(--accent)" : "var(--surface2)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, cursor: "pointer", flexShrink: 0, transition: "all .15s" }}>{docSel ? "✓" : ""}</div>
                    )}
                    <span style={{ color: "var(--text2)", display: "flex", flexShrink: 0 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</div>
                      <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 1, display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{listas} por emitir</span>
                        {g.docId && (juzgadasByDoc[g.docId]?.emitidas.length ?? 0) > 0 && (
                          <span style={{ color: "var(--green)", fontWeight: 700 }}>· {juzgadasByDoc[g.docId]!.emitidas.length} ya en el SII</span>
                        )}
                        {rev > 0 && (
                          <button onClick={(e) => { e.stopPropagation(); setPopupDoc(key); }}
                            style={{ color: "var(--amber)", fontWeight: 600, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 10 }}>· {rev} por revisar →</button>
                        )}
                      </div>
                    </div>
                    {/* Atajo del grupo: aplica la forma de pago a todas las
                        facturas listas del archivo de una sola vez. */}
                    {esFacturas && listas > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        {(["contado", "credito"] as const).map((fp) => {
                          const ids = g.items.filter((i) => i.balde === "listas").map((i) => i.id);
                          const todas = ids.length > 0 && ids.every((id) => formaPagoItems[id] === fp);
                          return (
                            <button key={fp} type="button" onClick={(e) => { e.stopPropagation(); setFormaPagoDe(ids, fp); }}
                              title={`Marcar las ${ids.length} como ${fp === "contado" ? "Contado" : "Crédito"}`}
                              style={{ padding: "3px 9px", borderRadius: 7, fontSize: 9.5, fontWeight: 800, cursor: "pointer", font: "inherit",
                                border: todas ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
                                background: todas ? "rgba(201,242,75,.1)" : "transparent",
                                color: todas ? "var(--lime)" : "var(--text3)" }}>
                              {fp === "contado" ? "Contado" : "Crédito"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {/* Devolver la cartola COMPLETA a Check (pedido fundador 2026-09-01):
                        'aprobado' → 'listo'. Deshacer el Aprobar sin perder el juicio. */}
                    {g.docId && listas > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); void handleDevolverCartola(g.docId!, g.nombre); }}
                        disabled={devolviendo === g.docId}
                        title="Devuelve la cartola completa a Check de agregados: las boletas quedan listas de nuevo (no pierdes el juicio), y apruebas cuando quieras."
                        style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "var(--text2)", background: "transparent", border: "1px solid var(--border)", borderRadius: 99, padding: "4px 11px", cursor: devolviendo === g.docId ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                        ← {devolviendo === g.docId ? "Devolviendo…" : "Devolver a Check"}
                      </button>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right", flexShrink: 0 }}>{fmt(monto)}</div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "2px 8px 8px", borderTop: "1px solid var(--border)" }}>
                      {g.items.map(renderItem)}
                      {/* La última mirada: lo que NO va a boleta (juzgado en Check),
                          tachado y colapsado. La cartola llega entera a Emitir. */}
                      {g.docId && (juzgadasByDoc[g.docId]?.emitidas.length ?? 0) > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "6px 3px 0", padding: "0 2px" }}>
                          {juzgadasByDoc[g.docId]!.emitidas.map((it) => (
                            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text3)", padding: "3px 0" }}>
                              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: "var(--green)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>✓ ya en el SII{it.folio != null ? ` · folio ${it.folio}` : ""}</span>
                              <span style={{ flex: 1, minWidth: 0, textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.descripcion}>{it.descripcion}</span>
                              <span style={{ flexShrink: 0, textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmt(it.monto)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {g.docId && (() => {
                        const j = juzgadasByDoc[g.docId];
                        if (!j || (j.loading && j.juzgadas.length === 0)) return null;
                        if (j.juzgadas.length === 0) return null;
                        const jOpen = juzgadasOpen.has(g.docId);
                        return (
                          <div style={{ margin: "6px 3px 2px" }}>
                            <button onClick={() => setJuzgadasOpen((prev) => { const n = new Set(prev); if (n.has(g.docId!)) n.delete(g.docId!); else n.add(g.docId!); return n; })}
                              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", padding: "4px 2px", fontSize: 10.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                              <span style={{ display: "flex", transform: jOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="9 6 15 12 9 18"/></svg>
                              </span>
                              Sin boleta (juzgadas) · {j.juzgadas.length}
                            </button>
                            {jOpen && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 0 4px 18px" }}>
                                {j.juzgadas.map((it) => (
                                  <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text3)", padding: "3px 0" }}>
                                    <span style={{ flex: 1, minWidth: 0, textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.descripcion}>{it.descripcion}</span>
                                    {it.fecha && <span style={{ flexShrink: 0, fontSize: 10 }}>{formatShortDateEsCl(it.fecha, true)}</span>}
                                    <span style={{ flexShrink: 0, textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmt(it.monto)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
            <button className="emit" onClick={() => {
              // Con el paso 3 de la escalera pendiente (sin extensión o sin
              // bóveda), Emitir no abre un modal que va a rebotar con error:
              // lleva al paso y lo destaca (el muro se volvió escalera).
              const esc = document.getElementById("escalera-emision");
              if (esc && esc.dataset.listo === "0") {
                esc.scrollIntoView({ behavior: "smooth", block: "center" });
                esc.style.borderColor = "var(--accent)";
                esc.style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)";
                window.setTimeout(() => { esc.style.borderColor = ""; esc.style.boxShadow = ""; }, 1600);
                return;
              }
              if (proveedorReal && !esFacturas) setLoteOpen(true); else setConfirmOpen(true);
            }} disabled={emitiendo || selectedCount === 0 || lockedByOther}>
              {emitiendo ? (
                <span className="sp" style={{display:"inline-block"}} />
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {" "}{lockedByOther ? "Emisión en curso" : emitiendo ? "Emitiendo..." : selectedCount === 0 ? `Selecciona ${esFacturas ? "facturas" : "boletas"}` : `Emitir ${selectedCount}`}
            </button>
          </div>
        </div>
      )}

      {/* Popup "por revisar" de un documento: las que la IA no dio por listas. */}
      {popupDoc && (() => {
        const revItems = porRevisarByDoc.get(popupDoc) ?? [];
        const nombre = grupos.find(g => (g.docId ?? "__sueltas__") === popupDoc)?.nombre
          ?? revItems[0]?.receptor_nombre ?? "Documento";
        // Portal a document.body + z-index alto: sin esto el popup se ancla al panel
        // (ancestro transformado) y la card de plan / paneles del escritorio se le
        // colaban encima. Mismo patrón que EmitirLoteModal / EditorAmpliado.
        return createPortal(
          <div onClick={() => setPopupDoc(null)} style={{ position: "fixed", inset: 0, zIndex: 215, display: "grid", placeItems: "center", padding: 20, background: "rgba(6,7,10,.62)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px,96vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Por revisar</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 1 }}>{nombre} · la IA no está segura de {revItems.length}</div>
                </div>
                <button onClick={() => setPopupDoc(null)} style={{ width: 26, height: 26, border: "none", background: "var(--bg-muted)", color: "var(--text2)", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
              <div style={{ overflowY: "auto", padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8, alignContent: "start" }}>
                {revItems.map((it) => (
                  <div key={it.id} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-muted)", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.receptor_nombre || it.descripcion || "Sin nombre"}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(it.monto_total)}</div>
                    </div>
                    {it.motivo_no_listo && <div style={{ fontSize: 9, color: "var(--amber)", marginTop: 5, lineHeight: 1.4 }}>⚠ {it.motivo_no_listo}</div>}
                    {it.documento_id && (
                      <button onClick={() => { if (it.balde === "bloqueadas" && it.documento_id) { void devolverYCorregir(it); } else { goToCheck(it); } setPopupDoc(null); }}
                        style={{ marginTop: "auto", alignSelf: "flex-start", fontSize: 10, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 7, padding: "6px 11px", cursor: "pointer", paddingTop: 6 }}>{it.balde === "bloqueadas" && it.documento_id ? "← Devolver la cartola y corregir" : "Resolver en Check →"}</button>
                    )}
                  </div>
                ))}
                {revItems.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "24px 0", color: "#5fd98a", fontSize: 12 }}>✓ Nada por revisar en esta cartola.</div>}
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* Carril REAL (SII local): el motor masivo sale encima de la pestaña. */}
      {loteOpen && (
        <EmitirLoteModal
          items={loteResume ?? selectedItems}
          empresaId={empresaId ?? ""}
          empresaRut={null}
          totalOriginal={loteResume ? (loteResumeTotal ?? loteResume.length) : selectedItems.length}
          mesa={esFacturas ? "factura" : "boleta"}
          formaPagoPorItem={esFacturas ? formaPagoItems : null}
          onClose={() => { setLoteOpen(false); setLoteResume(null); setLoteResumeTotal(null); setLotePendiente(leerLotePendiente(empresaId ?? "", esFacturas ? "factura" : "boleta")); }}
          onDone={() => { setSelected(new Set()); setLoteResume(null); setLoteResumeTotal(null); reload(); setLotePendiente(leerLotePendiente(empresaId ?? "", esFacturas ? "factura" : "boleta")); }}
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
                      <span style={{ fontSize: 13, color: "var(--text2)" }}>{esFacturas ? (lastResult.exitos === 1 ? "factura emitida" : "facturas emitidas") : (lastResult.exitos === 1 ? "boleta emitida" : "boletas emitidas")}</span>
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
                  {proveedorReal && esFacturas ? (
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#5fd98a", background: "rgba(34,197,94,.14)", padding: "3px 8px", borderRadius: 7 }}>● SII REAL</span>
                  ) : (
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "var(--amber)", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● MODO PRUEBA</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, color: "var(--text)", letterSpacing: "-.03em" }}>{selectedCount}</span>
                  <span style={{ fontSize: 14, color: "var(--text2)" }}>{esFacturas ? (selectedCount === 1 ? "factura" : "facturas") : (selectedCount === 1 ? "boleta" : "boletas")}</span>
                </div>
                <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
                  {selAfecta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "rgba(232,85,62,.13)", padding: "4px 10px", borderRadius: 8 }}>{selAfecta} con IVA</span>}
                  {selExenta > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", background: "rgba(91,156,246,.13)", padding: "4px 10px", borderRadius: 8 }}>{selExenta} sin IVA</span>}
                </div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 12, color: "var(--text2)" }}>
                  Total <b style={{ color: "var(--text)" }}>{fmt(selectedTotal)}</b>
                </div>
                {/* La forma de pago YA se eligió en la lista (por factura o por
                    grupo). Acá solo se RESUME y se bloquea si alguna quedó sin
                    elegir — el modal confirma, no interroga. */}
                {esFacturas && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", marginBottom: 6 }}>Forma de pago</div>
                    {selSinFormaPago.length > 0 ? (
                      <div style={{ fontSize: 11.5, color: "var(--amber)", lineHeight: 1.5, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.28)", borderRadius: 9, padding: "8px 10px" }}>
                        {selSinFormaPago.length === 1 ? "Falta elegir la forma de pago de 1 factura" : `Faltan ${selSinFormaPago.length} facturas por elegir forma de pago`}. Márcalas en la lista (por factura o con el atajo del archivo).
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        {selContado > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--lime)", background: "rgba(201,242,75,.12)", padding: "4px 10px", borderRadius: 8 }}>{selContado} contado</span>}
                        {selCredito > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", background: "var(--bg-muted)", padding: "4px 10px", borderRadius: 8 }}>{selCredito} crédito</span>}
                      </div>
                    )}
                  </div>
                )}
                {posiblesRepetidas > 0 && (
                  <div style={{ marginTop: 12, padding: "9px 11px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 9, fontSize: 11.5, color: "var(--amber)", lineHeight: 1.5 }}>
                    <b>Ojo: {posiblesRepetidas} podrían estar repetidas</b> — mismo receptor, mismo monto y misma fecha. Si vienen de intentos fallidos, saldrían {esFacturas ? "varias facturas" : "varias boletas"} por una sola venta. Revisa antes de seguir.
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>
                  {esFacturas
                    ? (proveedorReal
                        ? "Emisión REAL en el SII con tus claves. Una factura emitida no se puede deshacer."
                        : "Modo de prueba: se simula, no se informa al SII. Una factura real no se puede deshacer.")
                    : "Modo de prueba: se simula, no se informa al SII. Una boleta real no se puede deshacer. Si algo sale mal, escríbenos a soporte."}
                </div>
                <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5 }}>
                  {esFacturas ? "La factura" : "La boleta"} documenta el ingreso; el impuesto a la renta se declara aparte (F22) sobre la ganancia, no sobre el total.
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button onClick={() => setConfirmOpen(false)}
                    style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                  <button onClick={handleEmitir} disabled={esFacturas && selSinFormaPago.length > 0}
                    style={{ flex: 1, border: 0, borderRadius: 10, padding: "11px 14px", background: esFacturas && selSinFormaPago.length > 0 ? "var(--bg-muted)" : "#E8553E", color: esFacturas && selSinFormaPago.length > 0 ? "var(--text3)" : "#fff", fontSize: 13, fontWeight: 800, cursor: esFacturas && selSinFormaPago.length > 0 ? "not-allowed" : "pointer" }}>Emitir {selectedCount} →</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
