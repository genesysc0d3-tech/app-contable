"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import RightColumnView from "./RightColumnView";
import Mesa, { type MesaProps } from "./Mesa";
import GuardarailOrbe from "./GuardarailOrbe";
import CalendarStrip, { type NavParams } from "./CalendarStrip";
import type { CargarMesaResult } from "./actions";
import { MesaReloadContext, pendingOpenDoc } from "./mesa-reload";
import type { MesaDateDependent } from "./mesa-data";
import type { SearchItem } from "@/lib/tree-structure";
import { supabase } from "@/lib/supabase";

// La MESA es parte de la clave (bug transversal 2026-08-27): sin ella, boletas y
// facturas del mismo día/rango compartían entrada de caché y una le servía a la
// otra datos ajenos — la mesa "se vaciaba" o mostraba lo que no era.
const keyOf = (view: string, date: string, month: string, mesa: "boleta" | "factura") => `${view}|${date}|${month}|${mesa}`;

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
    const r = await fetch(`/api/mesa?${qs.toString()}`, { cache: "no-store" });
    return (await r.json()) as CargarMesaResult;
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
  initialMesa, empresaId, empresaGiro, empresaRazon, empresaTipo, clientes,
  rcvContent, searchHistoryItems, empresaNombre, empresaLogoUrl,
  brandSlot, actionsSlot, leftColumn,
}: {
  initialMesa: MesaDateDependent;
  empresaId: string;
  empresaGiro: string | null;
  empresaRazon: string;
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
  const [isPending, startTransition] = useTransition();
  // Cache en memoria sembrada con el estado inicial (evita re-fetch al volver a él).
  const cacheRef = useRef<Map<string, MesaDateDependent>>(
    new Map([[keyOf(initialMesa.workMode, initialMesa.selDate, `${initialMesa.calendar.y}-${initialMesa.calendar.m}`, initialMesa.mesaActiva), initialMesa]]),
  );

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
    const cached = cacheRef.current.get(key);
    if (cached) { setMesa(cached); broadcastMesa(cached); return; }
    startTransition(async () => {
      const res = await cargarMesa(params);
      if (res.ok) { cacheRef.current.set(key, res.mesa); setMesa(res.mesa); broadcastMesa(res.mesa); }
    });
  }, [mesa]);

  // "Shader cache" del calendario (misma filosofía que el conmutador de mesa):
  // los otros dos modos (día/semana/mes) del rango actual se precargan en idle
  // a la cache — el toggle pasa de esperar el server action (segundos con
  // cartolas grandes en el rango) al cache hit (~50ms medidos). Deduplicado por
  // key; reloadMesa vacía la cache tras mutar y este effect re-tibia solo.
  const prefetchTimer = useRef<number | null>(null);
  useEffect(() => {
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      const month = `${mesa.calendar.y}-${mesa.calendar.m}`;
      (["day", "week", "month"] as const).forEach((view) => {
        if (view === mesa.workMode) return;
        const key = keyOf(view, mesa.selDate, month, mesa.mesaActiva);
        if (cacheRef.current.has(key)) return;
        void cargarMesa({ date: mesa.selDate, month, view, mesa: mesa.mesaActiva }).then((res) => {
          if (res.ok && !cacheRef.current.has(key)) cacheRef.current.set(key, res.mesa);
        }).catch(() => { /* precarga best-effort: si falla, el toggle paga el fetch normal */ });
      });
    }, 1500);
    return () => { if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current); };
  }, [mesa]);

  // Recarga el rango ACTUAL sin navegar (tras aprobar/rechazar/mapear). A
  // diferencia de navigate, ignora la cache (los datos cambiaron): la vacía
  // COMPLETA (aprobar/emitir también altera los contadores de otros rangos
  // visitados) y re-siembra solo el rango actual.
  const reloadMesa = useCallback((opts?: { silent?: boolean }) => {
    const params = { date: mesa.selDate, month: `${mesa.calendar.y}-${mesa.calendar.m}`, view: mesa.workMode, mesa: mesa.mesaActiva };
    const run = async () => {
      cacheRef.current.clear();
      const res = await cargarMesa(params);
      if (res.ok) {
        cacheRef.current.set(keyOf(params.view, params.date, params.month, params.mesa), res.mesa);
        setMesa(res.mesa);
        broadcastMesa(res.mesa);
      }
    };
    // silent = refresh de fondo (realtime/poll): sin startTransition → NO atenúa la
    // mesa (sin parpadeo). El refresh por acción del usuario sí usa la transición.
    if (opts?.silent) void run();
    else startTransition(run);
  }, [mesa]);

  // Desde Emitir: abrir una tx en Check. Deja el doc pendiente, cambia a la
  // pestaña Check y, si la tx es de otro mes, navega el calendario para que
  // aparezca en la mesa (MesaTab la selecciona al verla).
  useEffect(() => {
    const onOpenDoc = (e: Event) => {
      const detail = (e as CustomEvent).detail as { documentoId?: string; month?: string } | undefined;
      if (detail?.documentoId) pendingOpenDoc.id = detail.documentoId;
      window.dispatchEvent(new CustomEvent("switch-tab", { detail: "subidos" }));
      const cur = `${mesa.calendar.y}-${mesa.calendar.m}`;
      if (detail?.month && detail.month !== cur) navigate({ view: "month", month: detail.month });
      // Caso mismo-mes: el doc ya está en la mesa; empuja a MesaTab a abrirlo
      // (el caso de otro mes llega por "mesa-updated" tras cargar el calendario).
      window.setTimeout(() => window.dispatchEvent(new Event("massdte:try-open")), 80);
    };
    window.addEventListener("massdte:open-doc", onOpenDoc);
    return () => window.removeEventListener("massdte:open-doc", onOpenDoc);
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
      const mesaActiva = mesa.mesaActiva;
      const key = keyOf("day", date, month, mesaActiva);
      cacheRef.current.delete(key); // datos nuevos → forzar re-fetch
      // SILENCIOSO (sin startTransition) → NO atenúa la mesa (era el "gris" que se
      // quedaba pegado mientras el procesamiento de fondo competía). subir-procesar
      // deja el doc en "procesando"; entra al toque y el poll de DocCardList lo lleva
      // a "procesado" sin volver a atenuar.
      void (async () => {
        const res = await cargarMesa({ date, month, view: "day", mesa: mesaActiva });
        if (res.ok) { cacheRef.current.set(key, res.mesa); setMesa(res.mesa); broadcastMesa(res.mesa); }
      })();
    };

    // VIGILANCIA post-subida (bug 2026-08-31, cazado con cartola real): la
    // frescura colgaba de Realtime + del poll de DocCardList, pero ese poll
    // solo se arma si el doc YA está visible — si la recarga inicial se pierde
    // (carrera con router.push) o Realtime no entrega (falló en silencio en el
    // navegador con el server 100% sano), la mesa queda congelada hasta F5.
    // Serie de recargas silenciosas con backoff: garantiza que el doc aparezca
    // y que su término se vea aunque la IA tarde minutos y Realtime esté muerto.
    const VIGILANCIA_MS = [4_000, 12_000, 30_000, 60_000, 100_000, 150_000, 210_000];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const vigilar = (date: string) => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      for (const ms of VIGILANCIA_MS) timers.push(setTimeout(() => recargarDia(date), ms));
    };

    const onUploaded = (e: Event) => {
      const date = (e as CustomEvent<{ date?: string }>).detail?.date ?? mesa.selDate;
      recargarDia(date);
      vigilar(date);
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
          recargarDia(date ?? mesa.selDate);
          vigilar(date ?? mesa.selDate);
        } else {
          sessionStorage.removeItem("massdte:uploaded-at");
        }
      }
    } catch { /* sessionStorage puede no estar (SSR/privacidad): el evento igual cubre */ }

    return () => {
      window.removeEventListener("massdte:uploaded", onUploaded);
      for (const t of timers) clearTimeout(t);
    };
  }, [mesa]);

  // ── COLUMNA VERTEBRAL DE FRESCURA (patrón Linear/Figma/Notion) ───────────────
  // UNA suscripción Realtime en el contenedor SIEMPRE montado (MesaController vive
  // por encima de las pestañas), filtrada por empresa. Cualquier escritura a las
  // tablas vivas —de ESTA pestaña, de OTRA pestaña, de un compañero de equipo, o de
  // la EXTENSIÓN (que postea a /api/sii-local/result con service role)— dispara
  // reloadMesa sin importar en qué pestaña esté el usuario. Antes esta suscripción
  // vivía DENTRO de EmitirTabContent, que se desmonta al cambiar de tab: por eso el
  // folio emitido por la extensión quedaba invisible salvo F5. reloadRef evita
  // re-suscribir el canal en cada cambio de `mesa`; el debounce coalesce ráfagas
  // (p.ej. una emisión de varias boletas) en un solo reload silencioso.
  const reloadRef = useRef(reloadMesa);
  useEffect(() => { reloadRef.current = reloadMesa; }, [reloadMesa]);
  useEffect(() => {
    if (!empresaId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current({ silent: true }), 500);
    };
    // Boleta nueva: además de refrescar la mesa, avisa a la isla RCV (vive fuera del
    // estado de la mesa, con su propia cache por mes) para que invalide el mes visible.
    const onBoleta = () => {
      bump();
      window.dispatchEvent(new CustomEvent("massdte:emitted"));
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
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [empresaId]);

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
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, opacity: isPending ? 0.55 : 1, transition: "opacity .18s ease" }}>
                <Mesa mesa={mesa} clientes={clientes} empresaId={empresaId} empresaGiro={empresaGiro} empresaRazon={empresaRazon} empresaTipo={empresaTipo} />
              </div>
            </MesaReloadContext.Provider>
          }
        />
      </div>
      <GuardarailOrbe guardarail={mesa.guardarail} />
    </>
  );
}
