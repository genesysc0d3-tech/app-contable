import type { AdapterConfig } from "./types";

/**
 * Lo que define un mapa (sin títulos ni filas de encabezado, que varían por
 * empresa). Módulo propio (sin base de datos) para que el orquestador, Check y
 * los tests lo usen sin arrastrar adapter-store.
 */
export function claveDeMapa(cfg: AdapterConfig | null | undefined): string {
  if (!cfg) return "";
  const c = cfg.columns ?? ({} as AdapterConfig["columns"]);
  return JSON.stringify([
    cfg.layout ?? "two_cols", cfg.date_format, cfg.number_format, cfg.default_tipo_flujo ?? null,
    c.fecha, c.descripcion, c.n_documento, c.cargo, c.abono, c.saldo, c.monto ?? -1, c.tipo_flujo_col ?? -1,
  ]);
}

/**
 * Check confirma el adaptador del documento solo si su mapa sigue siendo el
 * mapa con que se leyó ese documento (clave guardada en el cuadre). Documentos
 * anteriores a la clave: como antes.
 */
export function adapterSigueSiendoElDelDocumento(claveDelDocumento: string | null | undefined, configDelAdapter: AdapterConfig | null | undefined): boolean {
  return !claveDelDocumento || claveDeMapa(configDelAdapter) === claveDelDocumento;
}
