-- Auditoria basica por cuenta pagadora: trazabilidad, no permisos.
-- No guardar documentos, XML, imagenes, claves ni raw de proveedores.

create table if not exists public.cuenta_audit_events (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete set null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  accion text not null,
  recurso_tipo text,
  recurso_id text,
  resumen text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cuenta_audit_events_cuenta_created
  on public.cuenta_audit_events(cuenta_id, created_at desc);

create index if not exists idx_cuenta_audit_events_empresa_created
  on public.cuenta_audit_events(empresa_id, created_at desc);

alter table public.cuenta_audit_events enable row level security;

drop policy if exists "miembros ven auditoria de su cuenta" on public.cuenta_audit_events;
create policy "miembros ven auditoria de su cuenta" on public.cuenta_audit_events
for select
using (
  exists (
    select 1
    from public.cuenta_usuarios cu
    where cu.cuenta_id = cuenta_audit_events.cuenta_id
      and cu.usuario_id = auth.uid()
      and cu.activo = true
  )
);
