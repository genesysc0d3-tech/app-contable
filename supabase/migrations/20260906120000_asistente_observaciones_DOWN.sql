-- Vuelta atrás de 20260906120000_asistente_observaciones.
--
-- La tabla es NUEVA y nada más depende de ella: borrarla no rompe la mesa, la
-- emisión ni el cobro. Lo que se pierde son las observaciones acumuladas del
-- asistente (dato de aprendizaje, no operativo). Si importan, exportar antes:
--   select * from public.asistente_observaciones order by created_at;

drop policy if exists "asistente_obs select propia empresa" on public.asistente_observaciones;
drop table if exists public.asistente_observaciones;
