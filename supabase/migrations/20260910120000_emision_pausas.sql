-- KILL SWITCH de emisión (tanda 1 RPA, 2026-09-10).
--
-- Hasta hoy no existía NINGÚN freno remoto: si el SII cambia su portal, la
-- flota entera (incluidas extensiones viejas que no se pueden actualizar al
-- tiro) sigue intentando emitir contra una página que ya no calza. Toda
-- emisión —única y lote, boletas y facturas— pasa por POST /api/emision/jobs,
-- así que una fila acá frena a todos sin republicar la extensión.
--
-- Lo que NUNCA se bloquea: /api/sii-local/result, reconcile, el heartbeat
-- (PATCH) y el cierre (DELETE). Un folio REAL ya emitido siempre se guarda.
--
-- `carril`: 'boletas' (39/41), 'facturas' (33/34) o 'todo'.
-- `origen`: 'manual' (operador desde /dev) o 'auto' (umbral de anclas caídas
-- en cambio-sii). `excepto_empresas` deja emitir a empresas puntuales (p. ej.
-- la del socio para probar el arreglo mientras el resto sigue pausado).
-- Una pausa "vive" mientras activo = true y hasta > now(): vence sola.
--
-- RLS habilitado SIN policies: solo service role la lee y la escribe. El
-- cliente jamás la ve; el copy humano lo arma el server.

create table if not exists public.emision_pausas (
  id uuid primary key default gen_random_uuid(),
  carril text not null check (carril in ('boletas', 'facturas', 'todo')),
  activo boolean not null default true,
  motivo_interno text,
  hasta timestamptz not null,
  excepto_empresas uuid[] not null default '{}',
  origen text not null check (origen in ('manual', 'auto')),
  creado_por text,
  created_at timestamptz default now()
);

-- La consulta del gate es siempre "activo = true and hasta > now()".
create index if not exists idx_emision_pausas_activo_hasta
  on public.emision_pausas (activo, hasta);

alter table public.emision_pausas enable row level security;

-- DOWN (patrón del repo: archivo hermano 20260910120000_emision_pausas_DOWN.sql):
--   drop index if exists public.idx_emision_pausas_activo_hasta;
--   drop table if exists public.emision_pausas;
