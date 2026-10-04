/**
 * Compatibilidad: los tipos de propuesta viven ahora en la decisión ÚNICA
 * `@/lib/sii/destino` (reglas tributarias versionadas, dueño Matías). Este módulo
 * solo re-exporta para no romper importadores existentes.
 */
import { esExentoPorTipo } from "./destino";

export { TIPOS_PROPUESTA_EXENTOS, TIPOS_EMITIBLES } from "./destino";

/** Alias histórico de `esExentoPorTipo`. */
export function esTipoPropuestoExento(tipo: string | null | undefined): boolean {
  return esExentoPorTipo(tipo);
}
