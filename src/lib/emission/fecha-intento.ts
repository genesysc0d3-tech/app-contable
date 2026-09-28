// Fecha de cada boleta y guarda de medianoche (plan-emision-confiable §1.6 + B2, 2026-09-28).
//
// Antes el lote fijaba "hoy" al ABRIR el modal y todas las boletas viajaban con esa
// fecha. El SII pone la fecha REAL del clic; el calce en /reportes exige que la fecha
// de la fila sea igual a la del job y el listado muestra solo HOY. Un lote que cruza
// las 00:00 (LC emitía a las 23:37) buscaba con la fecha de ayer → 0 candidatas →
// "no salió" → la boleta volvía a Listas y se re-emitía → DOBLE FOLIO.

import { chileDateString } from "@/lib/chile-date";

/** Fecha (Chile, YYYY-MM-DD) con la que viaja ESTA boleta: la del momento de emitirla. */
export function fechaParaEmitir(ahora: Date = new Date()): string {
  return chileDateString(ahora);
}

/**
 * ¿Se puede creer un "no salió" de la verificación en /reportes?
 * Solo si todo ocurrió el MISMO día Chile: la fecha con que viajó la boleta, el
 * inicio y el fin del intento, y el momento de verificar. Si el intento cruzó la
 * medianoche, el listado del día no muestra la fila (o la fecha no calza) y "no la
 * encontré" NO significa "no salió" → queda a medias.
 */
export function noSalioEsConfiable(args: {
  fechaIntento: string;
  desdeMs: number;
  hastaMs: number;
  ahoraMs: number;
}): boolean {
  const dia = (ms: number) => chileDateString(new Date(ms));
  return (
    dia(args.desdeMs) === args.fechaIntento &&
    dia(args.hastaMs) === args.fechaIntento &&
    dia(args.ahoraMs) === args.fechaIntento
  );
}
