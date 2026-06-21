-- Identidades de cobro de la empresa: cómo aparece el contribuyente en SUS
-- comprobantes (razón social, RUT, nombre personal, alias de Mercado Pago,
-- números de cuenta...). El clasificador las usa para reconocer al usuario en
-- el comprobante y deducir la dirección (entrada = la plata llega a una de sus
-- identidades). Se cargan manualmente (/config) o se aprenden al confirmar.
-- AISLADO por empresa: nunca se comparten entre cuentas.
create table if not exists public.empresa_identidades (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  valor       text not null,                       -- "Domidog spa", "77.155.156-4", "1083278555"...
  tipo        text not null default 'nombre',      -- nombre | rut | cuenta | alias
  fuente      text not null default 'manual',      -- manual | aprendida
  created_at  timestamptz not null default now(),
  unique (empresa_id, valor)
);

create index if not exists empresa_identidades_empresa_idx
  on public.empresa_identidades (empresa_id);

-- Solo service role (bot/servidor) accede; el aislamiento lo garantiza el
-- filtro por empresa_id en cada query.
alter table public.empresa_identidades enable row level security;
