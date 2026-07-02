-- 20260629: Cierra fuga cross-tenant (bloque A — seguridad pre-beta)
--
-- audit_chunks, parser_logs y parser_adapters tenían una policy de SELECT PÚBLICA
-- (qual = true, rol public) => cualquier usuario logueado podía leer, vía PostgREST con
-- la anon key, la data de TODOS. audit_chunks guarda chunk_input (texto CRUDO de las
-- cartolas bancarias) y mistral_response: una fuga de datos personales/financieros.
--
-- Todo el acceso de la app a estas tablas es vía SERVICE ROLE (bypassa RLS):
--   - audit_chunks      -> src/lib/ai/processor.ts (REST con SUPABASE_SERVICE_ROLE_KEY)
--   - parser_logs       -> src/lib/parsers/adapter-store.ts (service role)
--   - parser_adapters   -> adapter-store.ts + src/app/api/guardar-formato/route.ts (service role)
-- Ningún componente cliente ('use client') las lee. Por eso quitar el SELECT público
-- NO rompe nada: el service role sigue leyendo/escribiendo todo, y los usuarios dejan
-- de poder ver data ajena.
--
-- Resultado: RLS activo + 0 policies => acceso denegado salvo service role.

alter table public.audit_chunks    enable row level security;
alter table public.parser_logs     enable row level security;
alter table public.parser_adapters enable row level security;

drop policy if exists "todos pueden leer audit_chunks"    on public.audit_chunks;
drop policy if exists "todos pueden leer parser_logs"      on public.parser_logs;
drop policy if exists "todos pueden leer parser_adapters"  on public.parser_adapters;
