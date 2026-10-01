-- Revierte 20261001150000_documentos_paths_inmutables.sql.
-- Restaura el UPDATE a nivel TABLA de authenticated y anon sobre documentos_subidos
-- (el GRANT por defecto de Supabase) y limpia los GRANT por columna que dejó la
-- migración. RE-ABRE el hueco: el usuario vuelve a poder reescribir storage_path /
-- storage_provider / album_imagenes por PostgREST (queda solo el candado de la ruta
-- /api/archivo). No destruye datos.

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'documentos_subidos'
     and column_name not in ('storage_path', 'storage_provider', 'album_imagenes');

  if v_cols is not null then
    execute format('revoke update (%s) on table public.documentos_subidos from authenticated, anon', v_cols);
  end if;
end
$$;

grant update on table public.documentos_subidos to authenticated, anon;
