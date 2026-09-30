-- Revierte 20260930120000_candado_borrar_propuesta_emitida.sql (candado 2).
-- Quita el trigger BEFORE DELETE de propuestas_ia y su función: la base vuelve a
-- dejar borrar propuestas con boletas/lápidas (solo queda el candado 1, en la app).
-- DESTRUYE: la tabla de auditoría del bypass (propuestas_borradas_con_emision).
-- Respaldar antes si tiene filas (regla: backup antes de tocar Supabase):
--   select * from public.propuestas_borradas_con_emision;
drop trigger if exists trg_propuestas_ia_candado_emision on public.propuestas_ia;
drop function if exists public.propuestas_ia_candado_emision();
drop table if exists public.propuestas_borradas_con_emision;
