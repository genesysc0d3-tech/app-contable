-- DOWN de 20260907100000_team_mensajes_objetos.sql
-- Borra los mensajes con objeto tx/boleta (no caben en la restricción vieja).
delete from public.team_mensajes where objeto_tipo in ('tx', 'boleta');
alter table public.team_mensajes drop column if exists objeto_doc_id;
alter table public.team_mensajes drop constraint if exists team_mensajes_objeto_tipo_check;
alter table public.team_mensajes
  add constraint team_mensajes_objeto_tipo_check check (objeto_tipo in ('documento'));
