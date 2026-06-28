import type { MovimientoCorrelacionable } from "@/lib/intermediario/correlacion";

/** Ventana de consulta (epoch ms, UTC). */
export interface RangoConsulta {
  desdeMs: number;
  hastaMs: number;
}

/** Credenciales READ-ONLY que entrega el cliente para conectar una fuente. */
export interface CredencialesFuente {
  apiKey?: string;
  apiSecret?: string;
  [extra: string]: string | undefined;
}

/**
 * Contrato de un adaptador de fuente ("cada fuente = una cartola").
 *
 * Para sumar una API nueva (otro exchange de cripto, MercadoPago, etc.):
 *   1. creá `src/lib/sources/<id>.ts` que exporte un `SourceAdapter`,
 *   2. registralo en `src/lib/sources/index.ts`.
 * Nada más cambia: el motor de cruce (`intermediario/correlacion.ts`) consume
 * `MovimientoCorrelacionable`, agnóstico de la fuente. Binance es la implementación
 * de referencia (`sources/binance.ts`).
 */
export interface SourceAdapter {
  /** Id estable de la fuente (= `documentos_subidos.fuente_datos`). */
  readonly id: string;
  /** Nombre legible para la UI de conexión. */
  readonly nombre: string;
  /** Credenciales que pide al cliente, p.ej. ["apiKey", "apiSecret"]. */
  readonly credencialesRequeridas: readonly string[];
  /**
   * Trae los movimientos de la ventana ya NORMALIZADOS a MovimientoCorrelacionable,
   * listos para el motor de cruce. La credencial es read-only y la provee el cliente.
   */
  fetchMovimientos(cred: CredencialesFuente, rango: RangoConsulta): Promise<MovimientoCorrelacionable[]>;
}
