-- Telegram Business multiempresa: no descargar ni procesar comprobantes hasta
-- que el usuario elija la empresa destino. Se guarda solo el file_id de
-- Telegram y expira rapido.

create table if not exists public.telegram_comprobante_pendientes (
  token text primary key,
  chat_id bigint not null references public.telegram_chats(chat_id) on delete cascade,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_origen_id uuid not null references public.empresas(id) on delete cascade,
  selected_empresa_id uuid references public.empresas(id) on delete set null,
  file_id text not null,
  file_size integer,
  received_at integer,
  opciones jsonb not null default '[]'::jsonb,
  message_id bigint,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmando', 'procesando', 'completado', 'fallido', 'expirado', 'cancelado')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_comprobante_pendientes_chat_idx
  on public.telegram_comprobante_pendientes(chat_id, estado, expires_at desc);

create index if not exists telegram_comprobante_pendientes_cuenta_idx
  on public.telegram_comprobante_pendientes(cuenta_id, created_at desc);

alter table public.telegram_comprobante_pendientes enable row level security;
