/**
 * Una sola vez cada documento (gana el primero). La mesa vio la misma cartola
 * dos veces en la lista (warning de React "two children with the same key"):
 * un documento repetido se pintaba doble y el visor podía tomar cualquiera.
 */
export function sinDocsRepetidos<T extends { id: string }>(docs: T[]): T[] {
  const vistos = new Set<string>();
  return docs.filter((d) => (vistos.has(d.id) ? false : (vistos.add(d.id), true)));
}
