"use client";

// ACTUALIZACIÓN AUTOMÁTICA E INVISIBLE (pedido del fundador, 2026-09-30): cuando
// publicamos, cada pestaña queda en la versión nueva SIN que nadie le diga a la
// clienta "recarga la página", y vuelve exactamente donde estaba.
//
//  1. Detectar (cero pedidos extra): el proxy estampa x-massdte-version en cada
//     respuesta; acá se envuelve window.fetch y se compara con la versión de ESTA
//     pestaña en los pedidos que la app YA hace. Único extra opcional: un HEAD a
//     /api/sw-config al volver tras >30 min oculta. Nada de sondeo periódico.
//  2. Recargar solo en momento seguro (lib/actualizacion/ocupado.ts): nunca con una
//     emisión, subida, pedido que escribe, popup/formulario abierto o alguien
//     escribiendo. Oculta → al tiro; visible → cuando lleva 3 s quieta.
//  3. Guardar y restaurar (lib/actualizacion/piezas.ts + scroll.ts): pestaña, doc
//     del visor, filtros, paneles, scroll y foco; mes/día/vista/mesa van en la URL.
//     Un script inline oculta la página hasta restaurar (sin parpadeo).
//  4. Anti-bucle (lib/actualizacion/anti-bucle.ts): 1 recarga por versión, 10 min
//     de enfriamiento. Kill switch: ACTUALIZACION_AUTO=false en el server.
//
// El SW no se toca: sus navegaciones son red-primero, así que la recarga trae el
// HTML nuevo; su kill-switch (/api/sw-config) sigue igual.

import { useEffect } from "react";
import { crearActualizador } from "@/lib/actualizacion/actualizador";
import { versionDelCliente } from "@/lib/actualizacion/version";
import { alLiberarBloqueo, bloqueosActivos, motivoOcupado } from "@/lib/actualizacion/ocupado";
import { ATRIBUTO_RESTAURANDO, guardarEstado, FORMATO_ESTADO, TOPE_TAPADO_MS } from "@/lib/actualizacion/estado-guardado";
import { capturarPiezas, descartarRestauracion, estadoARestaurar, momentoUltimaRestauracion, piezasPorRestaurar } from "@/lib/actualizacion/piezas";
import { aplicarScroll, capturarScroll } from "@/lib/actualizacion/scroll";

const OCULTA_LARGA_MS = 30 * 60_000;
const REINTENTO_MS = 5_000;
// Tras restaurar una pieza, cuánto se espera a las que faltan (montan en cadena:
// la pestaña Emitir recién existe después de restaurar la pestaña activa).
const ESPERA_ENTRE_PIEZAS_MS = 1_500;
const TOPE_SCROLL_MS = 1_200;

type VentanaConMarca = Window & { __massdteActualizador?: boolean };

function guardarLoVisible(desde: string): void {
  const activo = document.activeElement as HTMLElement | null;
  guardarEstado(window.sessionStorage, {
    formato: FORMATO_ESTADO,
    desde,
    at: Date.now(),
    ruta: window.location.pathname + window.location.search,
    piezas: capturarPiezas(),
    scroll: capturarScroll(document),
    foco: activo && activo !== document.body && activo.id ? activo.id : null,
    ventana: { x: window.scrollX, y: window.scrollY },
  });
}

/** Tras la recarga: espera a que las piezas se monten, re-aplica scroll y foco, y muestra. */
function terminarRestauracion(): () => void {
  const html = document.documentElement;
  const estado = estadoARestaurar();
  if (!estado) { html.removeAttribute(ATRIBUTO_RESTAURANDO); return () => {}; }
  let cancelado = false;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // rAF se congela con la pestaña oculta (justo el caso de la recarga silenciosa):
  // oculta → setTimeout, para que al volver ya esté todo restaurado.
  const siguiente = (cb: () => void) => {
    if (document.hidden) timer = setTimeout(cb, 50);
    else raf = requestAnimationFrame(cb);
  };
  const inicio = performance.now();
  const mostrar = () => html.removeAttribute(ATRIBUTO_RESTAURANDO);

  const aplicarFinal = () => {
    const t0 = performance.now();
    const paso = () => {
      if (cancelado) return;
      let faltan = 0;
      try { faltan = aplicarScroll(document, estado.scroll); } catch { faltan = 0; }
      if (estado.ventana.y > 0) window.scrollTo(estado.ventana.x, estado.ventana.y);
      // Se muestra apenas el primer intento corrió; si una lista larga aún crece, el
      // scroll se sigue corrigiendo unos cuadros más sin que se note.
      mostrar();
      if (faltan > 0 && performance.now() - t0 < TOPE_SCROLL_MS) { siguiente(paso); return; }
      if (estado.foco) { try { document.getElementById(estado.foco)?.focus({ preventScroll: true }); } catch { /* */ } }
    };
    siguiente(() => siguiente(paso));
  };

  // Las piezas se restauran solas al montarse (piezas.ts); acá solo se espera a que
  // no quede ninguna pendiente (o al tope: lo que no montó se descarta).
  const revisar = () => {
    if (cancelado) return;
    if (piezasPorRestaurar() === 0) { aplicarFinal(); return; }
    // La mesa se streamea después del layout: sin ninguna pieza aún se espera hasta el
    // tope del tapado; con alguna, un rato corto desde la última (lo demás se descarta).
    const ultima = momentoUltimaRestauracion();
    const vencido = ultima === null ? performance.now() - inicio > TOPE_TAPADO_MS - 500 : Date.now() - ultima > ESPERA_ENTRE_PIEZAS_MS;
    if (vencido) { descartarRestauracion(); aplicarFinal(); return; }
    siguiente(revisar);
  };
  revisar();
  return () => { cancelado = true; cancelAnimationFrame(raf); if (timer) clearTimeout(timer); mostrar(); };
}

export default function ActualizadorInvisible() {
  useEffect(() => terminarRestauracion(), []);

  useEffect(() => {
    const w = window as VentanaConMarca;
    if (w.__massdteActualizador) return;
    w.__massdteActualizador = true;

    const versionPropia = versionDelCliente();
    let mutacionesEnVuelo = 0;
    let ultimaInteraccion = 0;
    let ocultaDesde: number | null = document.hidden ? Date.now() : null;
    let reintento: ReturnType<typeof setTimeout> | null = null;

    const act = crearActualizador({
      versionPropia,
      ahora: () => Date.now(),
      sesion: window.sessionStorage,
      oculta: () => document.hidden,
      enLinea: () => navigator.onLine !== false,
      ruta: () => window.location.pathname,
      ocupado: () => motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo, doc: document }),
      ultimaInteraccion: () => ultimaInteraccion,
      guardarEstado: () => guardarLoVisible(versionPropia),
      recargar: () => window.location.reload(),
    });

    // Reintento LOCAL (sin red) solo mientras hay una actualización pendiente.
    const agendar = () => {
      if (reintento) clearTimeout(reintento);
      reintento = null;
      if (!act.pendiente()) return;
      reintento = setTimeout(() => { reintento = null; act.intentar(); agendar(); }, REINTENTO_MS);
    };
    const intentarYa = () => { if (act.pendiente()) { act.intentar(); agendar(); } };

    // Envoltorio liviano de fetch: observa la cabecera en las respuestas propias y
    // cuenta los pedidos que escriben en vuelo (de cualquier origen: subidas a storage).
    const original = window.fetch;
    const envuelto: typeof window.fetch = async (input, init) => {
      const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const escribe = metodo !== "GET" && metodo !== "HEAD";
      if (escribe) mutacionesEnVuelo++;
      try {
        const res = await original.call(window, input, init);
        try {
          const url = res.url || (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          if (new URL(url, window.location.href).origin === window.location.origin) {
            act.observar(res.headers);
            agendar();
          }
        } catch { /* observar jamás rompe un pedido */ }
        return res;
      } finally {
        if (escribe) { mutacionesEnVuelo = Math.max(0, mutacionesEnVuelo - 1); if (mutacionesEnVuelo === 0) queueMicrotask(intentarYa); }
      }
    };
    window.fetch = envuelto;

    const onInteraccion = () => { ultimaInteraccion = Date.now(); };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onInteraccion, opts);
    window.addEventListener("keydown", onInteraccion, opts);
    window.addEventListener("wheel", onInteraccion, opts);

    const onVisible = () => {
      if (document.hidden) { ocultaDesde = Date.now(); intentarYa(); return; }
      const largo = ocultaDesde !== null && Date.now() - ocultaDesde > OCULTA_LARGA_MS;
      ocultaDesde = null;
      // Volvió tras mucho rato: UN HEAD barato (sin auth ni DB) por si hubo deploy.
      if (largo && !act.pendiente()) void window.fetch("/api/sw-config", { method: "HEAD", cache: "no-store" }).catch(() => {});
      intentarYa();
    };
    document.addEventListener("visibilitychange", onVisible);
    const soltar = alLiberarBloqueo(() => queueMicrotask(intentarYa));

    return () => {
      if (window.fetch === envuelto) window.fetch = original;
      window.removeEventListener("pointerdown", onInteraccion, opts);
      window.removeEventListener("keydown", onInteraccion, opts);
      window.removeEventListener("wheel", onInteraccion, opts);
      document.removeEventListener("visibilitychange", onVisible);
      soltar();
      if (reintento) clearTimeout(reintento);
      w.__massdteActualizador = false;
    };
  }, []);

  return null;
}
