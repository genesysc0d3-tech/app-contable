-- Prueba funcional de 20261005120000_reglas_con_historial.sql + 20261005120100_reglas_nombre_sin_tercero.sql.
-- Supone la semilla previa (semilla-reglas-previas.sql) aplicada ANTES de las migraciones.
-- Corre TODO en una transacción y hace ROLLBACK: no deja nada. Solo Postgres local
-- desechable (scripts/medicion/probar-reglas-historial-local.sh). JAMÁS prod.
-- Cada comprobación revienta (raise exception) si falla; los NOTICE dicen OK.
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

-- [1] las EXISTENTES quedaron firmes; la señal 0.99 pasó a su campo; nombres sin tercero
do $$
declare r record;
begin
  for r in select * from public.clasificacion_reglas where empresa_id = '00000000-0000-4000-8000-0000000000f1'
           or id = '00000000-0000-4000-8000-00000000a0a9' loop
    if r.estado <> 'firme' then raise exception '[1] FALLA: % quedó %', r.nombre, r.estado; end if;
  end loop;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a2';
  if not r.aprendida_bajo_marca or r.confianza <> 0.99 then
    raise exception '[1] FALLA: la señal 0.99 no se marcó o se tocó la confianza (bajo_marca=%, confianza=%)', r.aprendida_bajo_marca, r.confianza;
  end if;
  if exists (select 1 from public.clasificacion_reglas where empresa_id is not null and ligada_a_cartolas) then
    raise exception '[1] FALLA: una regla existente quedó ligada a cartolas (podría apagarse sola)';
  end if;
  if exists (select 1 from public.clasificacion_reglas where empresa_id = '00000000-0000-4000-8000-0000000000f1'
             and (nombre ilike '%juan%' or nombre ilike '%ana soto%' or nombre ilike '%pedro%')) then
    raise exception '[1] FALLA: queda un tercero en el nombre';
  end if;
  if (select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a1') <> 'Contraparte aprendida · Exenta'
     or (select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a2') <> 'Contraparte aprendida · Afecta'
     or (select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a3') <> 'Contraparte aprendida'
     or (select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a4') <> 'Arriendo oficina' then
    raise exception '[1] FALLA: nombres inesperados';
  end if;
  raise notice '[1] OK: existentes firmes y NO ligadas, 0.99 marcada sin tocar la confianza, nombres sin tercero, la manual intacta';
end $$;

-- [2] las NUEVAS nacen a prueba; una global siempre firme (insert y update)
do $$
declare v text;
begin
  insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, confianza, prioridad)
  values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Exenta',
          '(^|[^a-zà-ÿ])maria lopez([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41, 0.95, 50);
  select estado into v from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b1';
  if v <> 'a_prueba' then raise exception '[2] FALLA: la nueva nació %', v; end if;
  insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_propuesto, estado)
  values ('00000000-0000-4000-8000-00000000a0b9', null, 'Global nueva', 'zz-otra', 'contains', 'boleta', 'a_prueba');
  select estado into v from public.clasificacion_reglas where id = '00000000-0000-4000-8000-00000000a0b9';
  if v <> 'firme' then raise exception '[2] FALLA: global nació %', v; end if;
  update public.clasificacion_reglas set estado = 'en_disputa' where id = '00000000-0000-4000-8000-00000000a0a9';
  select estado into v from public.clasificacion_reglas where id = '00000000-0000-4000-8000-00000000a0a9';
  if v <> 'firme' then raise exception '[2] FALLA: global quedó %', v; end if;
  raise notice '[2] OK: nueva = a_prueba, global = firme siempre';
end $$;

-- [3] constraints: estado cerrado; deshecha/huérfana apagada; estado_cambiado_at automático
do $$
declare ok boolean; t timestamptz;
begin
  ok := false;
  begin update public.clasificacion_reglas set estado = 'inventado' where id = '00000000-0000-4000-8000-0000000000b1';
  exception when check_violation then ok := true; end;
  if not ok then raise exception '[3] FALLA: aceptó un estado fuera de la lista'; end if;
  ok := false;
  begin update public.clasificacion_reglas set estado = 'deshecha', activa = true where id = '00000000-0000-4000-8000-0000000000b1';
  exception when check_violation then ok := true; end;
  if not ok then raise exception '[3] FALLA: deshecha con activa=true'; end if;
  ok := false;
  begin update public.clasificacion_reglas set corregidas_en_ventana = -1 where id = '00000000-0000-4000-8000-0000000000b1';
  exception when check_violation then ok := true; end;
  if not ok then raise exception '[3] FALLA: aceptó un contador negativo'; end if;
  if (select (corregidas_en_ventana, disputa_racha, disputa_eleccion) is distinct from (0, 0, null::smallint)
        from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b1') then
    raise exception '[3] FALLA: contadores de ventana/disputa no nacen en cero';
  end if;
  update public.clasificacion_reglas set estado = 'firme' where id = '00000000-0000-4000-8000-0000000000b1';
  select estado_cambiado_at into t from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b1';
  if t is null then raise exception '[3] FALLA: estado_cambiado_at no se marcó'; end if;
  update public.clasificacion_reglas set estado = 'a_prueba', estado_cambiado_at = null where id = '00000000-0000-4000-8000-0000000000b1';
  raise notice '[3] OK: estados cerrados, deshecha exige activa=false, estado_cambiado_at automático';
end $$;

-- [4] uso atómico: un id repetido suma las veces; devuelve cuántas reglas tocó
do $$
declare n int; a int; b int;
begin
  n := public.incrementar_uso_reglas(array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1',
                                           '00000000-0000-4000-8000-0000000000b1', null]::uuid[]);
  select veces_aplicada into a from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a1';
  select veces_aplicada into b from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b1';
  if n <> 2 or a <> 14 or b <> 1 then raise exception '[4] FALLA: n=% a=% b=%', n, a, b; end if;
  raise notice '[4] OK: incrementar_uso_reglas suma por id (12→14, 0→1) y devuelve 2';
end $$;

-- [5] evidencia: confirmaciones por DOCUMENTO, del mismo tipo, sin corrección; mirada; aciertos
-- 4 cartolas con filas de la regla b1 (41):
--   c1: 3 filas emitidas 41 (un lote ciego de 3 → cuenta 1 cartola, 3 aciertos), una mirada por check_fila
--   c2: 1 fila emitida 41, aprobada por aprobar_cartola con lote 300 (ciega)
--   c3: 1 fila emitida 39 (otro tipo) → no confirma
--   c4: 1 fila emitida 41 pero corregida por una persona (41→39→41) → no confirma; y 1 anulada
\o /dev/null
select pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c' || g,
         'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'estado', 'procesado', 'tipo', 'cartola'))
  from generate_series(1, 4) g;
select pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-000000000' || d || '0' || k,
         'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'documento_id', '00000000-0000-4000-8000-0000000000c' || d,
         'descripcion', 'TRANSFERENCIA DE MARIA LOPEZ ' || d || k, 'monto', 1000 * d + k, 'tipo_flujo', 'entrada', 'fecha', current_date))
  from generate_series(1, 4) d, generate_series(1, 3) k;
insert into public.propuestas_ia (id, empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, regla_id, orig_tipo_dte_fuente)
select ('00000000-0000-4000-8000-0000000' || d || '0' || k || '00')::uuid, '00000000-0000-4000-8000-0000000000f1',
       ('00000000-0000-4000-8000-000000000' || d || '0' || k)::uuid, 'exenta', 41, 0.8, 1000, 'regla_usuario', 'pendiente',
       '00000000-0000-4000-8000-0000000000b1', 'regla'
  from generate_series(1, 4) d, generate_series(1, 3) k
 where d = 1 or k = 1 or (d = 4 and k = 2);
-- decisiones (con sello: lote nuevo)
update public.propuestas_ia set estado = 'aprobado', decision_canal = 'check_fila', decision_lote = gen_random_uuid(), decision_lote_n = 1
 where id = '00000000-0000-4000-8000-000000010100';
update public.propuestas_ia set estado = 'aprobado', decision_canal = 'check_lote', decision_lote = gen_random_uuid(), decision_lote_n = 300
 where id in ('00000000-0000-4000-8000-000000010200', '00000000-0000-4000-8000-000000010300');
update public.propuestas_ia set estado = 'aprobado', decision_canal = 'aprobar_cartola', decision_lote = gen_random_uuid(), decision_lote_n = 300
 where id in ('00000000-0000-4000-8000-000000020100', '00000000-0000-4000-8000-000000030100', '00000000-0000-4000-8000-000000040200');
update public.propuestas_ia set tipo_dte = 39, decision_canal = 'check_detalle', decision_lote = gen_random_uuid(), decision_lote_n = 1
 where id = '00000000-0000-4000-8000-000000040100';
update public.propuestas_ia set tipo_dte = 41, estado = 'aprobado', decision_canal = 'check_detalle', decision_lote = gen_random_uuid(), decision_lote_n = 1
 where id = '00000000-0000-4000-8000-000000040100';
select pg_temp.ins('boletas_emitidas', jsonb_build_object('empresa_id', '00000000-0000-4000-8000-0000000000f1',
         'propuesta_id', x.pid, 'tipo_dte', x.t, 'estado', x.e, 'folio', x.f, 'emision_proveedor', 'mock', 'emision_sandbox', false,
         'monto_total', 1000, 'monto_exento', 1000))
  from (values ('00000000-0000-4000-8000-000000010100'::uuid, 41, 'aceptado', 1),
               ('00000000-0000-4000-8000-000000010200'::uuid, 41, 'aceptado', 2),
               ('00000000-0000-4000-8000-000000010300'::uuid, 41, 'aceptado_reparos', 3),
               ('00000000-0000-4000-8000-000000020100'::uuid, 41, 'aceptado', 4),
               ('00000000-0000-4000-8000-000000030100'::uuid, 39, 'aceptado', 5),
               ('00000000-0000-4000-8000-000000040100'::uuid, 41, 'aceptado', 6),
               ('00000000-0000-4000-8000-000000040200'::uuid, 41, 'anulada', 7)) x(pid, t, e, f);
\o
insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, movimiento_id, rol)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-000000000101', 'acuno');
do $$
declare e record; ms numeric; t0 timestamptz := clock_timestamp();
begin
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array['00000000-0000-4000-8000-0000000000b1']::uuid[]);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if e.confirmadas <> 2 then raise exception '[5] FALLA: confirmadas=% (esperaba 2: c1 y c2)', e.confirmadas; end if;
  if e.confirmadas_miradas <> 1 then raise exception '[5] FALLA: miradas=% (esperaba 1: c1)', e.confirmadas_miradas; end if;
  if e.aciertos <> 4 then raise exception '[5] FALLA: aciertos=% (esperaba 4: 3 de c1 + 1 de c2)', e.aciertos; end if;
  if e.soportes <> 1 then raise exception '[5] FALLA: soportes=%', e.soportes; end if;
  if e.documentos_confirman <> array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2']::uuid[] then
    raise exception '[5] FALLA: documentos=%', e.documentos_confirman; end if;
  if e.glosa is distinct from 'TRANSFERENCIA DE MARIA LOPEZ 11' then raise exception '[5] FALLA: glosa=%', e.glosa; end if;
  -- todas las reglas de la empresa (sin filtro): una fila por regla
  if (select count(*) from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1'))
     <> (select count(*) from public.clasificacion_reglas where empresa_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception '[5] FALLA: evidencia sin filtro no devuelve una fila por regla';
  end if;
  raise notice '[5] OK: 2 cartolas confirman (lote de 3 = 1; otro tipo, corregida y anulada no), 1 mirada, 4 aciertos, glosa del soporte (% ms)', round(ms, 1);
end $$;

-- [6] huérfanas: solo una regla NUEVA, no deshecha, sin filas vivas en otras cartolas;
--     nunca se borra la fila ni el patrón
do $$
declare r record; n int;
begin
  insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte)
  values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Afecta',
          '(^|[^a-zà-ÿ])rosa vera([^a-zà-ÿ]|$)', 'regex', 'entrada', 'boleta', 39),
         ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Exenta',
          '(^|[^a-zà-ÿ])luis mora([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41),
         ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Exenta',
          '(^|[^a-zà-ÿ])ana rios([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41),
         ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Exenta',
          '(^|[^a-zà-ÿ])eva luna([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41);
  update public.clasificacion_reglas set estado = 'deshecha', activa = false where id = '00000000-0000-4000-8000-0000000000b5';
  perform pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c9',
          'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'estado', 'procesado', 'tipo', 'cartola'));
  perform pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-000000000901',
          'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'documento_id', '00000000-0000-4000-8000-0000000000c9',
          'descripcion', 'TRANSFERENCIA DE ROSA VERA', 'monto', 5000, 'tipo_flujo', 'entrada', 'fecha', current_date));
  update public.clasificacion_reglas set documento_origen_id = '00000000-0000-4000-8000-0000000000c9'
   where id = '00000000-0000-4000-8000-0000000000b2';
  -- b4 clasifica una fila viva en OTRA cartola (c1)
  update public.propuestas_ia set regla_id = '00000000-0000-4000-8000-0000000000b4', decision_canal = 'sistema', decision_lote = gen_random_uuid()
   where id = '00000000-0000-4000-8000-000000010200';
  -- b2: solo c9 (acuñó + corrigió). b3: c9 y c2. b4: solo c9 + fila viva en c1. b5 (deshecha): solo c9.
  -- a1 (VIEJA): soportes en c9 (el bug B2: re-acuñar la ligaba a esta cartola).
  insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, movimiento_id, rol) values
    ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000901', 'acuno'),
    ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'corrigio'),
    ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'acuno'),
    ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000f1', null, 'confirmo'),
    ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'acuno'),
    ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'acuno'),
    ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'acuno');
  insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, rol)
  values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', 'acuno')
  on conflict do nothing;
  select count(*) into n from public.clasificacion_regla_soportes where regla_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 2 then raise exception '[6] FALLA: unique de soportes (n=%)', n; end if;

  delete from public.documentos_subidos where id = '00000000-0000-4000-8000-0000000000c9';

  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b2';
  if r.id is null then raise exception '[6] FALLA: la regla se BORRÓ (tabla sagrada)'; end if;
  if r.estado <> 'huerfana' or r.activa or r.nombre <> 'Contraparte de una cartola borrada · Afecta'
     or r.patron <> '(^|[^a-zà-ÿ])rosa vera([^a-zà-ÿ]|$)' or r.documento_origen_id is not null then
    raise exception '[6] FALLA: huérfana mal: estado=% activa=% nombre=% patron=% origen=%', r.estado, r.activa, r.nombre, r.patron, r.documento_origen_id;
  end if;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b3';
  if r.estado <> 'a_prueba' or not r.activa then raise exception '[6] FALLA: b3 (otra cartola viva) quedó %', r.estado; end if;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b4';
  if r.estado <> 'a_prueba' or not r.activa then raise exception '[6] FALLA: b4 (filas vivas en otra cartola) quedó %', r.estado; end if;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b5';
  if r.estado <> 'deshecha' then raise exception '[6] FALLA: b5 (deshecha) quedó %', r.estado; end if;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a1';
  if r.estado <> 'firme' or not r.activa or r.patron <> '(^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)' then
    raise exception '[6] FALLA: la VIEJA a1 cambió (estado=% activa=%)', r.estado, r.activa;
  end if;
  raise notice '[6] OK: borrar la última cartola → solo la nueva sin otras filas queda huérfana (apagada, sin tercero en el nombre, patrón intacto); otra cartola, filas vivas, deshecha y vieja: intactas';
end $$;

-- [9] B1 en la base: regla 39 con 5 cartolas emitidas; tras una corrección (el código
--     pone evidencia_desde = ahora) esas 5 confirmaciones viejas ya no cuentan
do $$
declare e record; v_regla uuid := '00000000-0000-4000-8000-0000000000b6';
begin
  insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, estado)
  values (v_regla, '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Afecta',
          '(^|[^a-zà-ÿ])hugo paz([^a-zà-ÿ]|$)', 'regex', 'entrada', 'boleta', 39, 'firme');
  for d in 11..15 loop
    perform pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-8000-0000000000' || d,
            'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'estado', 'procesado', 'tipo', 'cartola'));
    perform pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-0000000009' || d,
            'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'documento_id', '00000000-0000-4000-8000-0000000000' || d,
            'descripcion', 'TRANSFERENCIA DE HUGO PAZ', 'monto', 5000, 'tipo_flujo', 'entrada', 'fecha', current_date));
    insert into public.propuestas_ia (id, empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, regla_id, orig_tipo_dte_fuente, created_at)
    values (('00000000-0000-4000-8000-000000009' || d || '0')::uuid, '00000000-0000-4000-8000-0000000000f1',
            ('00000000-0000-4000-8000-0000000009' || d)::uuid, 'boleta', 39, 0.95, 5000, 'regla_usuario', 'aprobado', v_regla, 'regla',
            now() - interval '10 days');
    perform pg_temp.ins('boletas_emitidas', jsonb_build_object('empresa_id', '00000000-0000-4000-8000-0000000000f1',
            'propuesta_id', '00000000-0000-4000-8000-000000009' || d || '0', 'tipo_dte', 39, 'estado', 'aceptado', 'folio', 100 + d,
            'emision_proveedor', 'mock', 'emision_sandbox', false, 'monto_total', 5000, 'monto_neto', 4202, 'iva', 798));
  end loop;
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array[v_regla]);
  if e.confirmadas <> 5 then raise exception '[9] FALLA: antes de corregir esperaba 5, hay %', e.confirmadas; end if;
  -- ventana que vence: corrección hace 20 días, filas de hace 10 → las 5 son posteriores
  update public.clasificacion_reglas set corregida_at = now() - interval '20 days' where id = v_regla;
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array[v_regla]);
  if e.confirmadas_tras_correccion <> 5 then raise exception '[9] FALLA: tras_correccion=% (esperaba 5)', e.confirmadas_tras_correccion; end if;
  update public.clasificacion_reglas set corregida_at = now() where id = v_regla;
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array[v_regla]);
  if e.confirmadas_tras_correccion <> 0 then raise exception '[9] FALLA: tras_correccion=% (esperaba 0)', e.confirmadas_tras_correccion; end if;
  -- una hermana ligada por la PROPAGACIÓN no es evidencia independiente
  update public.propuestas_ia set decision_canal = 'propagacion', decision_lote = gen_random_uuid(), decision_lote_n = 1, estado = 'listo'
   where id = '00000000-0000-4000-8000-000000009110';
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array[v_regla]);
  if e.confirmadas <> 4 then raise exception '[9] FALLA: con una propagada esperaba 4, hay %', e.confirmadas; end if;
  update public.clasificacion_reglas set estado = 'en_disputa', veces_corregida = 1, evidencia_desde = now() where id = v_regla;
  select * into e from public.evidencia_reglas('00000000-0000-4000-8000-0000000000f1', array[v_regla]);
  if e.confirmadas <> 0 or e.glosa is null then raise exception '[9] FALLA: tras corregir confirmadas=% glosa=%', e.confirmadas, e.glosa; end if;
  if jsonb_array_length(public.evidencia_reglas_lote('00000000-0000-4000-8000-0000000000f1')) <>
     (select count(*) from public.clasificacion_reglas where empresa_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception '[9] FALLA: evidencia_reglas_lote no trae una entrada por regla';
  end if;
  raise notice '[9] OK: 5 cartolas emitidas confirman (4 si una vino por propagación); la ventana vence con evidencia posterior a la corrección; tras la corrección cuentan 0 (la glosa sigue); el lote jsonb trae todas las reglas';
end $$;

-- [10] escala E1: 500 reglas VIEJAS; ligarlas por error a una cartola (bug B2) y borrar
--      esa cartola NO apaga ninguna; tampoco borrar 5 cartolas más con sus filas
do $$
declare n int; t0 timestamptz;
begin
  insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, rol)
  select r.id, '00000000-0000-4000-a000-000000000001', r.empresa_id, s.rol
    from public.clasificacion_reglas r cross join (values ('acuno'), ('confirmo')) s(rol)
   where r.id::text like '00000000-0000-4000-9000-%';
  t0 := clock_timestamp();
  delete from public.documentos_subidos where id in (select ('00000000-0000-4000-a000-0000000000' || lpad(d::text, 2, '0'))::uuid from generate_series(1, 6) d);
  select count(*) into n from public.clasificacion_reglas
   where id::text like '00000000-0000-4000-9000-%' and (not activa or estado <> 'firme' or patron not like '(^|[^a-zà-ÿ])persona n%');
  if n <> 0 then raise exception '[10] FALLA: % reglas viejas cambiaron al borrar cartolas', n; end if;
  raise notice '[10] OK: 500 reglas viejas, 6 cartolas borradas (1.000 soportes de por medio): 0 apagadas (% ms)',
    round(extract(epoch from clock_timestamp() - t0) * 1000);
end $$;

-- [7] privilegios: la clienta solo LEE sus soportes; las funciones son del service role
do $$
begin
  if not has_table_privilege('authenticated', 'public.clasificacion_regla_soportes', 'select')
     or has_table_privilege('authenticated', 'public.clasificacion_regla_soportes', 'insert')
     or has_table_privilege('authenticated', 'public.clasificacion_regla_soportes', 'delete')
     or has_table_privilege('anon', 'public.clasificacion_regla_soportes', 'select')
     or has_function_privilege('authenticated', 'public.incrementar_uso_reglas(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.evidencia_reglas(uuid, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.evidencia_reglas(uuid, uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.evidencia_reglas(uuid, uuid[])', 'execute') then
    raise exception '[7] FALLA: privilegios';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clasificacion_regla_soportes'::regclass) then
    raise exception '[7] FALLA: soportes sin RLS';
  end if;
  raise notice '[7] OK: soportes con RLS, solo lectura para authenticated; funciones cerradas salvo service_role';
end $$;

-- [8] RLS de verdad: un usuario de OTRA empresa no ve los soportes
do $$
declare n int; v_user uuid := gen_random_uuid();
begin
  if to_regprocedure('public.empresa_autorizada()') is null then
    raise notice '[8] (sin empresa_autorizada en este esquema: se salta)'; return;
  end if;
  insert into auth.users (id) values (v_user);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  set local role authenticated;
  select count(*) into n from public.clasificacion_regla_soportes;
  reset role;
  if n <> 0 then raise exception '[8] FALLA: un usuario ajeno ve % soportes', n; end if;
  raise notice '[8] OK: un usuario sin la empresa ve 0 soportes';
end $$;

rollback;
