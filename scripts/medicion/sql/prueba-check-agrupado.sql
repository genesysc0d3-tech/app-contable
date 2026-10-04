-- Prueba funcional de 20261006120000_check_agrupado.sql (Fase 4, Check agrupado).
-- Corre TODO en una transacción y hace ROLLBACK: no deja nada. Solo Postgres local
-- desechable (scripts/medicion/probar-check-agrupado-local.sh). JAMÁS prod.
-- :fase = 'up' (con la migración) o 'down' (después del DOWN).
\set ON_ERROR_STOP on
begin;
select set_config('prueba.fase', :'fase', true);
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

\o /dev/null
select pg_temp.ins('empresas', jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f9', 'razon_social', 'Prueba Grupo SpA', 'rut', '11111111-1'));
select pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-8000-0000000009c' || g,
         'empresa_id', '00000000-0000-4000-8000-0000000000f9', 'estado', 'procesado', 'tipo', 'cartola'))
  from generate_series(1, 3) g;
select pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-0000000009' || d || '0',
         'empresa_id', '00000000-0000-4000-8000-0000000000f9', 'documento_id', '00000000-0000-4000-8000-0000000009c' || d,
         'descripcion', 'TRANSFERENCIA DE TERE ALBA ' || d, 'monto', 1000, 'tipo_flujo', 'entrada', 'fecha', current_date))
  from generate_series(1, 3) d;
\o
insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, confianza, prioridad)
values ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000000f9', 'Contraparte aprendida · Exenta',
        '(^|[^a-zà-ÿ])tere alba([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41, 0.95, 50);
insert into public.propuestas_ia (id, empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, regla_id, orig_tipo_dte_fuente)
select ('00000000-0000-4000-8000-0000000009' || d || '1')::uuid, '00000000-0000-4000-8000-0000000000f9',
       ('00000000-0000-4000-8000-0000000009' || d || '0')::uuid, 'exenta', case when d = 3 then null else 41 end, 0.8, 1000,
       'regla_usuario', 'pendiente', '00000000-0000-4000-8000-0000000009b1', 'regla'
  from generate_series(1, 3) d;

-- [1] el CHECK del sello acepta check_grupo (decision_canal y editado_canal) y sigue cerrado
do $$
declare ok boolean := false; c text; ec text;
begin
  -- c1: respuesta en grupo con la persona TOCADA a mano (abierta) → mirada
  update public.propuestas_ia set estado = 'listo', decision_canal = 'check_grupo', decision_lote = gen_random_uuid(),
         decision_lote_n = 40, decision_abierta = true
   where id = '00000000-0000-4000-8000-000000000911';
  -- c2: "Sí" a toda la tarjeta (ciego)
  update public.propuestas_ia set estado = 'listo', decision_canal = 'check_grupo', decision_lote = gen_random_uuid(),
         decision_lote_n = 40, decision_abierta = false
   where id = '00000000-0000-4000-8000-000000000921';
  -- c3: la respuesta en grupo le PUSO el tipo (null → 41): editado_canal = check_grupo
  update public.propuestas_ia set estado = 'listo', tipo_dte = 41, decision_canal = 'check_grupo', decision_lote = gen_random_uuid(),
         decision_lote_n = 40, decision_abierta = true
   where id = '00000000-0000-4000-8000-000000000931';
  select decision_canal, editado_canal into c, ec from public.propuestas_ia where id = '00000000-0000-4000-8000-000000000931';
  if c <> 'check_grupo' or ec <> 'check_grupo' then raise exception '[1] FALLA: canal=% editado=%', c, ec; end if;
  begin
    update public.propuestas_ia set decision_canal = 'inventado', decision_lote = gen_random_uuid() where id = '00000000-0000-4000-8000-000000000911';
  exception when check_violation then ok := true; end;
  if not ok then raise exception '[1] FALLA: aceptó un canal fuera de la lista'; end if;
  if (select count(*) from public.propuesta_decisiones where canal = 'check_grupo'
        and propuesta_id in ('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000931')) <> 3 then
    raise exception '[1] FALLA: el log no registró las 3 respuestas en grupo';
  end if;
  raise notice '[1] OK: check_grupo sellado y logueado (decision_canal y editado_canal), lista cerrada';
end $$;

\o /dev/null
update public.propuestas_ia set estado = 'aprobado', decision_canal = 'aprobar_cartola', decision_lote = gen_random_uuid(), decision_lote_n = 300
 where empresa_id = '00000000-0000-4000-8000-0000000000f9';
select pg_temp.ins('boletas_emitidas', jsonb_build_object('empresa_id', '00000000-0000-4000-8000-0000000000f9',
         'propuesta_id', ('00000000-0000-4000-8000-0000000009' || d || '1')::uuid, 'tipo_dte', 41, 'estado', 'aceptado', 'folio', 900 + d,
         'emision_proveedor', 'mock', 'emision_sandbox', false, 'monto_total', 1000, 'monto_exento', 1000))
  from generate_series(1, 3) d;
\o

-- [2] evidencia: check_grupo abierta = mirada; ciega no; la que cambió el tipo en grupo no confirma
do $$
declare e record; esperadas_miradas int := case when current_setting('prueba.fase') = 'up' then 1 else 0 end;
        esperadas int := case when current_setting('prueba.fase') = 'up' then 1 else 3 end;
begin
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f9', array['00000000-0000-4000-8000-0000000009b1']::uuid[]);
  if e.confirmadas <> esperadas then raise exception '[2/%] FALLA: confirmadas=% (esperaba %)', current_setting('prueba.fase'), e.confirmadas, esperadas; end if;
  if e.confirmadas_miradas <> esperadas_miradas then raise exception '[2/%] FALLA: miradas=% (esperaba %)', current_setting('prueba.fase'), e.confirmadas_miradas, esperadas_miradas; end if;
  raise notice '[2/%] OK: confirmadas=%, miradas=% (check_grupo tocado = mirado; a ciegas o que puso el tipo no confirma)', current_setting('prueba.fase'), e.confirmadas, e.confirmadas_miradas;
end $$;

-- [3] nacio_lote (solo con la migración)
do $$
begin
  if current_setting('prueba.fase') = 'up' then
    update public.clasificacion_reglas set nacio_lote = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000009b1';
    raise notice '[3] OK: nacio_lote existe';
  elsif exists (select 1 from information_schema.columns where table_name = 'clasificacion_reglas' and column_name = 'nacio_lote') then
    raise exception '[3] FALLA: nacio_lote sigue tras el DOWN';
  else
    raise notice '[3] OK: nacio_lote fuera tras el DOWN';
  end if;
end $$;
-- [4] responder_grupo_ventas: una llamada, mismos candados que la acción
do $$
declare n int; l uuid := gen_random_uuid(); r record;
begin
  if current_setting('prueba.fase') <> 'up' then raise notice '[4] (sin la función tras el DOWN)'; return; end if;
  perform pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-0000000009a' || k,
         'empresa_id', '00000000-0000-4000-8000-0000000000f9', 'documento_id', '00000000-0000-4000-8000-0000000009c1',
         'descripcion', 'TRANSFERENCIA DE NORA PAZ', 'monto', 11900, 'tipo_flujo', case when k = 4 then 'salida' else 'entrada' end, 'fecha', current_date))
    from generate_series(1, 4) k;
  insert into public.propuestas_ia (id, empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, orig_tipo_dte_fuente)
  select ('00000000-0000-4000-8000-000000000a' || k || '1')::uuid, '00000000-0000-4000-8000-0000000000f9',
         ('00000000-0000-4000-8000-0000000009a' || k)::uuid, 'exenta', null, 0.5, 11900, 'ia_opencode',
         case when k = 3 then 'aprobado' else 'pendiente' end, 'auto_sin_tipo'
    from generate_series(1, 4) k;
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', l, 5,
    null, null, jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000a11', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', true),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 99999, 'tocada', false),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000a31', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false),
      jsonb_build_object('id', '00000000-0000-4000-8000-000000000a41', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false)));
  if n <> 1 then raise exception '[4] FALLA: vendió % filas (esperaba 1: monto que no cuadra, aprobada y salida fuera)', n; end if;
  select * into r from public.propuestas_ia where id = '00000000-0000-4000-8000-000000000a11';
  if r.estado <> 'listo' or r.tipo_dte <> 39 or r.decision_canal <> 'check_grupo' or r.decision_lote <> l or r.decision_abierta is not true then
    raise exception '[4] FALLA: fila vendida mal sellada (estado=% canal=% abierta=%)', r.estado, r.decision_canal, r.decision_abierta;
  end if;
  -- otra cartola: nada
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c2', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'exenta', 'tipo_dte', 41, 'monto_neto', 11900, 'iva', 0, 'total', 11900, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: vendió una fila de otra cartola'; end if;
  -- vuelta 4: los candados de tipo también viven en SQL
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'exenta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: aceptó 39 con tipo_propuesto exenta'; end if;
  update public.empresas set boletas_tipo_default = 'exento' where id = '00000000-0000-4000-8000-0000000000f9';
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: carril exento aceptó un 39'; end if;
  update public.empresas set boletas_tipo_default = null, tipo_contribuyente = 'exento' where id = '00000000-0000-4000-8000-0000000000f9';
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: exento heredado del contribuyente aceptó un 39'; end if;
  update public.empresas set boletas_tipo_default = 'afecto', tipo_contribuyente = 'exento' where id = '00000000-0000-4000-8000-0000000000f9';
  update public.documentos_subidos set tipo_operacion_hint = 'p2p_cripto' where id = '00000000-0000-4000-8000-0000000009c1';
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'boleta', 'tipo_dte', 39, 'monto_neto', 10000, 'iva', 1900, 'total', 11900, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: cartola P2P aceptó un 39'; end if;
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'exenta', 'tipo_dte', 41, 'monto_neto', 11900, 'iva', 0, 'total', 11900, 'tocada', false)));
  if n <> 1 then raise exception '[4] FALLA: cartola P2P no aceptó un 41 exento'; end if;
  update public.propuestas_ia set total = 0, estado = 'pendiente', decision_lote = gen_random_uuid(), decision_canal = 'check_fila', decision_lote_n = 1
   where id = '00000000-0000-4000-8000-000000000a21';
  select count(*) into n from public.responder_grupo_ventas('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000009c1', gen_random_uuid(), 1,
    null, null, jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000a21', 'tipo_propuesto', 'exenta', 'tipo_dte', 41, 'monto_neto', 0, 'iva', 0, 'total', 0, 'tocada', false)));
  if n <> 0 then raise exception '[4] FALLA: aceptó total 0'; end if;
  if has_function_privilege('authenticated', 'public.responder_grupo_ventas(uuid, uuid, uuid, integer, uuid, boolean, jsonb)', 'execute') then
    raise exception '[4] FALLA: authenticated puede ejecutar la RPC';
  end if;
  raise notice '[4] OK: RPC vende 1 de 4 (monto distinto, aprobada, salida y otra cartola fuera), sella check_grupo; 39 incoherente, carril exento (propio o heredado), cartola P2P y total 0 fuera; solo service_role';
end $$;
rollback;
