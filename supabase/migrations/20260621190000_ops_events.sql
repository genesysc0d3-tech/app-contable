-- Observabilidad operacional interna.
-- No guardar documentos, XML, imagenes, claves, cookies, prompts completos ni raw
-- de proveedores en metadata. Esta tabla es para senales operativas sanitizadas.

create table if not exists public.ops_events (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info', 'warn', 'error', 'critical')),
  source text not null,
  event_name text not null,
  cuenta_id uuid references public.cuentas(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete set null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  resource_type text,
  resource_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ops_events_created
  on public.ops_events(created_at desc);

create index if not exists idx_ops_events_severity_created
  on public.ops_events(severity, created_at desc);

create index if not exists idx_ops_events_source_created
  on public.ops_events(source, created_at desc);

create index if not exists idx_ops_events_cuenta_created
  on public.ops_events(cuenta_id, created_at desc);

create index if not exists idx_ops_events_empresa_created
  on public.ops_events(empresa_id, created_at desc);

alter table public.ops_events enable row level security;
