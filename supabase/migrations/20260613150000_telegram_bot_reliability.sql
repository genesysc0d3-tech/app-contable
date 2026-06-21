-- Persistencia conversacional del bot de Telegram.
-- Server-only via service role; cada operación debe filtrar por empresa_id.

create table if not exists public.telegram_propuesta_messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      bigint not null references public.telegram_chats(chat_id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  documento_id uuid references public.documentos_subidos(id) on delete cascade,
  propuesta_id uuid references public.propuestas_ia(id) on delete set null,
  message_id   bigint not null,
  kind         text not null default 'propuesta', -- propuesta | salida | duplicado | estado
  estado       text not null default 'activo',    -- activo | aprobado | descartado | reemplazado
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (chat_id, message_id)
);

create index if not exists telegram_propuesta_messages_empresa_idx
  on public.telegram_propuesta_messages (empresa_id, created_at desc);
create index if not exists telegram_propuesta_messages_propuesta_idx
  on public.telegram_propuesta_messages (propuesta_id);

create table if not exists public.telegram_duplicate_actions (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  documento_id  uuid not null references public.documentos_subidos(id) on delete cascade,
  fingerprint   text not null,
  estado        text not null default 'pendiente', -- pendiente | confirmando | procesando | aceptado | descartado
  detalle       jsonb not null,
  movimiento_id uuid references public.movimientos_raw(id) on delete set null,
  propuesta_id  uuid references public.propuestas_ia(id) on delete set null,
  message_id    bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (empresa_id, documento_id, fingerprint)
);

create index if not exists telegram_duplicate_actions_empresa_idx
  on public.telegram_duplicate_actions (empresa_id, created_at desc);

create table if not exists public.telegram_audit_events (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  chat_id      bigint,
  documento_id uuid references public.documentos_subidos(id) on delete set null,
  propuesta_id uuid references public.propuestas_ia(id) on delete set null,
  action       text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists telegram_audit_events_empresa_idx
  on public.telegram_audit_events (empresa_id, created_at desc);

alter table public.telegram_propuesta_messages enable row level security;
alter table public.telegram_duplicate_actions enable row level security;
alter table public.telegram_audit_events enable row level security;
