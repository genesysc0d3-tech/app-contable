-- Paths de archivo INMUTABLES para el usuario — auditoría 2026-10-01.
--
-- Hallazgo (CONFIRMADO en prod): authenticated y anon tienen UPDATE a nivel TABLA
-- sobre documentos_subidos (el GRANT por defecto de Supabase), y la única policy
-- ("row level via usuarios", FOR ALL, USING empresa_id = empresa_autorizada())
-- autoriza la FILA, no las columnas. Así el usuario podía reescribir por PostgREST
-- storage_path / storage_provider / album_imagenes de sus documentos, y
-- /api/archivo/[id] baja ese path con SERVICE ROLE (ve todo el bucket) → apuntar la
-- fila propia al archivo de otra empresa le servía el archivo ajeno.
--
-- Candado 1 = la app: /api/archivo exige que el path empiece con `{empresa_id}/`
-- (esPathDeEmpresa en src/lib/storage.ts). Candado 2 = ESTA migración.
--
-- Por qué así y no `REVOKE UPDATE (col)`: en Postgres un REVOKE de columna NO quita
-- el UPDATE de nivel tabla — no haría nada. Hay que quitar el de tabla y devolver
-- UPDATE columna por columna, a todas MENOS las tres de path. La lista se arma desde
-- information_schema (no a mano) para no dejar fuera una columna que exista en prod
-- y no en database.types.ts.
--
-- Quién escribe esas columnas (revisado en src/ el 2026-10-01): SOLO service role
-- (subir-procesar, telegram/webhook, telegram/ingesta, sii-local/result,
-- simpleapi/result, intermediaria/*). Las escrituras con cliente de USUARIO a
-- documentos_subidos tocan otras columnas: tipo_operacion_hint, medio_pago_comun,
-- glosa_comun/glosa_activa (subir/actions.ts), progreso_ia (cuadre-actions.ts,
-- cancelar-documento), estado (cancelar-documento).
--
-- INSERT NO se toca: factura-unica inserta con el cliente del usuario y manda
-- storage_path = 'memoria'. Una fila insertada con un path ajeno la frena el
-- candado 1 (la ruta), no esta migración.
--
-- ⚠ OJO A FUTURO: una columna NUEVA en documentos_subidos (ALTER TABLE ADD COLUMN)
-- ya NO queda actualizable por authenticated automáticamente. Si el cliente del
-- usuario necesita escribirla, la migración que la crea debe incluir:
--   grant update (nueva_columna) on public.documentos_subidos to authenticated, anon;

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

  if v_cols is null then
    raise exception 'documentos_subidos sin columnas visibles: abortando para no dejar la tabla sin UPDATE';
  end if;

  execute 'revoke update on table public.documentos_subidos from authenticated, anon';
  execute format('grant update (%s) on table public.documentos_subidos to authenticated, anon', v_cols);
end
$$;

-- Verificación (debe devolver 0 filas: nadie de cara al cliente con UPDATE en paths):
--   select grantee, column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'documentos_subidos'
--      and privilege_type = 'UPDATE' and grantee in ('authenticated', 'anon')
--      and column_name in ('storage_path', 'storage_provider', 'album_imagenes');
