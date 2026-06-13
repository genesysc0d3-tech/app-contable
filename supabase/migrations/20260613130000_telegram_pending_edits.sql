-- Estado de edición pendiente del bot de Telegram.
-- Cuando el usuario toca "editar campo X" de una propuesta, guardamos qué
-- campo está editando para ese chat; su próximo mensaje de texto se toma como
-- el nuevo valor. Un pending por chat (PK) — edita un campo a la vez.
create table if not exists public.telegram_pending_edits (
  chat_id      bigint primary key,
  propuesta_id uuid not null references public.propuestas_ia(id) on delete cascade,
  campo        text not null,
  message_id   bigint,            -- mensaje "boleta" a editar cuando llegue el valor
  created_at   timestamptz not null default now()
);

-- Solo el service role (webhook) accede; nunca clientes con anon/auth.
alter table public.telegram_pending_edits enable row level security;
