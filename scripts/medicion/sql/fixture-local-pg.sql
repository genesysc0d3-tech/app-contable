-- Fixture MÍNIMO para probar la migración 20261004160000 en un Postgres local
-- desechable (Mac mini), sin Supabase. Reproduce solo lo que la migración toca:
-- roles anon/authenticated/service_role, auth.uid(), y las tablas con sus FK reales
-- (empresas → documentos_subidos → movimientos_raw → propuestas_ia, todo CASCADE,
-- igual que 20260410_schema_base.sql). NO es el esquema completo.
-- Lo usa scripts/medicion/probar-migracion-local.sh.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null default 'EMPRESA PRUEBA',
  rut text not null default '76.000.000-0',
  tipo_contribuyente text not null default 'afecto',
  created_at timestamptz not null default now()
);
create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  empresa_id uuid references public.empresas(id) on delete cascade
);
create table public.cuentas (id uuid primary key default gen_random_uuid());
create table public.cuenta_usuarios (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  activo boolean not null default true
);
create table public.cuenta_empresas (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  activa boolean not null default true
);
create table public.documentos_subidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  estado text not null default 'procesado',
  mesa text not null default 'boleta',
  created_at timestamptz not null default now()
);
create table public.movimientos_raw (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento_id uuid not null references public.documentos_subidos(id) on delete cascade,
  fecha date not null default current_date,
  descripcion text not null default 'TRANSF DE X',
  monto numeric not null default 1000,
  tipo_flujo text not null default 'entrada',
  created_at timestamptz not null default now()
);
create index on public.movimientos_raw (documento_id);
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade
);
create table public.clasificacion_reglas (id uuid primary key default gen_random_uuid());
create table public.transacciones (id uuid primary key default gen_random_uuid());
create table public.propuestas_ia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  movimiento_id uuid not null references public.movimientos_raw(id) on delete cascade,
  tipo_propuesto text not null,
  confianza numeric,
  monto_neto numeric,
  iva numeric,
  total numeric,
  receptor_nombre text,
  receptor_rut text,
  cliente_id uuid references public.clientes(id) on delete set null,
  regla_id uuid references public.clasificacion_reglas(id) on delete set null,
  transaccion_id uuid references public.transacciones(id) on delete set null,
  notas text,
  fuente_clasificacion text,
  estado text not null default 'pendiente',
  tipo_dte smallint check (tipo_dte is null or tipo_dte in (33, 34, 39, 41, 61)),
  mesa text not null default 'boleta',
  created_at timestamptz not null default now()
);
create index on public.propuestas_ia (empresa_id, estado);
create index on public.propuestas_ia (movimiento_id);
alter table public.propuestas_ia enable row level security;
alter table public.propuestas_ia replica identity full;
create policy propuestas_todo on public.propuestas_ia for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.propuestas_ia to authenticated, service_role;
grant select, insert, update, delete on public.movimientos_raw, public.empresas, public.documentos_subidos to service_role;
