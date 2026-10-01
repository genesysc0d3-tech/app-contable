// Scroll de los contenedores principales. Clave estable: data-restaurar-scroll si
// el contenedor la tiene; si no, el orden entre los .r-scroll sin clave.
import type { ScrollGuardado } from "./estado-guardado";

export const SELECTOR_SCROLL = "[data-restaurar-scroll], .r-scroll";
type ElementoScroll = { scrollTop: number; scrollLeft: number; getAttribute(n: string): string | null };
type RaizScroll = { querySelectorAll(sel: string): ArrayLike<ElementoScroll> };

function conClaves(raiz: RaizScroll): Array<{ clave: string; el: ElementoScroll }> {
  const out: Array<{ clave: string; el: ElementoScroll }> = [];
  let anon = 0;
  for (const el of Array.from(raiz.querySelectorAll(SELECTOR_SCROLL))) {
    const attr = el.getAttribute("data-restaurar-scroll");
    out.push({ clave: attr ? attr : `r-scroll:${anon++}`, el });
  }
  return out;
}

export function capturarScroll(raiz: RaizScroll): ScrollGuardado[] {
  return conClaves(raiz)
    .filter(({ el }) => el.scrollTop > 0 || el.scrollLeft > 0)
    .map(({ clave, el }) => ({ clave, top: el.scrollTop, left: el.scrollLeft }));
}

/** Aplica lo guardado; devuelve cuántos quedaron cortos (la lista aún no creció). */
export function aplicarScroll(raiz: RaizScroll, guardados: ScrollGuardado[]): number {
  const mapa = new Map(conClaves(raiz).map((x) => [x.clave, x.el]));
  let pendientes = 0;
  for (const g of guardados) {
    const el = mapa.get(g.clave);
    if (!el) { pendientes++; continue; }
    el.scrollTop = g.top;
    el.scrollLeft = g.left;
    if (Math.abs(el.scrollTop - g.top) > 2) pendientes++;
  }
  return pendientes;
}
