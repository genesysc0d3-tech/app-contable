-- Cambio de plan programado (modelo Anthropic/Stripe):
-- SUBIR de plan es inmediato con cobro prorrateado, pero BAJAR no cambia nada
-- hoy — el cliente ya pagó el plan caro y lo conserva hasta que venza el
-- período. Esta columna recuerda a qué plan cae en la próxima renovación;
-- el cron la lee, cobra el plan nuevo y la limpia.
alter table public.suscripciones add column if not exists plan_siguiente text references public.planes_config(codigo);
