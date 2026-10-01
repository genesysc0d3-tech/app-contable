-- DOWN de 20261001120000_avisos_app.sql
--
-- LO QUE DESTRUYE: todos los avisos escritos desde /dev y el registro de quién
-- vio cada uno (avisos_vistos). Respaldar antes si importa:
--   copy (select * from public.avisos_app) to stdout with csv header;
--   copy (select * from public.avisos_vistos) to stdout with csv header;
-- La app sigue funcionando sin estas tablas (fail-safe: no muestra avisos).

drop policy if exists avisos_vistos_marcar_propios on public.avisos_vistos;
drop policy if exists avisos_vistos_lectura_propios on public.avisos_vistos;
drop policy if exists avisos_app_lectura_vigentes on public.avisos_app;

drop table if exists public.avisos_vistos;
drop table if exists public.avisos_app;
