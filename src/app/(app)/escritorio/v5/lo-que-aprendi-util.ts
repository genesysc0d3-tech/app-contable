/**
 * "Lo que aprendí" — piezas PURAS (testeables) de la pantalla y su acción.
 */
import { extraerPatronContraparte } from "@/lib/ai/aprender-regla";
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

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase());
}

/** Nombre de la contraparte a partir de una glosa viva ("TRANSFERENCIA DE JUAN PEREZ" → "Juan Perez"). */
export function contraparteVisible(glosa: string | null | undefined): string | null {
  const g = String(glosa ?? "").trim();
  if (!g) return null;
  const p = extraerPatronContraparte(g);
  if (p) return titulo(p.patron);
  return g.length > 48 ? `${g.slice(0, 47)}…` : g;
}

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
