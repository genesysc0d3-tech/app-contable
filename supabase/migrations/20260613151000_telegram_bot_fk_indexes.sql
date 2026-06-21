-- Índices de FKs para las tablas conversacionales de Telegram.
-- Evitan scans al borrar/actualizar documentos, propuestas o movimientos.

create index if not exists telegram_propuesta_messages_documento_idx
  on public.telegram_propuesta_messages (documento_id);

create index if not exists telegram_duplicate_actions_documento_idx
  on public.telegram_duplicate_actions (documento_id);
create index if not exists telegram_duplicate_actions_movimiento_idx
  on public.telegram_duplicate_actions (movimiento_id);
create index if not exists telegram_duplicate_actions_propuesta_idx
  on public.telegram_duplicate_actions (propuesta_id);

create index if not exists telegram_audit_events_documento_idx
  on public.telegram_audit_events (documento_id);
create index if not exists telegram_audit_events_propuesta_idx
  on public.telegram_audit_events (propuesta_id);
