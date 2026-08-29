/**
 * Tope de edad de la sesión.
 *
 * POR QUÉ EXISTE (2026-08-28): la bóveda SII de la extensión se abre con DOS
 * mitades — el cifrado local y una llave que el servidor entrega solo a la
 * sesión iniciada. Ese diseño es sólido, pero su seguridad es exactamente la de
 * la sesión… y la sesión no caducaba NUNCA: `sessions_timebox` y
 * `sessions_inactivity_timeout` estaban en 0 y son controles del plan Pro de
 * Supabase, que este proyecto no tiene. Resultado: quien tuviera acceso
 * sostenido a ese Chrome podía emitir documentos tributarios con la Clave
 * Tributaria del cliente, para siempre, sin conocerla.
 *
 * Como el interruptor de Supabase no está disponible, la regla vive acá. La
 * diferencia importa: el de Supabase es insaltable y este hay que acordarse de
 * llamarlo. Por eso se llama desde el GUARD compartido (lo hereda toda ruta que
 * lo use, incluida la de la bóveda) y desde el middleware, y hay un test que
 * falla si alguno deja de invocarlo. Si algún día se paga el plan Pro, esto se
 * reemplaza por la configuración y se borra.
 *
 * DE DÓNDE SALE LA EDAD: del propio access token, sin consultar la base. El JWT
 * de Supabase trae `amr` (authentication methods references) con el timestamp
 * del momento en que la persona SE AUTENTICÓ de verdad. Ese sello no se mueve
 * cuando el token se renueva cada hora — que es justo por lo que `iat` no
 * sirve para esto.
 */

/** 30 días. Cabe el ciclo mensual de una cartola sin obligar a re-entrar al medio. */
export const EDAD_MAXIMA_SESION_MS = 30 * 24 * 60 * 60 * 1000;

type Payload = {
  amr?: unknown;
  iat?: unknown;
};

/** Decodifica el payload del JWT SIN verificar firma. */
function leerPayload(accessToken: string): Payload | null {
  const partes = accessToken.split(".");
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return payload && typeof payload === "object" ? (payload as Payload) : null;
  } catch {
    return null;
  }
}

/**
 * Momento (ms epoch) en que la persona se autenticó, o null si no se puede
 * saber. Se toma el `amr` MÁS ANTIGUO: si alguien sumó un segundo factor
 * después, la sesión sigue siendo tan vieja como su primer login.
 */
export function inicioDeSesion(accessToken: string | null | undefined): number | null {
  if (!accessToken) return null;
  const payload = leerPayload(accessToken);
  if (!payload) return null;

  if (Array.isArray(payload.amr)) {
    const sellos = payload.amr
      .map((m) => (m && typeof m === "object" ? (m as { timestamp?: unknown }).timestamp : null))
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
    if (sellos.length > 0) return Math.min(...sellos) * 1000;
  }
  return null;
}

/**
 * ¿La sesión pasó el tope? FAIL-CLOSED a medias, a propósito:
 * - Si el token trae `amr`, se compara y se decide con certeza.
 * - Si NO se puede leer la edad, se responde `false` (no vencida). Cerrar acá
 *   dejaría a todo el mundo afuera ante un cambio de formato del token de
 *   Supabase, y esta regla es una segunda muralla, no la autenticación: quien
 *   llega hasta acá YA pasó `getUser()` contra el servidor de auth. Un fallo
 *   abierto devuelve el sistema al estado de ayer, no a uno peor.
 */
export function sesionVencidaPorEdad(
  accessToken: string | null | undefined,
  ahora: number = Date.now(),
): boolean {
  const inicio = inicioDeSesion(accessToken);
  if (inicio == null) return false;
  return ahora - inicio > EDAD_MAXIMA_SESION_MS;
}

/** Días que le quedan a la sesión, para poder avisar antes de que caduque. */
export function diasRestantesDeSesion(
  accessToken: string | null | undefined,
  ahora: number = Date.now(),
): number | null {
  const inicio = inicioDeSesion(accessToken);
  if (inicio == null) return null;
  const restante = EDAD_MAXIMA_SESION_MS - (ahora - inicio);
  return Math.max(0, Math.ceil(restante / (24 * 60 * 60 * 1000)));
}
