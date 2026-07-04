-- Base de cobro (planes configurables + suscripciones + refills + pagos
-- agnósticos de pasarela) y vinculación Telegram. Contrato compartido de la
-- tanda de 4 agentes (2026-06-13). Todas las tablas se operan vía service
-- role desde el server: RLS habilitado sin políticas de escritura.

-- ── Planes configurables: cambiar precios/cuotas/trial = editar fila ──
create table if not exists public.planes_config (
  codigo text primary key,                  -- 'start' | 'pro' | 'business'
  nombre text not null,
  uf_mensual numeric(8,2) not null,
  cuota_masivas integer not null,
  ruts_incluidos integer not null default 1,
  uf_rut_adicional numeric(8,2) not null default 0,
  refill_boletas integer not null default 500,
  refill_clp_neto integer not null default 22500,
  trial_dias integer not null default 3,
  trial_boletas integer not null default 100,
  features jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── Suscripciones (proveedor-agnóstico; MP primero) ──
create table if not exists public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  plan_codigo text not null references public.planes_config(codigo),
  proveedor text not null default 'mercadopago',   -- mercadopago | global66 | manual
  proveedor_ref text,                              -- preapproval_id u homólogo
  estado text not null default 'pendiente',        -- pendiente|activa|pausada|morosa|cancelada
  clp_ultimo_cobro integer,
  periodo_hasta date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_suscripciones_empresa on public.suscripciones(empresa_id);
create index if not exists idx_suscripciones_proveedor_ref on public.suscripciones(proveedor_ref);

-- ── Recargas de cuota masiva (compradas o de cortesía) ──
create table if not exists public.refills (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  periodo text not null,                           -- 'YYYY-MM'
  boletas integer not null,
  origen text not null default 'mercadopago',      -- mercadopago | cortesia
  proveedor_ref text,
  created_at timestamptz not null default now()
);
create index if not exists idx_refills_empresa_periodo on public.refills(empresa_id, periodo);

-- ── Registro de pagos agnóstico de pasarela ──
create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  proveedor text not null,                         -- mercadopago | global66
  proveedor_ref text,
  tipo text not null,                              -- suscripcion | refill
  monto_clp integer,
  estado text not null,                            -- aprobado | rechazado | pendiente
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_pagos_proveedor_ref on public.pagos(proveedor_ref);

-- ── Telegram: vinculación bot ↔ empresa ──
create table if not exists public.telegram_chats (
  chat_id bigint primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid references public.usuarios(id) on delete set null,
  vinculado_at timestamptz not null default now(),
  activo boolean not null default true
);
create index if not exists idx_telegram_chats_empresa on public.telegram_chats(empresa_id);

create table if not exists public.telegram_link_tokens (
  token text primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ── Trial por empresa (3 días / 100 boletas; parte al primer uso) ──
alter table public.empresas add column if not exists trial_inicio timestamptz;

-- ── RLS: deny-all para anon/authenticated (server-only via service role),
--    salvo lectura pública de planes (es info de pricing) ──
alter table public.planes_config enable row level security;
alter table public.suscripciones enable row level security;
alter table public.refills enable row level security;
alter table public.pagos enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.telegram_link_tokens enable row level security;

drop policy if exists planes_config_read on public.planes_config;
create policy planes_config_read on public.planes_config
  for select to authenticated using (true);

-- ── Seed: los planes decididos (UF viva se aplica en runtime) ──
insert into public.planes_config
  (codigo, nombre, uf_mensual, cuota_masivas, ruts_incluidos, uf_rut_adicional, refill_boletas, refill_clp_neto, trial_dias, trial_boletas, features)
values
  ('start', 'Start', 0.5, 300, 1, 0, 500, 22500, 3, 100,
   '["Emisión masiva","Boletas únicas ilimitadas","Historial básico","Descarga PDF","REFILL disponible"]'::jsonb),
  ('pro', 'Pro', 1.0, 1000, 1, 0, 500, 22500, 3, 100,
   '["Emisión masiva","Boletas únicas ilimitadas","Historial completo","Descarga PDF","Vista de ventas","REFILL disponible"]'::jsonb),
  ('business', 'Business', 2.0, 3000, 3, 0.5, 500, 22500, 3, 100,
   '["Todo lo del Pro","3 RUTs incluidos · +0,5 UF c/u extra","Reportes consolidados","REFILL disponible","Prioridad en soporte"]'::jsonb)
on conflict (codigo) do nothing;
