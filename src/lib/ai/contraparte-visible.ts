/**
 * Nombre legible de la contraparte a partir de una glosa VIVA de la cartola
 * ("TRANSFERENCIA DE JUAN PEREZ" → "Juan Perez"). Lo usan "Lo que aprendí" y los avisos
 * de Check. Nunca sale del nombre de la regla (que ya no lleva al tercero).
 */
import { extraerPatronContraparte } from "./aprender-regla";

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase());
}

export function contraparteVisible(glosa: string | null | undefined): string | null {
  const g = String(glosa ?? "").trim();
  if (!g) return null;
  const p = extraerPatronContraparte(g);
  if (p) return titulo(p.patron);
  return g.length > 48 ? `${g.slice(0, 47)}…` : g;
}
