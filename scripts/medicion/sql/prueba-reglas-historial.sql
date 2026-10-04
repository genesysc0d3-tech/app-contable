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
  if not r.aprendida_bajo_marca or r.confianza <> 0.95 then
    raise exception '[1] FALLA: la señal 0.99 no migró (bajo_marca=%, confianza=%)', r.aprendida_bajo_marca, r.confianza;
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
  raise notice '[1] OK: existentes firmes, 0.99 → aprendida_bajo_marca (0.95), nombres sin tercero, la manual intacta';
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

-- [6] última cartola borrada → huérfana (la fila NO se borra); con otra cartola viva, no
do $$
declare r record; n int;
begin
  insert into public.clasificacion_reglas (id, empresa_id, nombre, patron, patron_tipo, tipo_flujo_match, tipo_propuesto, tipo_dte, documento_origen_id)
  values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Afecta',
          '(^|[^a-zà-ÿ])rosa vera([^a-zà-ÿ]|$)', 'regex', 'entrada', 'boleta', 39, null),
         ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000f1', 'Contraparte aprendida · Exenta',
          '(^|[^a-zà-ÿ])luis mora([^a-zà-ÿ]|$)', 'regex', 'entrada', 'exenta', 41, null);
  perform pg_temp.ins('documentos_subidos', jsonb_build_object('id', '00000000-0000-4000-8000-0000000000c9',
          'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'estado', 'procesado', 'tipo', 'cartola'));
  perform pg_temp.ins('movimientos_raw', jsonb_build_object('id', '00000000-0000-4000-8000-000000000901',
          'empresa_id', '00000000-0000-4000-8000-0000000000f1', 'documento_id', '00000000-0000-4000-8000-0000000000c9',
          'descripcion', 'TRANSFERENCIA DE ROSA VERA', 'monto', 5000, 'tipo_flujo', 'entrada', 'fecha', current_date));
  update public.clasificacion_reglas set documento_origen_id = '00000000-0000-4000-8000-0000000000c9'
   where id = '00000000-0000-4000-8000-0000000000b2';
  -- b2: sostenida solo por c9 (acuñó + corrigió). b3: por c9 y c2.
  insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, movimiento_id, rol) values
    ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000901', 'acuno'),
    ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'corrigio'),
    ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', null, 'acuno'),
    ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000f1', null, 'confirmo');
  -- unique (regla, documento, rol)
  insert into public.clasificacion_regla_soportes (regla_id, documento_id, empresa_id, rol)
  values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', 'acuno')
  on conflict do nothing;
  select count(*) into n from public.clasificacion_regla_soportes where regla_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 2 then raise exception '[6] FALLA: unique de soportes (n=%)', n; end if;

  delete from public.documentos_subidos where id = '00000000-0000-4000-8000-0000000000c9';

  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b2';
  if r.id is null then raise exception '[6] FALLA: la regla se BORRÓ (tabla sagrada)'; end if;
  if r.estado <> 'huerfana' or r.activa or r.nombre <> 'Contraparte de una cartola borrada · Afecta'
     or r.patron <> '(?!)' || r.id::text or r.documento_origen_id is not null then
    raise exception '[6] FALLA: huérfana mal: estado=% activa=% nombre=% patron=% origen=%', r.estado, r.activa, r.nombre, r.patron, r.documento_origen_id;
  end if;
  if r.patron ilike '%rosa%' or r.nombre ilike '%rosa%' then raise exception '[6] FALLA: quedó el tercero'; end if;
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000b3';
  if r.estado <> 'a_prueba' or not r.activa then raise exception '[6] FALLA: b3 (otra cartola viva) quedó %', r.estado; end if;
  -- una regla SIN soportes (las existentes) nunca se vuelve huérfana sola
  select * into r from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a1';
  if r.estado <> 'firme' then raise exception '[6] FALLA: a1 cambió a %', r.estado; end if;
  raise notice '[6] OK: borrar la última cartola → huérfana apagada, sin tercero, centinela; la fila sigue; b3 y a1 intactas';
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
