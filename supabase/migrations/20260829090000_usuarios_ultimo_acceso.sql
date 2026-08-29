-- Último acceso del usuario, para cerrar la sesión por INACTIVIDAD.
--
-- Decisión del fundador (2026-08-29): no un tope absoluto, sino inactividad.
-- "La sesión caduca si no está online. Ojalá un contador entre semanalmente. Si
-- está activo no se hace nada; solo si pasaron los 7 días y quiere acceder, lo
-- manda a login y ya."
--
-- Por qué importa: la bóveda SII de la extensión se abre con la sesión de la
-- app. Sin este tope la sesión no caducaba NUNCA (sessions_timebox e
-- inactivity_timeout de Supabase están en 0 y son del plan Pro, que no tenemos).
--
-- La escribe el middleware, como mucho una vez cada 30 min: en cada request
-- sería una escritura por página y no aporta nada.
alter table public.usuarios
  add column if not exists ultimo_acceso timestamptz;

comment on column public.usuarios.ultimo_acceso is
  'Ultima vez que el usuario tocó la app. Alimenta el tope de sesión por inactividad (lib/auth/edad-sesion.ts): si pasan 7 días sin volver, la sesión se cierra y hay que entrar de nuevo. El middleware la refresca como mucho cada 30 min para no escribir en cada request.';
