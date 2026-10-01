-- Revierte 20260930140000_parser_adapters_estado.sql. DESTRUYE: qué mapas
-- estaban confirmados, por qué y cuándo (el código vuelve a tratarlos a todos
-- como provisorios, fail-safe). La confianza rebajada a 0.7 NO se restaura (no
-- se guardó el valor anterior): respaldar parser_adapters antes de aplicar la UP
-- si se quiere poder volver exacto.
drop index if exists public.idx_parser_adapters_empresa_estado;
alter table public.parser_adapters drop constraint if exists parser_adapters_confirmado_por_check;
alter table public.parser_adapters drop constraint if exists parser_adapters_estado_check;
alter table public.parser_adapters drop column if exists confirmado_en;
alter table public.parser_adapters drop column if exists confirmado_por;
alter table public.parser_adapters drop column if exists estado;
