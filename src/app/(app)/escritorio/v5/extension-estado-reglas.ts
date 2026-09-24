// Reglas puras del chequeo de la extensión (sin imports: vitest las corre solo).
export type EstadoExtension = "checking" | "ready" | "missing";

/**
 * Reglas puras del chequeo (testeadas aparte). Incidente 2026-09-24: el chip de
 * la barra mostraba "v0.2.3" con la 0.2.4 instalada, y a una clienta le mostraba
 * ✕ mientras emitía. Causa: una vez "ready" el hook NUNCA volvía a preguntar —
 * Chrome actualiza la extensión de fondo sin recargar la pestaña, y si se
 * desactiva el ✓ queda pegado. Ahora se re-pregunta también estando ready.
 */
export const PING_TIMEOUT_MS = 3000; // un service worker MV3 frío tarda >1,2 s en contestar
export const POLL_READY_MS = 60_000;
export function delayDePolling(status: EstadoExtension, hayBoveda: boolean | null, msDesdeInicio: number): number {
  if (status !== "ready" || hayBoveda === false) return msDesdeInicio < 60_000 ? 2500 : 15_000;
  return POLL_READY_MS;
}
/** Qué estado queda tras un ping sin respuesta. `ready` cae a `missing` solo al
 *  2º silencio seguido (uno solo puede ser un service worker despertando). */
export function estadoTrasSilencio(status: EstadoExtension, silenciosSeguidos: number): EstadoExtension {
  if (status === "checking") return "missing";
  if (status === "ready") return silenciosSeguidos >= 2 ? "missing" : "ready";
  return status;
}
