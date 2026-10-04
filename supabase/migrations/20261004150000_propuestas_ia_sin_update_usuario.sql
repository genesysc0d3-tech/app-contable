-- propuestas_ia: el cliente del USUARIO ya no puede modificar ni borrar filas — 2026-10-04.
-- Plan cirujano del clasificador, Fase 2. ⚠ NO APLICADA: ver "Antes de aplicar" abajo.
--
-- Hallazgo: authenticated y anon tienen el GRANT por defecto de Supabase (ALL) sobre
-- propuestas_ia, y la policy autoriza la FILA (empresa_autorizada()), no la operación.
-- Así un usuario podía, por PostgREST, reescribir estado/tipo_propuesto/tipo_dte/total
-- de sus propuestas (saltándose los guards de las server actions: candado de emisión,
-- clasificarIntocables, el sello de decisión de la Fase 1) o borrarlas.
--
-- Quién escribe propuestas_ia (inventario en src/ el 2026-10-04):
--   UPDATE/DELETE → SOLO service role: revisar/actions.ts (getEmpresaAndService →
--     createServiceClient), aprender-regla.ts (recibe ctx.sb de service), mcp/route.ts
--     (ctx.svc), telegram/propuestas.ts + telegram/ingesta.ts (svc), cuadre-actions.ts
--     (upsert con createServiceClient), processor.ts (service), facturas/procesar.ts
--     (sb del worker de la cola, service).
--   INSERT con cliente de USUARIO → factura-unica/route.ts. Por eso INSERT NO se toca.
--   Borrados en cascada (movimientos_raw → propuestas_ia ON DELETE CASCADE, eliminar /
--     deshacer documento): las acciones referenciales corren como DUEÑO de la tabla,
--     no necesitan el DELETE de authenticated.
--   Realtime (MesaController postgres_changes) solo necesita SELECT.
--
-- Por qué así: en Postgres un GRANT de COLUMNA sobrevive a un REVOKE de TABLA. Se
-- quita el de tabla (UPDATE, DELETE, TRUNCATE) y además cualquier UPDATE por columna
-- que exista (lista desde information_schema, no a mano). Mismo patrón que
-- 20261001150000_documentos_paths_inmutables.sql. SELECT e INSERT intactos.
--
-- ── Antes de aplicar (verificar EN PROD, solo lectura) ──────────────────────────────
-- 1. Grants actuales (esperado: authenticated/anon con UPDATE, DELETE a nivel tabla):
--      select grantee, privilege_type from information_schema.role_table_grants
--       where table_schema='public' and table_name='propuestas_ia'
--         and grantee in ('authenticated','anon') order by 1,2;
--      select grantee, column_name from information_schema.column_privileges
--       where table_schema='public' and table_name='propuestas_ia'
--         and privilege_type='UPDATE' and grantee in ('authenticated','anon');
-- 2. Ninguna función SECURITY INVOKER que el usuario llame por RPC escribe la tabla
--    (esperado: 0 filas, o solo funciones que corre service role / triggers):
--      select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.prosrc ilike '%propuestas_ia%'
--         and (p.prosrc ilike '%update%' or p.prosrc ilike '%delete%') and not p.prosecdef;
--    Si aparece un TRIGGER de otra tabla que el usuario sí escribe (documentos_subidos,
--    movimientos_raw…) y que hace UPDATE/DELETE en propuestas_ia, NO aplicar sin
--    volverlo SECURITY DEFINER primero.
-- 3. Logs de API de los últimos 14 días: cero PATCH/DELETE a /rest/v1/propuestas_ia con
--    rol authenticated (Logs → API, filtrar path + method).
-- 4. Servicios fuera de Vercel (la mini: massdte-ia / latido de cola; la extensión
--    sii-portal-rpa) escriben con service role o vía /api, nunca con el JWT del usuario.
-- 5. Respaldo antes (regla de la casa) y aplicar fuera de horario de emisión.
--
-- ⚠ A FUTURO: si una server action pasa a escribir propuestas_ia con el cliente del
-- usuario, fallará con "permission denied" — escribir con service role (como el resto).

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'propuestas_ia';

  if v_cols is null then
    raise exception 'propuestas_ia sin columnas visibles: abortando';
  end if;

  execute 'revoke update, delete, truncate on table public.propuestas_ia from authenticated, anon';
  -- Un REVOKE de tabla no quita los GRANT por columna: se barren explícitamente.
  execute format('revoke update (%s) on table public.propuestas_ia from authenticated, anon', v_cols);
end
$$;

-- Verificación (las dos deben devolver 0 filas):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='propuestas_ia'
--      and grantee in ('authenticated','anon') and privilege_type in ('UPDATE','DELETE','TRUNCATE');
--   select grantee, column_name from information_schema.column_privileges
--    where table_schema='public' and table_name='propuestas_ia'
--      and privilege_type='UPDATE' and grantee in ('authenticated','anon');
