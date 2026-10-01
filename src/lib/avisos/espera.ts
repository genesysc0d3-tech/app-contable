// ¿Puede salir ESTE aviso ahora? (puro, testeable)
//
// Para todos manda el momento seguro general de la actualización invisible
// (lib/actualizacion/ocupado.ts: emisión, subida, popup/modal abierto, alguien
// escribiendo). El popup urgente, que tapa la pantalla y roba el foco, además
// espera (revisión adversarial M2, 2026-10-01):
//  - pedidos que escriben en vuelo (los cuenta el envoltorio de fetch del actualizador);
//  - un margen tras soltarse un bloqueo: al terminar una emisión, la clienta lee el
//    resultado ("boleta emitida"/"falló") en paz;
//  - que no haya un toast de la app a la vista (ese resultado suele ser un toast).
// Toast y tarjeta no tapan nada: van BAJO los modales (z-index < 100).
import type { FormatoAviso } from "./reglas";

export const MARGEN_POPUP_TRAS_LIBERAR_MS = 12_000;

export type SenalesEspera = {
  /** motivoOcupado() general (null = libre). */
  base: string | null;
  escriturasEnVuelo: number;
  msDesdeLiberacion: number;
  toastDeLaApp: boolean;
};

export function motivoEsperaAviso(formato: FormatoAviso, s: SenalesEspera): string | null {
  if (s.base) return s.base;
  if (formato !== "popup") return null;
  if (s.escriturasEnVuelo > 0) return "pedido_en_vuelo";
  if (s.msDesdeLiberacion < MARGEN_POPUP_TRAS_LIBERAR_MS) return "margen_tras_liberar";
  if (s.toastDeLaApp) return "toast_de_la_app";
  return null;
}
