-- Modo apuntar (fundador 2026-09-06): además del documento entero se puede
-- apuntar una tx (propuesta) o una boleta. La tx guarda también el documento
-- que la contiene, para que el salto abra la cartola y resalte la fila.
alter table public.team_mensajes
  drop constraint if exists team_mensajes_objeto_tipo_check;
alter table public.team_mensajes
  add constraint team_mensajes_objeto_tipo_check
  check (objeto_tipo is null or objeto_tipo in ('documento', 'tx', 'boleta'));
alter table public.team_mensajes
  add column if not exists objeto_doc_id uuid;
