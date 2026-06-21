-- Reserva central de folios para SimpleAPI local.
-- La extension puede tener CAF/contador local, pero el folio a usar lo decide
-- el backend por empresa + tipo_dte + job_id.

create table if not exists public.folio_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo_dte integer not null check (tipo_dte in (33, 34, 39, 41)),
  folio integer not null check (folio > 0),
  job_id text not null references public.emision_jobs(job_id) on delete cascade,
  estado text not null default 'reservado'
    check (estado in ('reservado', 'generado', 'usado', 'liberado', 'fallido', 'vencido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (job_id)
);

create unique index if not exists folio_reservas_folio_activo_uniq
  on public.folio_reservas (empresa_id, tipo_dte, folio)
  where estado <> 'liberado';

create index if not exists folio_reservas_empresa_tipo_idx
  on public.folio_reservas (empresa_id, tipo_dte, folio desc);

create index if not exists folio_reservas_job_idx
  on public.folio_reservas (job_id);

alter table public.folio_reservas enable row level security;

drop policy if exists "folio_reservas_select_mi_cuenta" on public.folio_reservas;
create policy "folio_reservas_select_mi_cuenta"
  on public.folio_reservas
  for select
  using (
    exists (
      select 1
      from public.emision_jobs ej
      join public.cuenta_usuarios cu on cu.cuenta_id = ej.cuenta_id
      where ej.job_id = folio_reservas.job_id
        and cu.usuario_id = auth.uid()
        and cu.activo = true
    )
  );
