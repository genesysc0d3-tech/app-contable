"use client";

// ACTUALIZACIÓN AUTOMÁTICA E INVISIBLE (pedido del fundador, 2026-09-30): cuando
// publicamos, cada pestaña queda en la versión nueva SIN que nadie le diga a la
// clienta "recarga la página", y vuelve exactamente donde estaba ("que ni se sienta").
//
//  1. Detectar (sin sondeo): el proxy estampa x-massdte-version en cada respuesta;
//     acá se envuelve window.fetch y se compara con la versión de ESTA pestaña en los
//     pedidos que la app YA hace. Extra único y barato: un HEAD a /api/sw-config al
//     OCULTARSE la pestaña (máx. 1 cada 5 min), para recargar mientras no mira.
//  2. Recargar solo en momento seguro (lib/actualizacion/ocupado.ts): nunca con una
//     emisión, subida, pedido que escribe (ni 1 s después: su código lee la
//     respuesta), popup/formulario abierto o alguien escribiendo.
//     Oculta → al tiro; visible → solo tras 25 s sin tocar nada.
//  3. Guardar y restaurar (lib/actualizacion/piezas.ts + scroll.ts): pestaña, doc
//     del visor, filtros, paneles, scroll y foco; mes/día/vista/mesa van en la URL.
//     Si la vista difiere de la por defecto, la página queda invisible hasta
//     restaurar (el navegador sostiene el último cuadro): sin silueta ni destello.
//  4. Anti-bucle (lib/actualizacion/anti-bucle.ts). Kill switch: ACTUALIZACION_AUTO=false.
//
// El SW no se toca: sus navegaciones son red-primero, así que la recarga trae el
// HTML nuevo; su kill-switch (/api/sw-config) sigue igual.

import { useEffect } from "react";
import { crearActualizador, tocaConsultarVersion } from "@/lib/actualizacion/actualizador";
import { versionDelCliente } from "@/lib/actualizacion/version";
import { alLiberarBloqueo, bloqueosActivos, MARGEN_TRAS_ESCRITURA_MS, motivoOcupado } from "@/lib/actualizacion/ocupado";
import { ATRIBUTO_RESTAURANDO, guardarEstado, TOPE_TAPADO_MS } from "@/lib/actualizacion/estado-guardado";
import { descartarRestauracion, estadoARestaurar, momentoPrimeraRestauracion, momentoUltimaRestauracion, piezasPorRestaurar, ventanaRestauracionAbierta } from "@/lib/actualizacion/piezas";
import { aplicarScroll } from "@/lib/actualizacion/scroll";
import { capturarEstadoVisible, debeDescartarRestauracion } from "@/lib/actualizacion/capturar";

const REINTENTO_MS = 5_000;
// Tras soltar un bloqueo o terminar una escritura: margen para que el código que
// hizo el pedido procese su respuesta antes de evaluar (revisión adversarial A2).
const REINTENTO_TRAS_LIBERAR_MS = 400;
// Destapar: sin piezas pendientes, o 1,5 s sin que se restaure otra, o 3 s sin
// ninguna (la mesa no llegó). Lo que monte después igual se restaura al montarse
// (chunks fríos tras el deploy) según debeDescartarRestauracion.
const ESPERA_ENTRE_PIEZAS_MS = 1_500;
const ESPERA_SIN_PIEZAS_MS = 3_000;
// El scroll se re-aplica mientras la lista crece (datos que llegan tarde), hasta 3 s
// o hasta que la clienta toque algo.
const TOPE_SCROLL_MS = 3_000;
const EVENTOS_INTERACCION = ["pointerdown", "keydown", "wheel", "touchmove", "input"] as const;

type VentanaConMarca = Window & { __massdteActualizador?: boolean };

function guardarLoVisible(desde: string): void {
  const activo = document.activeElement as HTMLElement | null;
  guardarEstado(window.sessionStorage, capturarEstadoVisible({
    raiz: document,
    ruta: window.location.pathname + window.location.search,
    ahora: Date.now(),
    desde,
    foco: activo && activo !== document.body && activo.id ? activo.id : null,
    ventana: { x: window.scrollX, y: window.scrollY },
  }));
}

/** Tras la recarga: espera a que las piezas se monten, re-aplica scroll y foco, y destapa. */
function terminarRestauracion(): () => void {
  const html = document.documentElement;
  const estado = estadoARestaurar();
  if (!estado) { html.removeAttribute(ATRIBUTO_RESTAURANDO); return () => {}; }
  let cancelado = false;
  let raf = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const inicio = performance.now();
  const mostrar = () => html.removeAttribute(ATRIBUTO_RESTAURANDO);
  // rAF se congela con la pestaña oculta (justo el caso de la recarga silenciosa):
  // oculta → setTimeout, para que al volver ya esté todo restaurado.
  const siguiente = (cb: () => void) => {
    if (document.hidden) { const t = setTimeout(() => { timers.delete(t); cb(); }, 50); timers.add(t); }
    else raf = requestAnimationFrame(cb);
  };
  let toco = false;
  // Primer toque de la clienta: ya siguió con otra cosa → lo que falte por restaurar
  // se abandona (no se le cambia la pestaña ni el doc bajo los dedos).
  const alTocar = () => { toco = true; descartarRestauracion(); };
  // Lo que monta tarde (la mesa streameada, chunks fríos) se sigue restaurando al
  // montarse; se abandona según debeDescartarRestauracion (no un tope desde la carga).
  const vigilarDescarte = () => {
    // La ventana sigue abierta aunque todo se haya aplicado una vez: un re-montaje
    // (SSR fallido, StrictMode) vuelve a recibir su valor hasta el toque o el descarte.
    if (cancelado || !ventanaRestauracionAbierta()) return;
    const primera = momentoPrimeraRestauracion();
    if (debeDescartarRestauracion({ msDesdeCarga: performance.now() - inicio, msDesdePrimeraRestauracion: primera === null ? null : Date.now() - primera, toco })) { descartarRestauracion(); return; }
    const t = setTimeout(() => { timers.delete(t); vigilarDescarte(); }, 1_000);
    timers.add(t);
  };
  vigilarDescarte();
  // La página nunca queda invisible más que el tope (4 s), pase lo que pase.
  const tope = setTimeout(() => mostrar(), TOPE_TAPADO_MS);
  timers.add(tope);
  for (const ev of EVENTOS_INTERACCION) window.addEventListener(ev, alTocar, { capture: true, passive: true, once: true });
  const soltarOyentes = () => { for (const ev of EVENTOS_INTERACCION) window.removeEventListener(ev, alTocar, { capture: true }); };

  const aplicarFinal = () => {
    const t0 = performance.now();
    let enfocado = false;
    const paso = () => {
      if (cancelado) return;
      let faltan = 0;
      if (!toco) {
        try { faltan = aplicarScroll(document, estado.scroll); } catch { faltan = 0; }
        if (estado.ventana.y > 0 && Math.abs(window.scrollY - estado.ventana.y) > 2) { window.scrollTo(estado.ventana.x, estado.ventana.y); faltan++; }
      }
      mostrar();
      if (!enfocado && estado.foco) {
        enfocado = true;
        try { document.getElementById(estado.foco)?.focus({ preventScroll: true }); } catch { /* */ }
      }
      if (!toco && faltan > 0 && performance.now() - t0 < TOPE_SCROLL_MS) { siguiente(paso); return; }
      soltarOyentes();
    };
    siguiente(() => siguiente(paso));
  };

  // Las piezas se restauran solas al montarse (piezas.ts); acá solo se decide cuándo destapar.
  const revisar = () => {
    if (cancelado) return;
    const ultima = momentoUltimaRestauracion();
    const listo = piezasPorRestaurar() === 0
      || (ultima !== null && Date.now() - ultima > ESPERA_ENTRE_PIEZAS_MS)
      || (ultima === null && performance.now() - inicio > ESPERA_SIN_PIEZAS_MS);
    if (listo) { aplicarFinal(); return; }
    siguiente(revisar);
  };
  revisar();
  return () => {
    cancelado = true;
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    soltarOyentes();
    mostrar();
  };
}

export default function ActualizadorInvisible() {
  useEffect(() => terminarRestauracion(), []);

  useEffect(() => {
    const w = window as VentanaConMarca;
    if (w.__massdteActualizador) return;
    w.__massdteActualizador = true;

    const versionPropia = versionDelCliente();
    let mutacionesEnVuelo = 0;
    let ultimaEscrituraFin = 0;
    let ultimaInteraccion = 0;
    let ultimaConsulta: number | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let diferido: ReturnType<typeof setTimeout> | null = null;

    const act = crearActualizador({
      versionPropia,
      ahora: () => Date.now(),
      sesion: window.sessionStorage,
      oculta: () => document.hidden,
      enLinea: () => navigator.onLine !== false,
      ruta: () => window.location.pathname,
      ocupado: () => motivoOcupado({
        bloqueos: bloqueosActivos(),
        mutacionesEnVuelo,
        msDesdeUltimaEscritura: Date.now() - ultimaEscrituraFin,
        doc: document,
      }),
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
    const intentarPronto = (ms: number) => {
      if (diferido) clearTimeout(diferido);
      diferido = setTimeout(() => { diferido = null; intentarYa(); }, ms);
    };

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
        if (escribe) {
          mutacionesEnVuelo = Math.max(0, mutacionesEnVuelo - 1);
          ultimaEscrituraFin = Date.now();
          // setTimeout, NO microtask: el que hizo el POST alcanza a leer su respuesta
          // (y a mostrar un error) antes de que se evalúe recargar (A2).
          if (mutacionesEnVuelo === 0) intentarPronto(MARGEN_TRAS_ESCRITURA_MS + REINTENTO_TRAS_LIBERAR_MS);
        }
      }
    };
    window.fetch = envuelto;

    // Interacción = cualquier señal de que la clienta está usando la pestaña (B1:
    // también scroll táctil, scroll de contenedores y pegar sin clic).
    const onInteraccion = () => { ultimaInteraccion = Date.now(); };
    const opts = { capture: true, passive: true } as const;
    const eventos = ["pointerdown", "keydown", "wheel", "touchmove", "scroll", "input"] as const;
    for (const ev of eventos) window.addEventListener(ev, onInteraccion, opts);

    const onVisible = () => {
      if (document.hidden) {
        // Se ocultó: si ya hay versión pendiente, recarga ahora (no mira). Si no, UN
        // HEAD barato por si hubo deploy — así la recarga cae mientras está oculta.
        if (!act.pendiente() && tocaConsultarVersion(ultimaConsulta, Date.now())) {
          ultimaConsulta = Date.now();
          void window.fetch("/api/sw-config", { method: "HEAD", cache: "no-store" }).catch(() => {});
        }
        intentarYa();
        return;
      }
      intentarYa();
    };
    document.addEventListener("visibilitychange", onVisible);
    const soltar = alLiberarBloqueo(() => intentarPronto(REINTENTO_TRAS_LIBERAR_MS));

    return () => {
      if (window.fetch === envuelto) window.fetch = original;
      for (const ev of eventos) window.removeEventListener(ev, onInteraccion, opts);
      document.removeEventListener("visibilitychange", onVisible);
      soltar();
      if (reintento) clearTimeout(reintento);
      if (diferido) clearTimeout(diferido);
      w.__massdteActualizador = false;
    };
  }, []);

  return null;
}
