-- Auditoría #2/#12: envenenamiento cross-tenant de parser_adapters.
-- La tabla es GLOBAL (sin empresa_id) y cualquier usuario autenticado podía
-- SOBRESCRIBIR (upsert manual, confianza 1.0) el adapter de un fingerprint que
-- comparten otros tenants → parseo con columnas mapeadas mal → montos incorrectos
-- en boletas ajenas.
--
-- Fix "first-owner-wins": se registra qué empresa creó cada adapter MANUAL. Un
-- upsert manual solo puede pisar un adapter de la MISMA empresa; los adapters de
-- otra empresa (o los heurísticos/globales, dueño null) quedan inmutables ante
-- upserts ajenos. Preserva el aprendizaje compartido (el primer mapeo válido sigue
-- beneficiando a todos) y cierra la sobre-escritura maliciosa.
alter table public.parser_adapters
  add column if not exists creado_por_empresa_id uuid references public.empresas(id) on delete set null;

comment on column public.parser_adapters.creado_por_empresa_id is
  'Empresa dueña de este adapter manual (null = heurístico/global/legacy). Un upsert manual solo puede sobrescribir filas de la misma empresa (anti-poison cross-tenant).';

create index if not exists idx_parser_adapters_creador
  on public.parser_adapters(creado_por_empresa_id);
