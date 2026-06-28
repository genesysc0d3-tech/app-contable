"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import RightColumnView from "./RightColumnView";
import Mesa, { type MesaProps } from "./Mesa";
import CalendarStrip, { type NavParams } from "./CalendarStrip";
import { cargarMesa } from "./actions";
import { MesaReloadContext, pendingOpenDoc } from "./mesa-reload";
import type { MesaDateDependent } from "./mesa-data";
import type { SearchItem } from "@/lib/tree-structure";

const keyOf = (view: string, date: string, month: string) => `${view}|${date}|${month}`;

// Avisa a los slots estáticos (card de Registros) los nuevos números del rango,
// para que Ventas/Actividad sigan al calendario maestro.
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
    new Map([[keyOf(initialMesa.workMode, initialMesa.selDate, `${initialMesa.calendar.y}-${initialMesa.calendar.m}`), initialMesa]]),
  );

  const navigate = useCallback((patch: NavParams) => {
    const params = {
      date: patch.date ?? mesa.selDate,
      month: patch.month ?? `${mesa.calendar.y}-${mesa.calendar.m}`,
      view: patch.view ?? mesa.workMode,
    };
    // URL sigue siendo la verdad (para refresh/compartir) — sin navegar.
    window.history.replaceState(null, "", `/massdte?date=${params.date}&month=${params.month}&view=${params.view}`);
    const key = keyOf(params.view, params.date, params.month);
    const cached = cacheRef.current.get(key);
    if (cached) { setMesa(cached); broadcastMesa(cached); return; }
    startTransition(async () => {
      const res = await cargarMesa(params);
      if (res.ok) { cacheRef.current.set(key, res.mesa); setMesa(res.mesa); broadcastMesa(res.mesa); }
    });
  }, [mesa]);

  // Recarga el rango ACTUAL sin navegar (tras aprobar/rechazar/mapear). A
  // diferencia de navigate, ignora la cache (los datos cambiaron) y la reescribe.
  const reloadMesa = useCallback((opts?: { silent?: boolean }) => {
    const params = { date: mesa.selDate, month: `${mesa.calendar.y}-${mesa.calendar.m}`, view: mesa.workMode };
    const run = async () => {
      const res = await cargarMesa(params);
      if (res.ok) {
        cacheRef.current.set(keyOf(params.view, params.date, params.month), res.mesa);
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
    </>
  );
}
