-- Cuenta pagadora fase 1.
-- Mantiene usuarios.empresa_id como dashboard activo y no cambia RLS de datos por
-- empresa. Esta capa solo centraliza plan/cobro/equipo para Start/Pro/Business.

create table if not exists public.cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  plan_codigo text references public.planes_config(codigo),
  plan_activo boolean not null default false,
  owner_usuario_id uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cuenta_empresas (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  activa boolean not null default true,
  es_principal boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (cuenta_id, empresa_id),
  unique (empresa_id)
);

create table if not exists public.cuenta_usuarios (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  activo boolean not null default true,
  es_titular boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (cuenta_id, usuario_id)
);

create table if not exists public.cuenta_addons (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  tipo text not null check (tipo in ('empresa_adicional', 'persona_adicional', 'boletas_cartola', 'telegram')),
  cantidad integer not null default 1 check (cantidad > 0),
  periodo text,
  estado text not null default 'activo' check (estado in ('activo', 'pendiente', 'cancelado', 'moroso')),
  origen text not null default 'manual',
  proveedor_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.emision_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  provider text not null check (provider in ('mock', 'sii_local', 'simpleapi')),
  origin text not null default 'extension',
  expected_emisor_rut text,
  estado text not null default 'created' check (estado in ('created', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  estado_visible text not null default 'created',
  status_message text,
  expires_at timestamptz not null,
  locked_until timestamptz,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.emision_locks (
  cuenta_id uuid primary key references public.cuentas(id) on delete cascade,
  job_id text not null references public.emision_jobs(job_id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  provider text not null check (provider in ('mock', 'sii_local', 'simpleapi')),
  estado_visible text not null default 'running',
  locked_until timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_cuentas_owner on public.cuentas(owner_usuario_id);
create index if not exists idx_cuenta_empresas_cuenta on public.cuenta_empresas(cuenta_id) where activa;
create index if not exists idx_cuenta_usuarios_usuario on public.cuenta_usuarios(usuario_id) where activo;
create index if not exists idx_cuenta_addons_cuenta_tipo on public.cuenta_addons(cuenta_id, tipo, estado);
create index if not exists idx_emision_jobs_cuenta_estado on public.emision_jobs(cuenta_id, estado, expires_at);
create index if not exists idx_emision_jobs_empresa on public.emision_jobs(empresa_id, created_at desc);
create index if not exists idx_emision_locks_until on public.emision_locks(locked_until);

alter table public.suscripciones add column if not exists cuenta_id uuid references public.cuentas(id) on delete cascade;
alter table public.refills add column if not exists cuenta_id uuid references public.cuentas(id) on delete cascade;
alter table public.pagos add column if not exists cuenta_id uuid references public.cuentas(id) on delete set null;

create index if not exists idx_suscripciones_cuenta on public.suscripciones(cuenta_id);
create index if not exists idx_refills_cuenta_periodo on public.refills(cuenta_id, periodo);
create index if not exists idx_pagos_cuenta on public.pagos(cuenta_id);

delete from public.pagos p
using public.pagos keep
where p.proveedor_ref is not null
  and keep.proveedor_ref is not null
  and p.proveedor = keep.proveedor
  and p.proveedor_ref = keep.proveedor_ref
  and p.estado = keep.estado
  and (p.created_at > keep.created_at or (p.created_at = keep.created_at and p.id > keep.id));

delete from public.refills r
using public.refills keep
where r.proveedor_ref is not null
  and keep.proveedor_ref is not null
  and r.origen = keep.origen
  and r.proveedor_ref = keep.proveedor_ref
  and (r.created_at > keep.created_at or (r.created_at = keep.created_at and r.id > keep.id));

create unique index if not exists ux_pagos_proveedor_ref_estado
  on public.pagos(proveedor, proveedor_ref, estado)
  where proveedor_ref is not null;
create unique index if not exists ux_refills_origen_proveedor_ref
  on public.refills(origen, proveedor_ref)
  where proveedor_ref is not null;

alter table public.planes_config add column if not exists empresas_incluidas integer not null default 1;
alter table public.planes_config add column if not exists personas_incluidas integer not null default 1;
alter table public.planes_config add column if not exists telegram_comprobantes integer not null default 0;
alter table public.planes_config add column if not exists equipo boolean not null default false;
alter table public.planes_config add column if not exists multiempresa boolean not null default false;

update public.planes_config
set
  empresas_incluidas = 1,
  personas_incluidas = 1,
  telegram_comprobantes = case codigo when 'pro' then 100 when 'business' then 500 else 0 end,
  equipo = codigo = 'business',
  multiempresa = codigo = 'business',
  ruts_incluidos = 1,
  uf_rut_adicional = case codigo when 'business' then 0.5 else 0 end,
  features = case codigo
    when 'start' then '["300 boletas desde cartolas al mes","Boletas manuales ilimitadas","1 empresa","1 persona","Historial básico"]'::jsonb
    when 'pro' then '["1.000 boletas desde cartolas al mes","100 comprobantes por Telegram","Boletas manuales ilimitadas","1 empresa","Historial completo"]'::jsonb
    when 'business' then '["3.000 boletas desde cartolas al mes","500 comprobantes por Telegram","Equipo","Multiempresa","Reportes consolidados"]'::jsonb
    else features
  end,
  updated_at = now()
where codigo in ('start', 'pro', 'business');

do $$
declare
  emp record;
  usr record;
  cuenta uuid;
  owner_id uuid;
begin
  for emp in select * from public.empresas loop
    select ce.cuenta_id into cuenta
    from public.cuenta_empresas ce
    where ce.empresa_id = emp.id
    limit 1;

    if cuenta is null then
      select u.id into owner_id
      from public.usuarios u
      where u.empresa_id = emp.id
      order by u.created_at asc
      limit 1;

      insert into public.cuentas (nombre, plan_codigo, plan_activo, owner_usuario_id, created_at, updated_at)
      values (
        coalesce(nullif(emp.razon_social, ''), 'Cuenta MassDTE'),
        coalesce((select pc.codigo from public.planes_config pc where pc.codigo = nullif(emp.plan, '') limit 1), 'start'),
        coalesce(emp.plan_activo, false),
        owner_id,
        emp.created_at,
        now()
      )
      returning id into cuenta;

      insert into public.cuenta_empresas (cuenta_id, empresa_id, activa, es_principal)
      values (cuenta, emp.id, true, true)
      on conflict (empresa_id) do nothing;
    end if;

    for usr in select * from public.usuarios where empresa_id = emp.id loop
      insert into public.cuenta_usuarios (cuenta_id, usuario_id, activo, es_titular)
      values (cuenta, usr.id, not coalesce(usr.vetado, false), usr.id = owner_id)
      on conflict (cuenta_id, usuario_id) do update set
        activo = excluded.activo,
        es_titular = public.cuenta_usuarios.es_titular or excluded.es_titular;

      insert into public.usuario_empresas (usuario_id, empresa_id, rol)
      values (usr.id, emp.id, coalesce(nullif(usr.rol, ''), 'titular'))
      on conflict (usuario_id, empresa_id) do nothing;
    end loop;
  end loop;
end $$;

update public.suscripciones s
set cuenta_id = ce.cuenta_id
from public.cuenta_empresas ce
where s.cuenta_id is null
  and s.empresa_id = ce.empresa_id;

update public.refills r
set cuenta_id = ce.cuenta_id
from public.cuenta_empresas ce
where r.cuenta_id is null
  and r.empresa_id = ce.empresa_id;

update public.pagos p
set cuenta_id = ce.cuenta_id
from public.cuenta_empresas ce
where p.cuenta_id is null
  and p.empresa_id = ce.empresa_id;

create or replace function public.cuentas_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $func$
  select cuenta_id
  from public.cuenta_usuarios
  where usuario_id = auth.uid()
    and activo = true
$func$;

create or replace function public.cuenta_de_empresa(p_empresa_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $func$
  select cuenta_id
  from public.cuenta_empresas
  where empresa_id = p_empresa_id
    and activa = true
    and cuenta_id in (select public.cuentas_del_usuario())
  limit 1
$func$;

alter table public.cuentas enable row level security;
alter table public.cuenta_empresas enable row level security;
alter table public.cuenta_usuarios enable row level security;
alter table public.cuenta_addons enable row level security;
alter table public.emision_jobs enable row level security;
alter table public.emision_locks enable row level security;

drop policy if exists "miembros ven sus cuentas" on public.cuentas;
create policy "miembros ven sus cuentas" on public.cuentas
  for select using (id in (select public.cuentas_del_usuario()));

drop policy if exists "miembros ven empresas de su cuenta" on public.cuenta_empresas;
create policy "miembros ven empresas de su cuenta" on public.cuenta_empresas
  for select using (cuenta_id in (select public.cuentas_del_usuario()));

drop policy if exists "miembros ven equipo de su cuenta" on public.cuenta_usuarios;
create policy "miembros ven equipo de su cuenta" on public.cuenta_usuarios
  for select using (cuenta_id in (select public.cuentas_del_usuario()));

drop policy if exists "miembros ven addons de su cuenta" on public.cuenta_addons;
create policy "miembros ven addons de su cuenta" on public.cuenta_addons
  for select using (cuenta_id in (select public.cuentas_del_usuario()));

drop policy if exists "miembros ven jobs de su cuenta" on public.emision_jobs;
create policy "miembros ven jobs de su cuenta" on public.emision_jobs
  for select using (cuenta_id in (select public.cuentas_del_usuario()));

drop policy if exists "miembros ven locks de su cuenta" on public.emision_locks;
create policy "miembros ven locks de su cuenta" on public.emision_locks
  for select using (cuenta_id in (select public.cuentas_del_usuario()));
