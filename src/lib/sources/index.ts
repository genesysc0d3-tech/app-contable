import type { SourceAdapter } from "./types";
import { binanceAdapter } from "./binance";

/**
 * Registro de adaptadores de fuente. Para sumar una API nueva (otro exchange,
 * MercadoPago, etc.): implementá un SourceAdapter en su archivo y agregalo acá.
 * El resto del sistema (motor de cruce) no cambia.
 */
export const SOURCE_ADAPTERS: Record<string, SourceAdapter> = {
  [binanceAdapter.id]: binanceAdapter,
};

export function getSourceAdapter(id: string): SourceAdapter | null {
  return SOURCE_ADAPTERS[id] ?? null;
}

export function listSourceAdapters(): SourceAdapter[] {
  return Object.values(SOURCE_ADAPTERS);
}

export type { SourceAdapter, CredencialesFuente, RangoConsulta } from "./types";
