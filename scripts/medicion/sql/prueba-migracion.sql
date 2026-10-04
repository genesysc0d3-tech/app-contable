-- Prueba funcional de 20261004140000_propuestas_foto_y_decisiones.sql.
-- Corre TODO dentro de una transacción y hace ROLLBACK al final: no deja nada.
-- Pensada para el Postgres local desechable (scripts/medicion/probar-migracion-local.sh)
-- o STAGING. JAMÁS prod: el runner se niega (guard por ref/host).
-- Cada comprobación revienta (raise exception) si falla; los NOTICE dan las cifras.
\set ON_ERROR_STOP on
begin;

-- Empresa/documento/300 movimientos y 300 propuestas de prueba.
insert into public.empresas (id, razon_social, rut, es_prueba)
  values ('00000000-0000-4000-8000-0000000000e1', 'EMPRESA PRUEBA MEDICION', '76.000.000-0', true);
insert into public.documentos_subidos (id, empresa_id)
  values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1');
insert into public.movimientos_raw (id, empresa_id, documento_id, descripcion, monto, tipo_flujo)
  select gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1',
         'TRANSF DE PERSONA ' || g, 1000 + g, 'entrada'
  from generate_series(1, 300) g;

create temp table _t_ids on commit drop as
  select row_number() over (order by m.id) as n, m.id as movimiento_id from public.movimientos_raw m
  where m.documento_id = '00000000-0000-4000-8000-0000000000d1';

do $$
declare t0 timestamptz; ms numeric;
begin
  t0 := clock_timestamp();
  insert into public.propuestas_ia (empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total,
                                    fuente_clasificacion, estado, receptor_rut, orig_tipo_dte_fuente,
                                    -- intento de falsificar la foto: el trigger la pisa
                                    orig_tipo_dte, orig_capturada_at)
  select '00000000-0000-4000-8000-0000000000e1', t.movimiento_id, 'boleta',
         case when t.n % 2 = 0 then 41 else null end, 0.9, 1000 + t.n,
         'regla', 'pendiente', case when t.n % 3 = 0 then '11.111.111-1' else null end,
         case when t.n <= 200 then 'regla' else null end,
         39, '2000-01-01'
  from _t_ids t;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '[1] insert 300 propuestas con trigger de foto: % ms', round(ms, 1);
end $$;

-- [1] el insert llena orig_* (y no deja falsificar la foto)
do $$
declare n_total int; n_foto int; n_desc int; n_doc int; n_falsa int; n_rec int;
begin
  select count(*), count(*) filter (where orig_capturada_at > now() - interval '1 hour'),
         count(*) filter (where orig_tipo_dte_fuente = 'desconocido'),
         count(*) filter (where orig_documento_id = '00000000-0000-4000-8000-0000000000d1'),
         count(*) filter (where orig_tipo_dte is distinct from tipo_dte),
         count(*) filter (where orig_con_receptor)
    into n_total, n_foto, n_desc, n_doc, n_falsa, n_rec
  from public.propuestas_ia where empresa_id = '00000000-0000-4000-8000-0000000000e1';
  if n_total <> 300 or n_foto <> 300 or n_desc <> 100 or n_doc <> 300 or n_falsa <> 0 or n_rec <> 100 then
    raise exception '[1] FALLA foto: total % foto % desconocido % doc % falsa % receptor %', n_total, n_foto, n_desc, n_doc, n_falsa, n_rec;
  end if;
  raise notice '[1] OK: 300 con foto, 100 desconocido (sin fuente), orig_tipo_dte no falsificable, receptor solo booleano';
end $$;

-- [2] update de orig_* revienta
do $$
begin
  begin
    update public.propuestas_ia set orig_tipo_dte = 39
     where empresa_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception '[2] FALLA: se pudo editar la foto';
  exception when others then
    if sqlerrm not like 'FOTO_ORIGINAL_INMUTABLE%' then raise; end if;
    raise notice '[2] OK: %', sqlerrm;
  end;
end $$;

-- [3] update sin sello → sin_sello (y deja fila en el log con canal sin_sello)
do $$
declare v_id uuid; v_canal text; v_log int; v_edit timestamptz;
begin
  select p.id into v_id from public.propuestas_ia p join _t_ids t on t.movimiento_id = p.movimiento_id where t.n = 1;
  update public.propuestas_ia set estado = 'rechazado' where id = v_id;
  select decision_canal, editado_at into v_canal, v_edit from public.propuestas_ia where id = v_id;
  select count(*) into v_log from public.propuesta_decisiones where propuesta_id = v_id and canal = 'sin_sello' and antes_estado = 'pendiente' and despues_estado = 'rechazado';
  if v_canal <> 'sin_sello' or v_log <> 1 or v_edit is not null then
    raise exception '[3] FALLA sin_sello: canal % log % editado_at %', v_canal, v_log, v_edit;
  end if;
  -- un sellado y DESPUÉS uno sin sello: el lote viejo no se hereda
  update public.propuestas_ia set estado = 'pendiente', decision_canal = 'check_fila',
         decision_lote = gen_random_uuid(), decision_lote_n = 1, decision_abierta = false
   where id = v_id;
  update public.propuestas_ia set estado = 'listo' where id = v_id;
  select decision_canal into v_canal from public.propuestas_ia where id = v_id;
  if v_canal <> 'sin_sello' then raise exception '[3] FALLA: heredó el sello anterior (%)', v_canal; end if;
  -- solo glosa: no deja fila en el log
  update public.propuestas_ia set notas = 'glosa', decision_canal = 'check_detalle', decision_lote = gen_random_uuid(), decision_lote_n = 1 where id = v_id;
  select count(*) into v_log from public.propuesta_decisiones where propuesta_id = v_id;
  if v_log <> 3 then raise exception '[3] FALLA: el cambio de glosa dejó fila (log=%)', v_log; end if;
  raise notice '[3] OK: sin sello → sin_sello (decision_por = auth.uid()), no hereda lote, glosa sola no se registra';
end $$;

-- [3b] canal fuera de la lista cerrada → CHECK revienta
do $$
begin
  begin
    update public.propuestas_ia set decision_canal = 'inventado', decision_lote = gen_random_uuid()
     where empresa_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception '[3b] FALLA: aceptó un canal inventado';
  exception when check_violation then
    raise notice '[3b] OK: canal fuera de lista → check_violation';
  end;
end $$;

-- [4] lote de 300 en trozos de 50 (como aprobarCartola) → 300 filas en el log, mismo lote.
--     Costo del trigger: mismo trabajo con triggers apagados (session_replication_role).
do $$
declare
  v_lote uuid := gen_random_uuid(); v_lote_base uuid := gen_random_uuid();
  i int; t0 timestamptz; ms_con numeric; ms_sin numeric; v_log int; v_n int; v_edit int;
begin
  -- baseline SIN triggers (requiere superusuario; si no, se informa y sigue)
  begin
    perform set_config('session_replication_role', 'replica', true);
    t0 := clock_timestamp();
    for i in 0..5 loop
      update public.propuestas_ia p set estado = 'listo', decision_canal = 'check_lote', decision_lote = v_lote_base, decision_lote_n = 300
        from _t_ids t where t.movimiento_id = p.movimiento_id and t.n > i * 50 and t.n <= (i + 1) * 50;
    end loop;
    ms_sin := extract(epoch from clock_timestamp() - t0) * 1000;
    perform set_config('session_replication_role', 'origin', true);
    -- volver al estado anterior sin triggers para comparar el mismo cambio
    perform set_config('session_replication_role', 'replica', true);
    update public.propuestas_ia set estado = 'pendiente' where empresa_id = '00000000-0000-4000-8000-0000000000e1';
    perform set_config('session_replication_role', 'origin', true);
  exception when insufficient_privilege then
    ms_sin := null;
    raise notice '[4] (sin superusuario: no se mide la línea base sin triggers)';
  end;

  t0 := clock_timestamp();
  for i in 0..5 loop
    update public.propuestas_ia p set estado = 'listo', decision_canal = 'check_lote', decision_lote = v_lote,
           decision_lote_n = 300, decision_abierta = false, decision_por = '00000000-0000-4000-8000-00000000000a'
      from _t_ids t where t.movimiento_id = p.movimiento_id and t.n > i * 50 and t.n <= (i + 1) * 50;
  end loop;
  ms_con := extract(epoch from clock_timestamp() - t0) * 1000;

  select count(*), count(distinct lote_n) into v_log, v_n from public.propuesta_decisiones
   where lote_id = v_lote and canal = 'check_lote' and despues_estado = 'listo' and lote_n = 300
     and usuario_id = '00000000-0000-4000-8000-00000000000a' and documento_id = '00000000-0000-4000-8000-0000000000d1';
  if v_log <> 300 then raise exception '[4] FALLA lote: % filas en el log (esperaba 300)', v_log; end if;
  select count(*) into v_edit from public.propuestas_ia where decision_lote = v_lote and editado_at is not null;
  if v_edit <> 0 then raise exception '[4] FALLA: pasar a listo marcó editado_at (%)', v_edit; end if;
  raise notice '[4] OK: lote 300 (6 trozos de 50) → % filas en el log. Con triggers: % ms (%/trozo); sin triggers: % ms',
    v_log, round(ms_con, 1), round(ms_con / 6, 2), coalesce(round(ms_sin, 1)::text, 'n/d');
end $$;

-- [4b] cambio de tipo sellado → editado_at/editado_canal + antes/después en el log
do $$
declare v_id uuid; v_canal text; v_log int;
begin
  select p.id into v_id from public.propuestas_ia p join _t_ids t on t.movimiento_id = p.movimiento_id where t.n = 2;
  update public.propuestas_ia set tipo_dte = 39, tipo_propuesto = 'boleta', estado = 'editado',
         decision_canal = 'check_detalle', decision_lote = gen_random_uuid(), decision_lote_n = 1, decision_abierta = true
   where id = v_id;
  select editado_canal into v_canal from public.propuestas_ia where id = v_id and editado_at is not null;
  select count(*) into v_log from public.propuesta_decisiones
   where propuesta_id = v_id and canal = 'check_detalle' and antes_tipo_dte = 41 and despues_tipo_dte = 39 and abierta and orig_tipo_dte = 41;
  if v_canal is distinct from 'check_detalle' or v_log <> 1 then
    raise exception '[4b] FALLA editado: canal % log %', v_canal, v_log;
  end if;
  raise notice '[4b] OK: cambio de tipo → editado_at + log antes 41 / después 39 con la foto 41';
end $$;

-- [5] resumen_propuestas_a_borrar: solo conteos
do $$
declare r jsonb;
begin
  r := public.resumen_propuestas_a_borrar('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1');
  if (r->>'total')::int <> 300 or (r->'por_tipo_dte_fuente'->>'desconocido')::int <> 100 or r::text ~* '(TRANSF|PERSONA|11\.111)' then
    raise exception '[5] FALLA resumen: %', r;
  end if;
  if public.resumen_propuestas_a_borrar('00000000-0000-4000-8000-0000000000e1', null) ->> 'total' <> '0' then
    raise exception '[5] FALLA: sin documento ni propuesta debe contar 0';
  end if;
  raise notice '[5] OK resumen: %', r;
end $$;

-- [5b] escritura DIRECTA de la clienta (rol authenticated, sin pasar por la app):
--      el trigger security definer igual registra, como sin_sello y con su auth.uid().
do $$
declare v_id uuid; v_por uuid; v_log int;
begin
  select p.id into v_id from public.propuestas_ia p join _t_ids t on t.movimiento_id = p.movimiento_id where t.n = 5;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000bb', true);
  set local role authenticated;
  update public.propuestas_ia set estado = 'rechazado' where id = v_id;
  reset role;
  select decision_por into v_por from public.propuestas_ia where id = v_id and decision_canal = 'sin_sello';
  select count(*) into v_log from public.propuesta_decisiones where propuesta_id = v_id and canal = 'sin_sello' and usuario_id = '00000000-0000-4000-8000-0000000000bb';
  if v_por is distinct from '00000000-0000-4000-8000-0000000000bb' or v_log <> 1 then
    raise exception '[5b] FALLA escritura directa: por % log %', v_por, v_log;
  end if;
  raise notice '[5b] OK: escritura directa de authenticated → sin_sello con su auth.uid() en el log';
end $$;

-- [6] borrar un movimiento (cascada) deja una fila 'borrado'
do $$
declare v_mov uuid; v_prop uuid; v_log int;
begin
  select t.movimiento_id, p.id into v_mov, v_prop from _t_ids t join public.propuestas_ia p on p.movimiento_id = t.movimiento_id where t.n = 3;
  delete from public.movimientos_raw where id = v_mov;
  select count(*) into v_log from public.propuesta_decisiones where propuesta_id = v_prop and accion = 'borrado' and canal = 'borrado' and antes_con_receptor;
  if v_log <> 1 then raise exception '[6] FALLA borrado: %', v_log; end if;
  raise notice '[6] OK: borrar movimiento → 1 fila borrado (sin PII)';
end $$;

-- [6b] borrado de documento completo (eliminar/deshacer = 1 sentencia) → 1 sola ejecución del trigger
do $$
declare t0 timestamptz; v_antes int; v_despues int;
begin
  select count(*) into v_antes from public.propuesta_decisiones where accion = 'borrado' and empresa_id = '00000000-0000-4000-8000-0000000000e1';
  t0 := clock_timestamp();
  delete from public.movimientos_raw where documento_id = '00000000-0000-4000-8000-0000000000d1'
    and id in (select movimiento_id from _t_ids where n between 4 and 103);
  select count(*) into v_despues from public.propuesta_decisiones where accion = 'borrado' and empresa_id = '00000000-0000-4000-8000-0000000000e1';
  if v_despues - v_antes <> 100 then raise exception '[6b] FALLA: % filas borrado (esperaba 100)', v_despues - v_antes; end if;
  raise notice '[6b] OK: borrar 100 movimientos en 1 sentencia → 100 filas borrado en % ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;

-- [7] borrar la EMPRESA (purga ARCO) no recrea rastro y no revienta
do $$
declare v_antes int; v_despues int;
begin
  select count(*) into v_antes from public.propuesta_decisiones where empresa_id = '00000000-0000-4000-8000-0000000000e1';
  delete from public.empresas where id = '00000000-0000-4000-8000-0000000000e1';
  select count(*) into v_despues from public.propuesta_decisiones where empresa_id = '00000000-0000-4000-8000-0000000000e1';
  if v_despues <> v_antes then raise exception '[7] FALLA: la purga dejó % filas nuevas', v_despues - v_antes; end if;
  -- segunda llave (purga-cuenta.ts): borrado explícito del log de la empresa
  delete from public.propuesta_decisiones where empresa_id = '00000000-0000-4000-8000-0000000000e1';
  select count(*) into v_despues from public.propuesta_decisiones where empresa_id = '00000000-0000-4000-8000-0000000000e1';
  if v_despues <> 0 then raise exception '[7] FALLA: quedan % filas', v_despues; end if;
  raise notice '[7] OK: borrar la empresa no agregó filas (había % de antes) y tras la purga explícita quedan 0', v_antes;
end $$;

-- [8] anon/authenticated no leen ni escriben el log
do $$
begin
  if has_table_privilege('authenticated', 'public.propuesta_decisiones', 'select')
     or has_table_privilege('authenticated', 'public.propuesta_decisiones', 'insert')
     or has_table_privilege('anon', 'public.propuesta_decisiones', 'select')
     or has_function_privilege('authenticated', 'public.resumen_propuestas_a_borrar(uuid, uuid, uuid)', 'execute') then
    raise exception '[8] FALLA: privilegios abiertos';
  end if;
  raise notice '[8] OK: log y resumen cerrados para anon/authenticated';
end $$;

rollback;
