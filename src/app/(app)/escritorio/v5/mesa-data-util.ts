/**
 * Una sola vez cada documento (gana el primero). Defensa en profundidad: el
 * warning "two children with the same key <id de cartola>" NO venía de datos
 * repetidos sino de AtribucionDoc y VeredictoCartola, hermanos con la misma key
 * (arreglado en MesaTab). Esto solo evita pintar doble si algún día llega uno.
 */
export function sinDocsRepetidos<T extends { id: string }>(docs: T[]): T[] {
  const vistos = new Set<string>();
  return docs.filter((d) => (vistos.has(d.id) ? false : (vistos.add(d.id), true)));
}
