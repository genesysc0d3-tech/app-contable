-- Semilla PREVIA a 20261005120000_reglas_con_historial.sql (se aplica ANTES de la
-- migración, en el Postgres local desechable): reglas que "ya existían" en prod.
-- Sirve para probar que las existentes quedan 'firme', que la señal 0.99 de la Fase 2
-- se migra a aprendida_bajo_marca y que la migración B saca al tercero del nombre.
-- La usa scripts/medicion/probar-reglas-historial-local.sh. JAMÁS en prod.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ins(p_tabla text, p_vals jsonb) returns void language plpgsql as $f$
declare v_cols text := ''; v_exprs text := ''; r record; v jsonb := p_vals;
begin
  for r in select column_name, data_type from information_schema.columns
            where table_schema = 'public' and table_name = p_tabla
              and is_nullable = 'NO' and column_default is null and is_identity = 'NO'
              and not (p_vals ? column_name) loop
    v := v || jsonb_build_object(r.column_name, case
      when r.data_type in ('text', 'character varying') then to_jsonb('x'::text)
      when r.data_type = 'uuid' then to_jsonb(gen_random_uuid())
      when r.data_type in ('integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real') then to_jsonb(0)
      when r.data_type = 'boolean' then to_jsonb(false)
      when r.data_type = 'date' then to_jsonb(current_date)
      when r.data_type like 'timestamp%' then to_jsonb(now())
      when r.data_type in ('jsonb', 'json') then '{}'::jsonb
      else to_jsonb('x'::text) end);
  end loop;
  select string_agg(quote_ident(k), ', '), string_agg(format('(%L::jsonb ->> %L)', v, k) || '::' ||
           (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
             where a.attrelid = ('public.' || p_tabla)::regclass and a.attname = k), ', ')
    into v_cols, v_exprs
  from jsonb_object_keys(v) k
  where exists (select 1 from information_schema.columns c   -- claves que el esquema no tiene se ignoran
                 where c.table_schema = 'public' and c.table_name = p_tabla and c.column_name = k);
  execute format('insert into public.%I (%s) values (%s)', p_tabla, v_cols, v_exprs);
end $f$;

select pg_temp.ins('empresas', '{"id":"00000000-0000-4000-8000-0000000000f1","razon_social":"EMPRESA PRUEBA REGLAS","rut":"76.000.001-8","es_prueba":true}');
-- r1: aprendida normal (41). r2: Afecta confirmada en marca P2P (señal 0.99 de la Fase 2).
-- r3: "Backfill:" sin tipo. r4: regla manual con otro nombre (no se toca). rg: global.
insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, confianza, prioridad, veces_aplicada)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'Auto: JUAN PEREZ → Exenta',
   '(^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41, 0.95, 50, 12),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000f1', 'Auto: ANA SOTO → Afecta',
   '(^|[^a-zà-ÿ])ana soto([^a-zà-ÿ]|$)', 'regex', 'entrada', 'boleta', 39, 0.99, 50, 3),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000f1', 'Backfill: PEDRO DIAZ',
   'PEDRO DIAZ', 'contains', 'entrada', 'exenta', null, 0.95, 50, 0),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000f1', 'Arriendo oficina',
   'ARRIENDO OF', 'contains', 'entrada', 'exenta', 41, 0.95, 50, 0),
  ('00000000-0000-4000-8000-00000000a0a9', null, 'Global de prueba',
   'zz-global-prueba', 'contains', 'entrada', 'boleta', null, 0.8, 100, 0);
commit;
