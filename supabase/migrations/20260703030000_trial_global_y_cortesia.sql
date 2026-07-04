-- Trial habilitable (auditoría #4). El trial ya existe en código (metering) pero era
-- inalcanzable: el gate de plan lo bloqueaba. Ahora se ofrece según DOS interruptores:
--   1) config_global['trial_habilitado']  → trial para TODOS (oferta pública).
--   2) cuentas.trial_cortesia             → trial a una cuenta puntual ("amistad")
--      aunque el global esté apagado.
-- Disponibilidad = global OR cortesía de la cuenta. Default: global OFF (nada cambia
-- hasta que el operador lo prenda desde /dev).

-- Flags globales del operador (key-value). Sin PII.
create table if not exists public.config_global (
  clave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.config_global enable row level security;
-- Lectura para autenticados (flag no sensible, sin PII, no multi-tenant); escritura
-- solo service-role (sin policy de insert/update).
drop policy if exists "auth lee config_global" on public.config_global;
create policy "auth lee config_global" on public.config_global
  for select to authenticated using (true);

insert into public.config_global (clave, valor)
  values ('trial_habilitado', 'false'::jsonb)
  on conflict (clave) do nothing;

-- Trial de cortesía por cuenta (para "amistades" con el global apagado).
alter table public.cuentas add column if not exists trial_cortesia boolean not null default false;
