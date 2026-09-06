-- DOWN de 20260906200000_team_mensajes.sql
-- Destruye TODOS los mensajes del team (respaldar antes: `select * from public.team_mensajes`).
drop policy if exists team_mensajes_select on public.team_mensajes;
drop table if exists public.team_mensajes;
