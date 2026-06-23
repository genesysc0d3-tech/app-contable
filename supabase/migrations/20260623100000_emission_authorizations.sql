-- Autorizacion explicita y versionada antes de crear jobs de emision real.
-- No guarda payload tributario, XML, claves ni evidencia de la emision.

create table if not exists public.emission_authorizations (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  provider text not null check (provider in ('sii_local', 'simpleapi')),
  legal_version text not null,
  source text not null default 'emision_directa',
  metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emission_authorizations_unique unique (cuenta_id, empresa_id, usuario_id, provider, legal_version)
);

create index if not exists idx_emission_authorizations_lookup
  on public.emission_authorizations(cuenta_id, empresa_id, usuario_id, provider, legal_version)
  where revoked_at is null;

create index if not exists idx_emission_authorizations_empresa
  on public.emission_authorizations(empresa_id, accepted_at desc);

alter table public.emission_authorizations enable row level security;

drop policy if exists "miembros ven autorizaciones de su cuenta" on public.emission_authorizations;
create policy "miembros ven autorizaciones de su cuenta" on public.emission_authorizations
  for select using (
    usuario_id = auth.uid()
    and cuenta_id in (select public.cuentas_del_usuario())
  );

drop policy if exists "usuarios crean autorizaciones propias" on public.emission_authorizations;
create policy "usuarios crean autorizaciones propias" on public.emission_authorizations
  for insert with check (
    usuario_id = auth.uid()
    and cuenta_id in (select public.cuentas_del_usuario())
  );
