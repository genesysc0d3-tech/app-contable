-- Revierte 20261004150000_propuestas_ia_sin_update_usuario.sql.
-- Devuelve a authenticated y anon el UPDATE, DELETE y TRUNCATE a nivel TABLA sobre
-- propuestas_ia (el GRANT por defecto de Supabase). RE-ABRE el hueco: el usuario
-- vuelve a poder reescribir o borrar sus propuestas por PostgREST, saltándose los
-- guards de las server actions. No destruye datos.
-- (Los GRANT por columna que pudieran existir antes no se restauran: con el de tabla
-- devuelto no hacen falta.)

grant update, delete, truncate on table public.propuestas_ia to authenticated, anon;
