/**
 * Cadencia del sondeo del candado de emisión (`GET /api/emision/jobs`).
 *
 * Incidente 2026-09-25: Vercel avisó 3h58m/4h de CPU activa del mes (plan gratis;
 * al 100% pausa la app). En 12 h, `/api/emision/jobs` llevaba 8.2K llamadas y 5 de
 * los 8 minutos de CPU del proyecto: el hook sondeaba cada 5 s mientras
 * `business_mode` fuera true — y toda cuenta Business lo es — aunque la pestaña
 * estuviera en segundo plano. Una pestaña olvidada abierta = 17K golpes al día.
 *
 * Reglas (puras, testeables sin DOM):
 *  - Pestaña oculta → NO se sondea (null). Al volver visible se refresca al tiro
 *    (visibilitychange/focus), que es justo cuando el usuario puede ver un aviso.
 *  - Candado activo (alguien emitiendo) → cadencia viva (5 s): el estado importa.
 *  - En reposo → 60 s. `business_mode` a secas ya no es motivo de cadencia viva.
 */
export const CADENCIA_VIVA_MS = 5000;
export const CADENCIA_REPOSO_MS = 60000;

export function proximaEsperaMs(input: {
  locked?: boolean | null;
  oculta: boolean;
  intervalMs?: number;
}): number | null {
  if (input.oculta) return null;
  if (input.locked) return Math.max(1000, input.intervalMs ?? CADENCIA_VIVA_MS);
  return Math.max(input.intervalMs ?? CADENCIA_VIVA_MS, CADENCIA_REPOSO_MS);
}
