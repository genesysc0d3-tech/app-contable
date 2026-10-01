// Armar lo que se guarda antes de recargar y decidir cuándo abandonar lo que no
// alcanzó a restaurarse. Sin DOM directo (raíz inyectada) → testeable.
import { FORMATO_ESTADO, necesitaTapar, type EstadoGuardado } from "./estado-guardado";
import { capturarPiezas } from "./piezas";
import { capturarScroll } from "./scroll";

type RaizScroll = Parameters<typeof capturarScroll>[0];

export function capturarEstadoVisible({ raiz, ruta, ahora, desde, foco, ventana }: {
  raiz: RaizScroll; ruta: string; ahora: number; desde: string; foco: string | null; ventana: { x: number; y: number };
}): EstadoGuardado {
  const piezas = capturarPiezas();
  const scroll = capturarScroll(raiz);
  return {
    formato: FORMATO_ESTADO, desde, at: ahora, ruta, piezas, scroll, foco, ventana,
    tapar: necesitaTapar(piezas, scroll) || ventana.y > 0,
  };
}

/**
 * ¿Un toque de la clienta cierra la ventana de restauración? Solo DESPUÉS de haber
 * restaurado algo (y con 500 ms de margen). Antes no: una página que aún no hidrata
 * (pestaña recién vuelta, máquina lenta, o SSR fallido en dev) se hidrata justamente
 * con ese toque, y descartar ahí devolvía a Check (bug en vivo 2026-10-01, 39d6542).
 */
export const MARGEN_TOQUE_TRAS_RESTAURAR_MS = 500;
export function toqueCierraVentana(msDesdePrimeraRestauracion: number | null): boolean {
  return msDesdePrimeraRestauracion !== null && msDesdePrimeraRestauracion >= MARGEN_TOQUE_TRAS_RESTAURAR_MS;
}

/**
 * ¿Abandonar las piezas que aún no se montan? NO por un tope desde la carga: la mesa
 * puede llegar tarde (dev compilando >8 s, chunks fríos tras el deploy) y era justo
 * cuando la pestaña volvía a Check (bug en vivo 2026-10-01). Se abandona:
 *  - al primer toque de la clienta DESPUÉS de restaurar (ya siguió con otra cosa);
 *  - 8 s después de la primera pieza restaurada (lo que falte ya no viene);
 *  - al minuto de cargar, pase lo que pase.
 */
export function debeDescartarRestauracion({ msDesdeCarga, msDesdePrimeraRestauracion, toco }: {
  msDesdeCarga: number; msDesdePrimeraRestauracion: number | null; toco: boolean;
}): boolean {
  if (toco && toqueCierraVentana(msDesdePrimeraRestauracion)) return true;
  if (msDesdePrimeraRestauracion !== null && msDesdePrimeraRestauracion > 8_000) return true;
  return msDesdeCarga > 60_000;
}
