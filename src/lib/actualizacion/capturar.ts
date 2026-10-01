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
 * ¿Abandonar las piezas que aún no se montan? NO por un tope desde la carga: la mesa
 * puede llegar tarde (dev compilando >8 s, chunks fríos tras el deploy) y era justo
 * cuando la pestaña volvía a Check (bug en vivo 2026-10-01). Se abandona:
 *  - al primer toque de la clienta (ya siguió con otra cosa: no se le mueve la vista);
 *  - 8 s después de la primera pieza restaurada (lo que falte ya no viene);
 *  - al minuto de cargar, pase lo que pase.
 */
export function debeDescartarRestauracion({ msDesdeCarga, msDesdePrimeraRestauracion, toco }: {
  msDesdeCarga: number; msDesdePrimeraRestauracion: number | null; toco: boolean;
}): boolean {
  if (toco) return true;
  if (msDesdePrimeraRestauracion !== null && msDesdePrimeraRestauracion > 8_000) return true;
  return msDesdeCarga > 60_000;
}
