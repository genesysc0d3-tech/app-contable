/**
 * Cierre de sesión por INACTIVIDAD.
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
 * POR QUÉ INACTIVIDAD Y NO UN TOPE ABSOLUTO (decisión del fundador, 2026-08-29):
 * "la sesión caduca si no está online, ojalá un contador entre semanalmente; si
 * está activo no se hace nada, solo ocurre si pasaron los 7 días y quiere
 * acceder: lo manda a login y ya". Un tope absoluto castiga al que SÍ usa la app
 * —lo saca cada 30 días a mitad de trabajo— y no protege más: al que entra a
 * diario igual le dura para siempre. La inactividad ataca justo el caso de
 * riesgo, que es el equipo abandonado. Y volver a entrar cuesta un clic: 7 de
 * cada 11 usuarios entran con Google.
 *
 * Como el interruptor de Supabase no está disponible, la regla vive acá. La
 * diferencia importa: el de Supabase es insaltable y este hay que acordarse de
 * llamarlo. Por eso se llama desde el GUARD compartido (lo hereda toda ruta que
 * lo use, incluida la de la bóveda) y desde el middleware, y hay tests que
 * fallan si alguno deja de invocarlo. Si algún día se paga el plan Pro, esto se
 * reemplaza por la configuración y se borra.
 */

/** 7 días sin aparecer y hay que volver a entrar. */
export const INACTIVIDAD_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cada cuánto se refresca `usuarios.ultimo_acceso`. En cada request sería una
 * escritura por página cargada, y para decidir 7 días no hace falta esa
 * precisión.
 */
export const REFRESCO_ULTIMO_ACCESO_MS = 30 * 60 * 1000;

const aMs = (valor: string | Date | null | undefined): number | null => {
  if (!valor) return null;
  const t = valor instanceof Date ? valor.getTime() : Date.parse(valor);
  return Number.isFinite(t) ? t : null;
};

/**
 * ¿Pasó demasiado tiempo sin aparecer?
 *
 * FAIL-OPEN deliberado cuando no hay dato: un usuario que nunca tuvo
 * `ultimo_acceso` —los que ya existían antes de esta columna— no puede quedar
 * encerrado fuera de su cuenta por una migración. La primera visita se lo
 * escribe y desde ahí el reloj corre. Además esta es la SEGUNDA muralla: quien
 * llega hasta acá ya pasó `getUser()` contra el servidor de auth.
 */
export function sesionVencidaPorInactividad(
  ultimoAcceso: string | Date | null | undefined,
  ahora: number = Date.now(),
): boolean {
  const visto = aMs(ultimoAcceso);
  if (visto == null) return false;
  return ahora - visto > INACTIVIDAD_MAXIMA_MS;
}

/** ¿Toca escribir `ultimo_acceso`, o el último es lo bastante reciente? */
export function debeRefrescarUltimoAcceso(
  ultimoAcceso: string | Date | null | undefined,
  ahora: number = Date.now(),
): boolean {
  const visto = aMs(ultimoAcceso);
  if (visto == null) return true;
  return ahora - visto > REFRESCO_ULTIMO_ACCESO_MS;
}

/** Días que quedan antes de que caduque por inactividad. */
export function diasSinAparecerRestantes(
  ultimoAcceso: string | Date | null | undefined,
  ahora: number = Date.now(),
): number | null {
  const visto = aMs(ultimoAcceso);
  if (visto == null) return null;
  const restante = INACTIVIDAD_MAXIMA_MS - (ahora - visto);
  return Math.max(0, Math.ceil(restante / (24 * 60 * 60 * 1000)));
}
