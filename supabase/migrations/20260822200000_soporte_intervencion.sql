-- ── Intervención de soporte con permiso del CLIENTE ──
-- El modo soporte es solo-lectura sagrado. Para intervenir (mapear columnas,
-- reprocesar, editar) el cliente autoriza con un código de 6 dígitos que nace
-- en SU canal (Telegram vinculado o banner en su app) y que él le entrega al
-- operador. Canje único → ventana de 1 hora exacta, no renovable, revocable
-- por el cliente en cualquier momento. Toda escritura durante la ventana se
-- audita en cuenta_audit_events.
--
-- El código se guarda en claro SOLO mientras la solicitud está pendiente
-- (ventana de canje de 15 min) porque el banner de la app del cliente
-- necesita mostrárselo; quien puede leer esta tabla ya es service-role.

create table if not exists public.soporte_intervenciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  operador_email text not null,
  codigo text not null,
  canal text not null default 'app',          -- 'telegram' | 'app'
  motivo text,
  creada_at timestamptz not null default now(),
  canjeable_hasta timestamptz not null,        -- creada + 15 min
  canjeada_at timestamptz,
  expira_at timestamptz,                       -- canjeada + 1 hora
  revocada_at timestamptz
);

create index if not exists idx_soporte_intervenciones_empresa
  on public.soporte_intervenciones(empresa_id, creada_at desc);

-- Server-only (service role): deny-all para anon/authenticated.
alter table public.soporte_intervenciones enable row level security;
