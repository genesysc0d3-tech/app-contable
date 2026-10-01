// URL de la mesa al cambiar boleta ↔ factura (bug fundador 2026-10-01).
//
// El conmutador navegaba a `/massdte?mesa=X` a secas: sin date/month/view la página
// vuelve a "hoy" en vista día, y el usuario que estaba mirando otra fecha aparecía
// de golpe en hoy. Se conserva el rango del calendario de la URL ACTUAL (que
// MesaController mantiene al día con replaceState al navegar).

const PARAMS_DEL_RANGO = ["date", "month", "view"] as const;

export function hrefCambioMesa(searchActual: string, destino: "boleta" | "factura"): string {
  const actual = new URLSearchParams(searchActual);
  const qs = new URLSearchParams();
  for (const k of PARAMS_DEL_RANGO) {
    const v = actual.get(k);
    if (v) qs.set(k, v);
  }
  qs.set("mesa", destino);
  return `/massdte?${qs.toString()}`;
}

/** search de la URL vigente (vacío en el server: el popup solo se pinta en el cliente). */
export function searchActual(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
