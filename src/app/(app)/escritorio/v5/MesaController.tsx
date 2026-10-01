"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import RightColumnView from "./RightColumnView";
import Mesa, { type MesaProps } from "./Mesa";
import GuardarailOrbe from "./GuardarailOrbe";
import CalendarStrip, { type NavParams } from "./CalendarStrip";
import type { CargarMesaResult, TeamEstado } from "./actions";
import { MesaReloadContext, pendingOpenDoc } from "./mesa-reload";
import { pendingResaltar, type ApuntableTipo } from "./apuntar";
import type { MesaDateDependent } from "./mesa-data";
import type { SearchItem } from "@/lib/tree-structure";
import { supabase } from "@/lib/supabase";
import { publicarAvisos } from "@/lib/avisos/bus";
import { cadenciaDocs, cargandoTras, cargarSiSigueVigente, crearEspaciador, mismaMesa, crearRecargador, INTERVALO_LOTE_MS, INTERVALO_NORMAL_MS, TIMEOUT_CARGA_MS, type Espaciador, type Recargador } from "./mesa-frescura";

// La MESA es parte de la clave (bug transversal 2026-08-27): sin ella, boletas y
// facturas del mismo día/rango compartían entrada de caché y una le servía a la
// otra datos ajenos — la mesa "se vaciaba" o mostraba lo que no era.
const keyOf = (view: string, date: string, month: string, mesa: "boleta" | "factura") => `${view}|${date}|${month}|${mesa}`;
const keyDeMesa = (m: MesaDateDependent) => keyOf(m.workMode, m.selDate, `${m.calendar.y}-${m.calendar.m}`, m.mesaActiva);

// Avisa a los slots estáticos (card de Registros) los nuevos números del rango,
// para que Ventas/Actividad sigan al calendario maestro.
// Carga por HTTP (/api/mesa) y NO por server action: las actions de un mismo
// cliente corren EN FILA, así que el precalentador y los refresh realtime
// dejaban Aprobar/Rechazar esperando detrás de cargas pesadas ("mesa gris
// tildada", bug fundador 2026-09-02). Por HTTP corren en paralelo.
async function cargarMesa(params: { date?: string; month?: string; view?: string; mesa?: string }): Promise<CargarMesaResult> {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    // Con tope: el recargador tiene UNA carga en vuelo; un fetch colgado para siempre
    // (socket muerto tras suspender el notebook) congelaría la mesa hasta F5.
    const r = await fetch(`/api/mesa?${qs.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_CARGA_MS) });
    const res = (await r.json()) as CargarMesaResult;
    // Avisos y novedades: viajan gratis en esta misma respuesta (cero sondeo).
    if (res.ok) publicarAvisos(res.avisos);
    return res;
  } catch {
    return { ok: false, error: "FETCH_FAILED" };
  }
}

function broadcastMesa(m: MesaDateDependent) {
  window.dispatchEvent(new CustomEvent("mesa-updated", {
    detail: { ventasDocs: m.ventasDocs, ventasTotal: m.ventasTotal, actividadCount: m.actividadItems.length, actividadUltimo: m.actividadItems[0]?.descripcion ?? null, periodo: m.calendar.selectedDateLabel, calYear: m.calendar.y, calMonth: m.calendar.m },
  }));
}

/**
 * Orquesta calendario + mesa SIN navegar: al togglear día/semana/mes o elegir
 * día, pide solo los datos date-dependientes vía el server action `cargarMesa`,
 * los cachea en memoria, y swapea SOLO la mesa (no re-renderiza la página ni
 * re-consulta la columna izquierda). La columna izquierda, marca y acciones se
 * reciben como children RSC inertes — nunca se re-renderizan ni re-consultan.
 */
export default function MesaController({
  initialMesa, empresaId, empresaGiro, empresaRazon, emisorFaltan = [], empresaTipo, clientes,
  rcvContent, searchHistoryItems, empresaNombre, empresaLogoUrl,
  brandSlot, actionsSlot, leftColumn, team = null,
}: {
  /** Team Business: el globito de avisos se vuelve también el chat del team. */
  team?: TeamEstado | null;
  initialMesa: MesaDateDependent;
  empresaId: string;
  empresaGiro: string | null;
  empresaRazon: string;
  /** Campos del emisor que faltan (RUT/razón social/giro): con alguno, Emitir manda al wizard. */
  emisorFaltan?: string[];
  empresaTipo: string | null;
  clientes: MesaProps["clientes"];
  rcvContent: ReactNode;
  searchHistoryItems?: SearchItem[];
  empresaNombre?: string;
  empresaLogoUrl?: string | null;
  brandSlot: ReactNode;
  actionsSlot: ReactNode;
  leftColumn: ReactNode;
}) {
  const [mesa, setMesa] = useState(initialMesa);
  const [, startTransition] = useTransition();
  // Rango cuya carga ATENÚA la mesa: solo el último pedido (ver cargandoTras).
  const [cargandoKey, setCargandoKey] = useState<string | null>(null);
  // Cache en memoria sembrada con el estado inicial (evita re-fetch al volver a él).
  // `vieja` (2026-09-28): tras una recarga los OTROS rangos se marcan viejos en vez de
  // borrarse — antes se vaciaba todo y la precarga volvía a pedir las otras dos vistas
  // tras CADA recarga (3 × /api/mesa por boleta emitida). Una entrada vieja se muestra
  // al navegar y se refresca por detrás (nunca se sirve como buena).
  const cacheRef = useRef<Map<string, { mesa: MesaDateDependent; vieja: boolean }>>(
    new Map([[keyOf(initialMesa.workMode, initialMesa.selDate, `${initialMesa.calendar.y}-${initialMesa.calendar.m}`, initialMesa.mesaActiva), { mesa: initialMesa, vieja: false }]]),
  );
  // Mesa vigente para lecturas fuera del render (recargador, poll): nunca un closure viejo.
  const mesaRef = useRef(mesa);
  useEffect(() => { mesaRef.current = mesa; }, [mesa]);
  // Toda mesa que entra pasa por acá: el ref queda al día ANTES del próximo pedido
  // (el efecto de arriba corre después del render; un pedido agendado entre medio
  // leería el rango anterior y descartaría la respuesta buena).
  const aplicarMesa = useCallback((m: MesaDateDependent) => {
    mesaRef.current = m;
    setMesa(m);
    broadcastMesa(m);
  }, []);

  // Recarga el rango ACTUAL sin navegar (tras aprobar/rechazar/mapear). A
  // diferencia de navigate, ignora la cache (los datos cambiaron): marca VIEJOS los
  // otros rangos visitados (aprobar/emitir también altera sus contadores) y re-siembra
  // el actual. SIEMPRE silencioso (bug fundador 2026-09-02): se sigue mostrando lo que
  // hay y se swapea al llegar.
  // UNA sola carga en vuelo (2026-09-28): los pedidos que llegan mientras carga se
  // juntan en UNA repetición con el rango vigente; si el usuario navegó entre medio,
  // la respuesta del rango viejo se descarta (antes pisaba la mesa nueva).
  type ParamsMesa = { date: string; month: string; view: string; mesa: "boleta" | "factura" };
  // Se crea perezoso DENTRO de un callback (nunca en render: refs fuera del render).
  const recargadorRef = useRef<Recargador | null>(null);
  const recargador = useCallback((): Recargador => {
    if (recargadorRef.current) return recargadorRef.current;
    recargadorRef.current = crearRecargador<ParamsMesa, MesaDateDependent>({
    params: () => {
      const m = mesaRef.current;
      return { date: m.selDate, month: `${m.calendar.y}-${m.calendar.m}`, view: m.workMode, mesa: m.mesaActiva };
    },
    clave: (p) => keyOf(p.view, p.date, p.month, p.mesa),
    cargar: async (p) => {
      const res = await cargarMesa(p);
      return res.ok ? res.mesa : null;
    },
    aplicar: (p, fresca) => {
      const k = keyOf(p.view, p.date, p.month, p.mesa);
      // Los OTROS rangos se envejecen SIEMPRE: el evento que gatilló la recarga pudo
      // cambiar un rango que no es el visible (emisión de otro día) aunque el visible
      // salga idéntico. Frescura antes que ahorrar llamadas (coordinación 2026-10-01).
      for (const v of cacheRef.current.values()) v.vieja = true;
      // Visible idéntico (típico de la vigilancia post-subida y los sondeos): no se
      // re-renderiza ni se re-difunde — solo se re-siembra su entrada como fresca.
      if (keyDeMesa(mesaRef.current) === k && mismaMesa(mesaRef.current, fresca)) {
        cacheRef.current.set(k, { mesa: mesaRef.current, vieja: false });
        return;
      }
      cacheRef.current.set(k, { mesa: fresca, vieja: false });
      aplicarMesa(fresca);
    },
    });
    return recargadorRef.current;
  }, [aplicarMesa]);
  // Estable: el contexto no cambia de identidad con cada `mesa` (menos re-renders y
  // los canales/efectos que dependen de él no se re-suscriben).
  const reloadMesa = useCallback((opts?: { silent?: boolean }) => {
    void opts;
    recargador().pedir();
  }, [recargador]);


  // Último rango PEDIDO por el calendario (bug fundador 2026-10-01): una respuesta
  // lenta de un rango anterior ya no pisa el que el usuario eligió después.
  const ultimoPedidoRef = useRef<string | null>(null);

  const navigate = useCallback((patch: NavParams) => {
    const params = {
      date: patch.date ?? mesa.selDate,
      month: patch.month ?? `${mesa.calendar.y}-${mesa.calendar.m}`,
      view: patch.view ?? mesa.workMode,
      // La mesa activa (boleta|factura) sobrevive a toda navegación del
      // calendario: perderla devolvería al usuario a boletas en silencio.
      mesa: mesa.mesaActiva,
    };
    // URL sigue siendo la verdad (para refresh/compartir) — sin navegar.
    window.history.replaceState(null, "", `/massdte?date=${params.date}&month=${params.month}&view=${params.view}&mesa=${params.mesa}`);
    const key = keyOf(params.view, params.date, params.month, params.mesa);
    ultimoPedidoRef.current = key;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setCargandoKey(null); // el último pedido ya está servido: nada que atenuar
      aplicarMesa(cached.mesa);
      // Vieja: se muestra al tiro y se trae la fresca por detrás (el recargador
      // descarta la respuesta si el usuario siguió navegando).
      if (cached.vieja) window.setTimeout(() => recargador().pedir(), 0);
      return;
    }
    setCargandoKey(key);
    startTransition(async () => {
      // La respuesta siempre siembra la caché, pero solo se APLICA si este sigue
      // siendo el último rango pedido (clic en 5 → clic en 6: la de 5 llega tarde).
      try {
        await cargarSiSigueVigente({
          vigente: () => ultimoPedidoRef.current ?? "",
          cargar: async () => { const res = await cargarMesa(params); return res.ok ? res.mesa : null; },
          guardar: (fresca) => cacheRef.current.set(key, { mesa: fresca, vieja: false }),
          aplicar: aplicarMesa,
        });
      } finally {
        setCargandoKey((c) => cargandoTras(c, key));
      }
    });
  }, [mesa, recargador, aplicarMesa]);

  // "Shader cache" del calendario (misma filosofía que el conmutador de mesa):
  // los otros dos modos (día/semana/mes) del rango actual se precargan en idle
  // a la cache — el toggle pasa de esperar el server action (segundos con
  // cartolas grandes en el rango) al cache hit (~50ms medidos). Deduplicado por
  // key; reloadMesa vacía la cache tras mutar y este effect re-tibia solo.
  // Solo al CAMBIAR de rango (no tras cada recarga silenciosa del mismo rango: eso
  // eran 2 × /api/mesa extra por boleta emitida) y solo con la pestaña visible.
  const prefetchTimer = useRef<number | null>(null);
  const rangoActual = keyOf(mesa.workMode, mesa.selDate, `${mesa.calendar.y}-${mesa.calendar.m}`, mesa.mesaActiva);
  useEffect(() => {
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      if (document.hidden) return;
      const m = mesaRef.current;
      const month = `${m.calendar.y}-${m.calendar.m}`;
      (["day", "week", "month"] as const).forEach((view) => {
        if (view === m.workMode) return;
        const key = keyOf(view, m.selDate, month, m.mesaActiva);
        if (cacheRef.current.has(key)) return;
        void cargarMesa({ date: m.selDate, month, view, mesa: m.mesaActiva }).then((res) => {
          if (res.ok && !cacheRef.current.has(key)) cacheRef.current.set(key, { mesa: res.mesa, vieja: false });
        }).catch(() => { /* precarga best-effort: si falla, el toggle paga el fetch normal */ });
      });
    }, 1500);
    return () => { if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current); };
  }, [rangoActual]);

  // Desde Emitir: abrir una tx en Check. Deja el doc pendiente, cambia a la
  // pestaña Check y, si la tx es de otro mes, navega el calendario para que
  // aparezca en la mesa (MesaTab la selecciona al verla).
  useEffect(() => {
    const onOpenDoc = (e: Event) => {
      const detail = (e as CustomEvent).detail as { documentoId?: string; month?: string } | undefined;
      if (detail?.documentoId) pendingOpenDoc.id = detail.documentoId;
      window.dispatchEvent(new CustomEvent("switch-tab", { detail: "subidos" }));
      const cur = `${mesa.calendar.y}-${mesa.calendar.m}`;
      // Cazado en la prueba real del chat (2026-09-06): el doc era del MISMO
      // mes pero de otro día, y la mesa estaba en vista día → nunca aparecía y
      // el salto quedaba mudo. Si el doc no está en la mesa actual, se navega
      // al mes completo (del doc, o el actual) para que entre.
      const enMesa = Boolean(detail?.documentoId && (mesa.docsAgregados as Array<{ id: string }>).some((d) => d.id === detail.documentoId));
      if (detail?.month && detail.month !== cur) navigate({ view: "month", month: detail.month });
      else if (!enMesa) navigate({ view: "month", month: detail?.month ?? cur });
      // Caso mismo-mes: el doc ya está en la mesa; empuja a MesaTab a abrirlo
      // (el caso de otro mes llega por "mesa-updated" tras cargar el calendario).
      window.setTimeout(() => window.dispatchEvent(new Event("massdte:try-open")), 80);
    };
    window.addEventListener("massdte:open-doc", onOpenDoc);
    // Salto del chat a una tx/boleta: navegar al mes (si hace falta), ir a
    // la pestaña y dejar el resaltado pendiente para cuando la fila exista.
    const onIrA = (e: Event) => {
      const d = (e as CustomEvent).detail as { tipo?: ApuntableTipo; id?: string; docId?: string | null; month?: string } | undefined;
      if (!d?.tipo || !d.id) return;
      pendingResaltar.ref = { tipo: d.tipo, id: d.id, docId: d.docId ?? null };
      window.dispatchEvent(new CustomEvent("switch-tab", { detail: d.tipo === "boleta" ? "boletas" : "emitir" }));
      // Vista MES del mes del objeto: garantiza que la fila esté en la mesa.
      const cur = `${mesa.calendar.y}-${mesa.calendar.m}`;
      navigate({ view: "month", month: d.month ?? cur });
      window.setTimeout(() => window.dispatchEvent(new Event("massdte:resaltar")), 120);
    };
    window.addEventListener("massdte:ir-a", onIrA);
    // SALTO del chat del team que cruzó de empresa: el cambio de empresa
    // remonta todo (router.refresh), así que el destino viaja por
    // sessionStorage y se consume acá, una sola vez, al montar.
    try {
      const raw = sessionStorage.getItem("massdte:salto");
      if (raw) {
        sessionStorage.removeItem("massdte:salto");
        const salto = JSON.parse(raw) as { documentoId?: string; month?: string; tipo?: ApuntableTipo; id?: string; docId?: string | null };
        if (salto.tipo && salto.tipo !== "documento" && salto.id) window.setTimeout(() => window.dispatchEvent(new CustomEvent("massdte:ir-a", { detail: salto })), 120);
        else if (salto.documentoId) window.setTimeout(() => window.dispatchEvent(new CustomEvent("massdte:open-doc", { detail: salto })), 120);
      }
    } catch { /* sin salto pendiente */ }
    return () => { window.removeEventListener("massdte:open-doc", onOpenDoc); window.removeEventListener("massdte:ir-a", onIrA); };
  }, [navigate, mesa]);

  // Tras subir algo (el uploader vive FUERA del provider → llega por evento): ir a
  // ese día (vista día) con datos FRESCOS. Se invalida la cache del rango porque los
  // datos recién entraron. Esto reemplaza el router.refresh() del uploader, que no
  // actualizaba la mesa (el estado no se re-siembra de initialMesa sin remount/F5).
  useEffect(() => {
    const recargarDia = (date: string) => {
      const [yy, mm] = date.split("-");
      const month = `${yy}-${Number(mm) - 1}`; // calendar.m es 0-indexed
      // La MESA ACTIVA viaja en el refresco (bug 2026-08-27): sin ella cargaba
      // la mesa por defecto (boletas) ENCIMA de la de facturas — el usuario
      // subía su plantilla y veía "Nada por aquí" con los contadores en 0,
      // creyendo que había fallado (el archivo estaba perfecto).
      const mesaActiva = mesaRef.current.mesaActiva;
      const key = keyOf("day", date, month, mesaActiva);
      cacheRef.current.delete(key); // datos nuevos → forzar re-fetch
      // SILENCIOSO (sin startTransition) → NO atenúa la mesa (era el "gris" que se
      // quedaba pegado mientras el procesamiento de fondo competía). subir-procesar
      // deja el doc en "procesando"; entra al toque y el poll de DocCardList lo lleva
      // a "procesado" sin volver a atenuar.
      // Solo se APLICA si el rango vigente sigue siendo el que había al pedir (bug
      // fundador 2026-10-01): si el usuario navegó a otra fecha mientras cargaba, no
      // se lo devuelve al día de la subida. La caché del día queda sembrada igual.
      void cargarSiSigueVigente({
        // Incluye el último rango PEDIDO (revisión adversarial B-A1): un clic a una fecha
        // aún en vuelo cuenta como navegar, aunque la mesa todavía no haya cambiado.
        vigente: () => `${keyDeMesa(mesaRef.current)}#${ultimoPedidoRef.current ?? ""}`,
        cargar: async () => { const res = await cargarMesa({ date, month, view: "day", mesa: mesaActiva }); return res.ok ? res.mesa : null; },
        guardar: (fresca) => cacheRef.current.set(key, { mesa: fresca, vieja: false }),
        aplicar: (fresca) => { ultimoPedidoRef.current = key; setCargandoKey(null); aplicarMesa(fresca); },
      });
    };

    // VIGILANCIA post-subida (bug 2026-08-31, cazado con cartola real): la
    // frescura colgaba de Realtime + del poll de DocCardList, pero ese poll
    // solo se arma si el doc YA está visible — si la recarga inicial se pierde
    // (carrera con router.push) o Realtime no entrega (falló en silencio en el
    // navegador con el server 100% sano), la mesa queda congelada hasta F5.
    // Serie de recargas silenciosas con backoff: garantiza que el doc aparezca
    // y que su término se vea aunque la IA tarde minutos y Realtime esté muerto.
    // Cada paso recarga el rango VIGENTE (recargador: descarta respuestas de un rango
    // que el usuario ya dejó) — NUNCA el día de la subida. Antes cada paso hacía
    // recargarDia(fecha) y, hasta 3,5 min después de subir, devolvía al usuario a
    // "hoy" aunque hubiera navegado a otra fecha (bug fundador 2026-10-01).
    const VIGILANCIA_MS = [4_000, 12_000, 30_000, 60_000, 100_000, 150_000, 210_000];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const vigilar = () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      for (const ms of VIGILANCIA_MS) timers.push(setTimeout(() => recargador().pedir(), ms));
    };

    const onUploaded = (e: Event) => {
      // El evento llegó a ESTE controlador: el flag del remount ya no hace falta.
      // Sin borrarlo, un remonte dentro de 120 s (F5, ActualizadorInvisible, cambio de
      // empresa/mesa) re-armaba la carga al día de la subida y toda la escalera.
      try { sessionStorage.removeItem("massdte:uploaded-at"); } catch { /* sin sessionStorage */ }
      const date = (e as CustomEvent<{ date?: string }>).detail?.date ?? mesaRef.current.selDate;
      recargarDia(date);
      vigilar();
    };
    window.addEventListener("massdte:uploaded", onUploaded);

    // Cinturón contra la carrera del remount: si el evento se disparó mientras
    // este controlador se estaba re-montando (router.push del uploader), el
    // flag en sessionStorage lo repone al montar.
    try {
      const flag = sessionStorage.getItem("massdte:uploaded-at");
      if (flag) {
        const { at, date } = JSON.parse(flag) as { at: number; date?: string };
        if (Date.now() - at < 120_000) {
          sessionStorage.removeItem("massdte:uploaded-at");
          recargarDia(date ?? mesaRef.current.selDate);
          vigilar();
        } else {
          sessionStorage.removeItem("massdte:uploaded-at");
        }
      }
    } catch { /* sessionStorage puede no estar (SSR/privacidad): el evento igual cubre */ }

    return () => {
      window.removeEventListener("massdte:uploaded", onUploaded);
      for (const t of timers) clearTimeout(t);
    };
  // Deps estables (2026-09-28): con [mesa], el primer recargarDia → setMesa → cleanup
  // cancelaba TODA la escalera de vigilancia (quedaba muerta desde el primer paso).
  }, [aplicarMesa, recargador]);

  // ── COLUMNA VERTEBRAL DE FRESCURA (patrón Linear/Figma/Notion) ───────────────
  // UNA suscripción Realtime en el contenedor SIEMPRE montado (MesaController vive
  // por encima de las pestañas), filtrada por empresa. Cualquier escritura a las
  // tablas vivas —de ESTA pestaña, de OTRA pestaña, de un compañero de equipo, o de
  // la EXTENSIÓN (que postea a /api/sii-local/result con service role)— dispara
  // reloadMesa sin importar en qué pestaña esté el usuario. Es la ÚNICA: Emitir y
  // cada DocCardList tenían la suya y cada boleta gatillaba N recargas completas.
  //
  // Espaciado (plan-costo-vercel §5 d): ráfaga → debounce 500 ms → mínimo 15 s entre
  // recargas (60 s con un lote PROPIO: la mesa queda detrás del modal); la última
  // nunca se pierde y al TERMINAR el lote se vacía al tiro. Con la pestaña oculta no
  // se recarga: se anota y se refresca al volver.
  const loteRef = useRef<{ propio: boolean; otro: boolean; boletaVista: boolean }>({ propio: false, otro: false, boletaVista: false });
  const ocultaSuciaRef = useRef(false);
  const ocultaDesdeRef = useRef<number | null>(null);
  const espaciadorRef = useRef<Espaciador | null>(null);
  const espaciador = useCallback((): Espaciador => {
    if (espaciadorRef.current) return espaciadorRef.current;
    espaciadorRef.current = crearEspaciador(
      () => recargador().pedir(),
      // 60 s solo con lote PROPIO (la mesa queda detrás del modal). Con el lote de otra
      // persona esta clienta mira la mesa directo: se queda en 15 s.
      () => (loteRef.current.propio ? INTERVALO_LOTE_MS : INTERVALO_NORMAL_MS),
    );
    return espaciadorRef.current;
  }, [recargador]);
  useEffect(() => () => espaciador().cancelar(), [espaciador]);

  // useLayoutEffect: queda escuchando ANTES de los efectos de los hijos (que avisan
  // el estado inicial del candado al montar); con useEffect ese primer aviso se perdía.
  useLayoutEffect(() => {
    // Lote en curso: lo avisa useEmisionLote (propio) y la pestaña Emitir (candado de
    // otra persona). Al terminar: recarga final inmediata + RCV completo.
    const onLote = (e: Event) => {
      const d = (e as CustomEvent<{ origen?: "propio" | "otro"; activo?: boolean }>).detail;
      if (!d?.origen) return;
      const antes = loteRef.current.propio || loteRef.current.otro;
      loteRef.current[d.origen] = Boolean(d.activo);
      const ahora = loteRef.current.propio || loteRef.current.otro;
      if (antes && !ahora) {
        espaciador().vaciar();
        if (loteRef.current.boletaVista) {
          loteRef.current.boletaVista = false;
          window.dispatchEvent(new CustomEvent("massdte:emitted", { detail: { completo: true } }));
        }
      }
    };
    window.addEventListener("massdte:lote", onLote);
    return () => window.removeEventListener("massdte:lote", onLote);
  }, [espaciador]);

  useEffect(() => {
    if (!empresaId) return;
    const bump = () => {
      if (document.hidden) { ocultaSuciaRef.current = true; return; }
      espaciador().evento();
    };
    // Boleta nueva: además de refrescar la mesa, le pasa la FILA a la isla RCV (vive
    // fuera del estado de la mesa) para que la agregue sin re-pedir el mes entero.
    const onBoleta = (payload: { new?: Record<string, unknown> }) => {
      bump();
      if (loteRef.current.propio || loteRef.current.otro) loteRef.current.boletaVista = true;
      window.dispatchEvent(new CustomEvent("massdte:emitted", { detail: { boleta: payload?.new ?? null } }));
    };
    const ch = supabase
      .channel(`v5-mesa-${empresaId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "boletas_emitidas", filter: `empresa_id=eq.${empresaId}` }, onBoleta)
      .on("postgres_changes", { event: "*", schema: "public", table: "propuestas_ia", filter: `empresa_id=eq.${empresaId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` }, bump)
      .subscribe((status) => {
        // Observabilidad (bug 2026-08-31): Realtime falló EN SILENCIO en el
        // navegador con el servidor 100% sano y nadie se enteró. Al menos que
        // quede en la consola para el próximo diagnóstico.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[massdte] canal realtime de la mesa: ${status} — la frescura queda en manos del poll/vigilancia`);
        }
      });
    return () => { espaciador().cancelar(); supabase.removeChannel(ch); };
  }, [empresaId, espaciador]);

  // ── Documentos en proceso: UN solo sondeo (antes uno de 5 s por cada DocCardList,
  // también con la pestaña oculta). Escalera 5 → 10 → 30 → 60 s SIN tope por tiempo:
  // este poll es el rescate de la cola (/api/mesa → autoDrenaje) y hay cartolas de
  // ~1000 s. Oculta → se pausa; al volver, refresco inmediato y la escalera reinicia.
  // Un doc que cambia de estado (o uno nuevo) también la reinicia.
  const docsEnProceso = (mesa.docsAgregados as Array<{ id: string; estado?: string | null }>)
    .filter((d) => d.estado === "procesando" || d.estado === "subido")
    .map((d) => d.id)
    .sort()
    .join(",");
  useEffect(() => {
    let intento = 0;
    let h: ReturnType<typeof setTimeout> | null = null;
    const agendar = () => {
      if (h) clearTimeout(h);
      h = null;
      const ms = cadenciaDocs({ oculta: document.hidden, hayProcesando: docsEnProceso !== "", intento });
      if (ms === null) return;
      h = setTimeout(() => { intento += 1; recargador().pedir(); agendar(); }, ms);
    };
    const onVisible = () => {
      if (document.hidden) { if (h) clearTimeout(h); h = null; ocultaDesdeRef.current = Date.now(); return; }
      // Volvió: lo que llegó por Realtime mientras estaba oculta, docs en proceso, o
      // estuvo oculta más de un minuto (el navegador puede haber dormido el websocket
      // y perdido eventos sin avisar).
      const largo = ocultaDesdeRef.current !== null && Date.now() - ocultaDesdeRef.current > 60_000;
      ocultaDesdeRef.current = null;
      if (ocultaSuciaRef.current || docsEnProceso !== "" || largo) {
        ocultaSuciaRef.current = false;
        recargador().pedir();
      }
      intento = 0;
      agendar();
    };
    agendar();
    document.addEventListener("visibilitychange", onVisible);
    return () => { if (h) clearTimeout(h); document.removeEventListener("visibilitychange", onVisible); };
  }, [docsEnProceso, recargador]);

  return (
    <>
      <div style={{ position: "relative", height: 38, marginBottom: 12 }}>
        {brandSlot}
        <CalendarStrip cal={mesa.calendar} navigate={navigate} />
        {actionsSlot}
      </div>
      <div className="app">
        {leftColumn}
        <RightColumnView
          actividadItems={mesa.actividadItems}
          rcvContent={rcvContent}
          searchHistoryItems={searchHistoryItems}
          empresaNombre={empresaNombre}
          empresaLogoUrl={empresaLogoUrl}
          defaultContent={
            <MesaReloadContext.Provider value={reloadMesa}>
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, opacity: cargandoKey !== null ? 0.55 : 1, transition: "opacity .18s ease" }}>
                <Mesa mesa={mesa} clientes={clientes} empresaId={empresaId} empresaGiro={empresaGiro} empresaRazon={empresaRazon} empresaTipo={empresaTipo} emisorFaltan={emisorFaltan} />
              </div>
            </MesaReloadContext.Provider>
          }
        />
      </div>
      <GuardarailOrbe guardarail={mesa.guardarail} team={team} empresaId={empresaId} mesActual={`${mesa.calendar.y}-${mesa.calendar.m}`} />
    </>
  );
}
