-- DOWN de 20260910120000_emision_pausas.sql
-- Borra el kill switch entero. Las pausas que hubiera (activas o vencidas) se
-- pierden; el historial de activar/levantar sigue en ops_events
-- (emision_pausa_on / emision_pausa_off), que no se toca.
drop index if exists public.idx_emision_pausas_activo_hasta;
drop table if exists public.emision_pausas;
