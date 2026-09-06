-- Vuelta atrás de 20260906140000_computa_cupo.
--
-- Quita el trigger, la función y la columna. Al volver, el conteo vuelve a
-- ser "propuesta_id no nulo" (el código debe revertirse junto con esto):
-- las facturas únicas emitidas entre medio VOLVERÍAN a descontar. Si importa,
-- exportar antes: select id, empresa_id, created_at from public.boletas_emitidas
-- where computa_cupo = false and propuesta_id is not null;

drop trigger if exists trg_sellar_computa_cupo on public.boletas_emitidas;
drop function if exists public.sellar_computa_cupo();
alter table public.boletas_emitidas drop column if exists computa_cupo;
