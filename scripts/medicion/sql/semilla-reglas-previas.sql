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

-- Escala tipo E1 (línea base: 553 reglas, ~1.600 abonos): 500 reglas VIEJAS (algunas 39,
-- algunas con la señal 0.99 de la Fase 2), 20 cartolas × 100 movimientos, 2.000
-- propuestas clasificadas por esas reglas. Sirven para comprobar que la migración no
-- cambia NADA de las existentes y que borrar una cartola no apaga ninguna.
insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, confianza, prioridad, veces_aplicada)
select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-4000-8000-0000000000f1',
       'Auto: PERSONA N' || g || case when g % 10 = 0 then ' → Afecta' else ' → Exenta' end,
       '(^|[^a-zà-ÿ])persona n' || g || '([^a-zà-ÿ]|$)', 'regex', 'entrada',
       case when g % 10 = 0 then 'boleta' else 'exenta' end, case when g % 10 = 0 then 39 else 41 end,
       case when g % 50 = 0 then 0.99 else 0.95 end, 50, g
  from generate_series(1, 500) g;
\o /dev/null
select pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-a000-0000000000' || lpad(d::text, 2, '0'),
         'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'estado', 'procesado', 'tipo', 'cartola'))
  from generate_series(1, 20) d;
select pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-b000-0000000' || lpad(d::text, 2, '0') || lpad(k::text, 3, '0'),
         'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'documento_id', '00000000-0000-4000-a000-0000000000' || lpad(d::text, 2, '0'),
         'descripcion', 'TRANSFERENCIA DE PERSONA N' || ((d * 100 + k) % 500 + 1), 'monto', 1000 + k, 'tipo_flujo', 'entrada', 'fecha', current_date))
  from generate_series(1, 20) d, generate_series(1, 100) k;
\o
insert into public.propuestas_ia (empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, regla_id)
select '00000000-0000-4000-8000-0000000000f1', ('00000000-0000-4000-b000-0000000' || lpad(d::text, 2, '0') || lpad(k::text, 3, '0'))::uuid,
       'exenta', 41, 0.95, 1000 + k, 'regla_usuario', 'aprobado',
       ('00000000-0000-4000-9000-' || lpad(((d * 100 + k) % 500 + 1)::text, 12, '0'))::uuid
  from generate_series(1, 20) d, generate_series(1, 100) k;
commit;
