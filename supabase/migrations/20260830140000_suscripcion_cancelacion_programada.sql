-- Cancelar el plan desde la app.
--
-- Hasta hoy la página de planes decía «cancela cuando quieras» y no existía
-- ningún botón: había que escribir a soporte. En Chile, si contrataste por
-- internet tienes que poder terminar por internet y con la misma facilidad
-- (Ley 19.496). Prometerlo sin tenerlo era lo peor de los dos mundos.
--
-- Se cancela AL TERMINAR EL PERÍODO, no al instante: el mes ya está pagado y
-- quitarlo sería quedarse con la plata y el servicio. Mismo patrón que el
-- downgrade programado (`plan_siguiente`), que ya vive en esta tabla: se marca
-- la intención y el cron la ejecuta cuando corresponde.
--
-- Mientras la marca está puesta la suscripción sigue 'activa' a propósito —
-- `entitlements` la lee así y el cliente conserva lo que compró—. El cron la
-- pasa a 'cancelada' recién cuando llega la fecha, sin cobrar.
alter table public.suscripciones
  add column if not exists cancela_al_terminar boolean not null default false;

comment on column public.suscripciones.cancela_al_terminar is
  'El cliente pidió cancelar. Sigue activa hasta periodo_hasta (ya lo pagó); el cron de renovación no la cobra y la cierra ese día. Se puede revertir mientras no llegue la fecha.';
