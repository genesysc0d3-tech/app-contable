-- Revierte 20260928120000_emision_refs.sql. DESTRUYE: la tabla emision_refs y las
-- columnas ref de boletas_emitidas / emision_jobs (las refs ya asignadas se pierden).
-- Respaldar antes (regla: backup antes de tocar Supabase).
drop trigger if exists trg_boletas_emitidas_asignar_ref on public.boletas_emitidas;
drop function if exists public.boletas_emitidas_asignar_ref();
drop function if exists public.emision_ref_nueva(uuid, uuid, date, numeric, integer);
drop index if exists public.idx_boletas_emitidas_empresa_ref;
alter table public.emision_jobs drop column if exists ref;
alter table public.boletas_emitidas drop column if exists ref;
drop table if exists public.emision_refs;
