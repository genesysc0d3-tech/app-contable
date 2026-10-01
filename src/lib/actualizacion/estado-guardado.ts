// Lo que la clienta está viendo, guardado justo antes de la recarga automática y
// restaurado al volver: sessionStorage (por pestaña), con TTL corto y atado a la
// MISMA ruta (mes/día/vista/mesa viajan en la URL). Si algo no calza, se descarta.
import type { StorageLike } from "./anti-bucle";

export const CLAVE_ESTADO = "massdte:actualizacion:estado";
export const TTL_ESTADO_MS = 2 * 60_000;
export const FORMATO_ESTADO = 1;

export type ScrollGuardado = { clave: string; top: number; left: number };
export type EstadoGuardado = {
  formato: typeof FORMATO_ESTADO;
  /** Versión desde la que se recargó (diagnóstico). */
  desde: string;
  at: number;
  /** pathname + search al guardar. */
  ruta: string;
  piezas: Record<string, unknown>;
  scroll: ScrollGuardado[];
  /** id del elemento con foco (si tenía id). */
  foco: string | null;
  ventana: { x: number; y: number };
  /** La vista restaurada difiere de la que pinta el server → taparla hasta restaurar. */
  tapar?: boolean;
};

const POR_DEFECTO: Record<string, unknown> = { "mesa.tab": "subidos", "check.doc": null, "derecha.vista": "dashboard" };
/**
 * ¿Hace falta tapar al recargar? Solo si lo restaurado cambia lo que se ve (otra
 * pestaña, un doc abierto, otra vista, scroll). Si la vista guardada es la que el
 * server ya pinta, se muestra directo: cero destello (revisión adversarial M2).
 */
export function necesitaTapar(piezas: Record<string, unknown>, scroll: ScrollGuardado[]): boolean {
  if (scroll.some((x) => x.top > 0)) return true;
  for (const [k, v] of Object.entries(piezas)) {
    if (k in POR_DEFECTO) { if (v !== POR_DEFECTO[k] && v != null) return true; continue; }
    if (k === "emitir.vista") continue; // solo existe si la pestaña ya no es la por defecto
    if (v != null) return true;
  }
  return false;
}

export function guardarEstado(s: StorageLike, e: EstadoGuardado): boolean {
  try { s.setItem(CLAVE_ESTADO, JSON.stringify(e)); return true; } catch { return false; }
}

/** Lee y CONSUME el estado (una sola restauración). null si no hay o no sirve. */
export function leerEstado(s: StorageLike, { ahora, ruta }: { ahora: number; ruta: string }): EstadoGuardado | null {
  let raw: string | null = null;
  try {
    raw = s.getItem(CLAVE_ESTADO);
    if (raw) s.removeItem(CLAVE_ESTADO);
  } catch { return null; }
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as EstadoGuardado;
    if (!e || e.formato !== FORMATO_ESTADO || typeof e.at !== "number") return null;
    // Fecha futura (reloj movido) o vencido: fuera.
    if (e.at > ahora + 5_000 || ahora - e.at > TTL_ESTADO_MS) return null;
    if (e.ruta !== ruta) return null;
    return {
      ...e,
      piezas: e.piezas && typeof e.piezas === "object" ? e.piezas : {},
      scroll: Array.isArray(e.scroll) ? e.scroll.filter((x) => x && typeof x.clave === "string" && Number.isFinite(x.top)) : [],
      foco: typeof e.foco === "string" ? e.foco : null,
      ventana: e.ventana && Number.isFinite(e.ventana.y) ? e.ventana : { x: 0, y: 0 },
    };
  } catch {
    return null;
  }
}

/**
 * Script inline (antes de pintar): si hay un estado vigente para ESTA ruta de la
 * mesa y la vista restaurada difiere de la por defecto, marca <html> y la página
 * queda INVISIBLE (sin contenido que pintar, Chrome sostiene el último cuadro de la
 * página anterior — "paint holding") hasta restaurar: sin silueta ni destello.
 * Con tope propio: a los 8 s se destapa pase lo que pase.
 */
export const ATRIBUTO_RESTAURANDO = "data-massdte-restaurando";
export const TOPE_TAPADO_MS = 8_000;
export const SCRIPT_ANTES_DE_PINTAR = `try{if(location.pathname==="/massdte"){var r=sessionStorage.getItem(${JSON.stringify(CLAVE_ESTADO)});if(r){var e=JSON.parse(r),n=Date.now();if(e&&e.tapar===true&&e.formato===${FORMATO_ESTADO}&&n-e.at<${TTL_ESTADO_MS}&&e.at<=n+5000&&e.ruta===location.pathname+location.search){var d=document.documentElement;d.setAttribute(${JSON.stringify(ATRIBUTO_RESTAURANDO)},"");setTimeout(function(){d.removeAttribute(${JSON.stringify(ATRIBUTO_RESTAURANDO)})},${TOPE_TAPADO_MS})}}}}catch(_){}`;
export const ESTILO_RESTAURANDO = `html[${ATRIBUTO_RESTAURANDO}] body>*{visibility:hidden!important}`;
