// Lectura COMPLETA de un SELECT a través de PostgREST.
//
// PostgREST corta cada respuesta en su max-rows (1000 en este proyecto) SIN avisar:
// ni error, ni header, solo menos filas. Un `.limit(2000)` no lo evita. Cazado en
// prod (sept 2026): dos empresas con 1437 y 1188 boletas en el mes → el total de
// ventas salía subdeclarado. Toda suma/conteo que deba ser EXACTO pasa por acá.
//
// La consulta que se pasa DEBE llevar un `.order(...)` estable (idealmente por id):
// sin orden, Postgres puede devolver páginas solapadas o con huecos.

/** max-rows de PostgREST del proyecto: una página más corta que esto = última. */
export const PAGINA_POSTGREST = 1000;

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface ResultadoPaginado<T> {
  data: T[];
  error: { message: string } | null;
  /** true si se alcanzó el tope de páginas (quedaron filas sin leer). */
  truncado: boolean;
}

/**
 * Pide páginas `[desde, hasta]` (inclusivo, como `.range()`) hasta que una venga
 * corta. `topePaginas` es un cinturón contra un bucle desbocado: al alcanzarlo se
 * devuelve lo leído con `truncado: true` (que el llamador lo diga, nunca mentir).
 */
export async function traerTodasLasFilas<T>(
  pagina: (desde: number, hasta: number) => Pagina<T>,
  opts: { tamano?: number; topePaginas?: number } = {},
): Promise<ResultadoPaginado<T>> {
  const tamano = opts.tamano ?? PAGINA_POSTGREST;
  const topePaginas = opts.topePaginas ?? 50;
  const data: T[] = [];
  for (let n = 0; n < topePaginas; n++) {
    const desde = n * tamano;
    const { data: filas, error } = await pagina(desde, desde + tamano - 1);
    if (error) return { data, error, truncado: false };
    const lote = filas ?? [];
    data.push(...lote);
    if (lote.length < tamano) return { data, error: null, truncado: false };
  }
  return { data, error: null, truncado: true };
}
