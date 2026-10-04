/**
 * "Lo que aprendí" — piezas PURAS (testeables) de la pantalla y su acción.
 */
import type { EstadoRegla } from "@/lib/ai/regla-evidencia";

export interface ReglaAprendida {
  id: string;
  /** Contraparte desde la evidencia viva; null = su cartola se borró. */
  contraparte: string | null;
  tipo: "Exenta" | "Afecta" | null;
  /** Filas que la regla clasificó y terminaron emitidas sin corrección. */
  aciertos: number;
  estado: EstadoRegla;
}

export const SIN_CONTRAPARTE = "Contraparte de una cartola borrada";
export const VACIO_LO_QUE_APRENDI = "Todavía no aprendo nada. Cuando corrijas un tipo en Check, lo recuerdo aquí.";

export { contraparteVisible } from "@/lib/ai/contraparte-visible";

const ORDEN: Record<string, number> = { en_disputa: 0, a_prueba: 1, firme: 2 };

/** Primero lo que necesita a la clienta (no estoy seguro, aprendiendo), luego lo seguro; más aciertos arriba. */
export function ordenarAprendidas(reglas: ReglaAprendida[]): ReglaAprendida[] {
  return [...reglas].sort((a, b) => (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3) || b.aciertos - a.aciertos);
}

export function textoAciertos(n: number): string {
  if (n <= 0) return "Todavía no acierta en una boleta";
  return n === 1 ? "Acertó 1 vez" : `Acertó ${n.toLocaleString("es-CL")} veces`;
}

export function mensajeDeshacer(r: { reevaluadas: number; enEmitir: number; sinRegla: number }): string {
  const partes = ["Listo, ya no lo aplico."];
  if (r.reevaluadas > 0) {
    partes.push(r.reevaluadas === 1 ? "1 movimiento volvió a revisarse." : `${r.reevaluadas} movimientos volvieron a revisarse.`);
  }
  if (r.sinRegla > 0) partes.push(r.sinRegla === 1 ? "1 te espera en Check." : `${r.sinRegla} te esperan en Check.`);
  if (r.enEmitir > 0) {
    partes.push(r.enEmitir === 1 ? "1 ya estaba en Emitir: esa no la toqué." : `${r.enEmitir} ya estaban en Emitir: esas no las toqué.`);
  }
  return partes.join(" ");
}
