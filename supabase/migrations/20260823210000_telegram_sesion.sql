-- Bot de Telegram: sesión conversacional.
--
-- Antes el bot procesaba la foto y RECIÉN ahí preguntaba (empresa, tipo). Eso
-- obligaba a inferir qué fotos iban juntas mirando el `media_group_id` que arma
-- Telegram, que depende de si el usuario las seleccionó de una o las mandó una
-- por una — cosa que el usuario ni nota. Ahora se pregunta PRIMERO:
--
--   hola → [empresa] → [boleta|factura] → imágenes → propuesta
--
-- La sesión es el contenedor explícito de UN comprobante: todo lo que llega
-- mientras está abierta pertenece a él porque el usuario lo dijo, no porque lo
-- adivinemos. Una foto sin sesión abierta NO se procesa (ni OCR ni storage).
--
-- Una sesión viva por chat (chat_id es la PK): abrir otra reemplaza la anterior.

create table if not exists public.telegram_sesiones (
  chat_id bigint primary key references public.telegram_chats(chat_id) on delete cascade,
  token text not null,
  empresa_id uuid references public.empresas(id) on delete cascade,
  -- A qué mesa va el comprobante. 'factura' queda aceptado por el esquema desde
  -- ya (el bot lo ofrece apagado) para no necesitar otra migración el día que
  -- exista la mesa de facturas.
  mesa text check (mesa in ('boleta', 'factura')),
  estado text not null default 'eligiendo_empresa'
    check (estado in ('eligiendo_empresa', 'eligiendo_mesa', 'esperando_fotos', 'procesando')),
  -- Opciones de empresa mostradas en el teclado. El callback manda el ÍNDICE y
  -- no el uuid: la data de un callback de Telegram tope en 64 bytes y
  -- "ses:emp:<token>:<uuid>" no cabe con holgura.
  opciones jsonb not null default '[]'::jsonb,
  documento_id uuid references public.documentos_subidos(id) on delete set null,
  message_id bigint,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_sesiones_expira_idx
  on public.telegram_sesiones(expires_at);

-- Sin políticas: solo el service role del webhook la toca.
alter table public.telegram_sesiones enable row level security;
