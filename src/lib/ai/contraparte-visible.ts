/**
 * Nombre legible de la contraparte a partir de una glosa VIVA de la cartola
 * ("TRANSFERENCIA DE JUAN PEREZ" → "Juan Perez"). Lo usan "Lo que aprendí" y los avisos
 * de Check. Nunca sale del nombre de la regla (que ya no lleva al tercero). Sin un
 * nombre reconocible devuelve null: la glosa CRUDA no se muestra (puede traer RUT,
 * números de operación…); el que llama pone "esta contraparte".
 */
import { extraerPatronContraparte } from "./aprender-regla";

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase());
}

export function contraparteVisible(glosa: string | null | undefined): string | null {
  const g = String(glosa ?? "").trim();
  if (!g) return null;
  const p = extraerPatronContraparte(g);
  return p ? titulo(p.patron) : null;
}
