-- Verificación SOLO LECTURA de la instrumentación (Fase 1 medición) después de
-- aplicar 20261004140000. Sirve en local, staging y prod (envolver en
-- `begin transaction read only; … rollback;` si se corre por la Management API).
-- Devuelve solo códigos y conteos: nada de glosas, nombres ni RUT.

-- 1. Esquema: columnas, triggers, constraints y privilegios.
select 'columnas_nuevas' as chequeo,
       count(*) filter (where table_name = 'propuestas_ia' and (column_name like 'orig\_%' or column_name like 'decision\_%' or column_name like 'editado\_%'))::text as valor,
       '19 esperadas' as esperado
from information_schema.columns where table_schema = 'public'
union all
select 'empresas.es_prueba', count(*)::text, '1'
from information_schema.columns where table_schema = 'public' and table_name = 'empresas' and column_name = 'es_prueba'
union all
select 'triggers_propuestas_ia', string_agg(tgname, ',' order by tgname), 'incluye trg_propuestas_ia_{antes,foto,log_borrado,log_cambio}'
from pg_trigger where tgrelid = 'public.propuestas_ia'::regclass and not tgisinternal
union all
select 'log_privilegio_authenticated',
       (has_table_privilege('authenticated', 'public.propuesta_decisiones', 'select')
        or has_table_privilege('authenticated', 'public.propuesta_decisiones', 'insert'))::text, 'false'
union all
select 'log_rls', relrowsecurity::text, 'true' from pg_class where oid = 'public.propuesta_decisiones'::regclass;

-- 2. Salud post-deploy (ventana: últimos 14 días). Las tres deberían ser 0.
select 'propuestas_nuevas_sin_foto' as chequeo, count(*) as n
from public.propuestas_ia
where created_at > (select min(orig_capturada_at) from public.propuestas_ia)  -- nacida después del deploy
  and orig_capturada_at is null
union all
select 'tipo_dte_fuente_desconocido', count(*)
from public.propuestas_ia
where orig_capturada_at > now() - interval '14 days' and orig_tipo_dte_fuente = 'desconocido'
union all
select 'decisiones_sin_sello', count(*)
from public.propuesta_decisiones
where created_at > now() - interval '14 days' and canal = 'sin_sello';

-- 3. Reparto por canal y por fuente (para mirar que aparezcan check_*, aprobar_cartola, propagacion).
select 'canal' as corte, canal as valor, count(*) as n
from public.propuesta_decisiones where created_at > now() - interval '14 days' group by canal
union all
select 'orig_tipo_dte_fuente', orig_tipo_dte_fuente, count(*)
from public.propuestas_ia where orig_capturada_at > now() - interval '14 days' group by orig_tipo_dte_fuente
order by 1, 3 desc;

-- 4. Tamaño del log (proyectar a un año).
select 'tamano_log' as chequeo, pg_size_pretty(pg_total_relation_size('public.propuesta_decisiones')) as valor,
       (select count(*) from public.propuesta_decisiones)::text as filas;

-- 5. EMPRESAS QUE SE MARCARÍAN es_prueba (decisión del fundador 2026-10-04).
--    Solo LISTA; el UPDATE vive en marcar-empresas-prueba.sql y se corre aparte,
--    después de que el fundador confirme esta lista.
--    - MV INVERSIONES (5fe96a36…) y EMPRESA DOS PRUEBA (7060be65…): extension-server.ts
--    - las de la cuenta interna genesys (usuario operador genesysc0d3@gmail.com)
select e.id,
       e.es_prueba as ya_marcada,
       case
         when e.id in ('5fe96a36-9f7e-408c-b315-2b55d534e1d1', '7060be65-a566-469b-aea3-65457b55fe19') then 'lista_fija'
         else 'cuenta_genesys'
       end as motivo,
       (select count(*) from public.propuestas_ia p where p.empresa_id = e.id) as propuestas
from public.empresas e
where e.id in ('5fe96a36-9f7e-408c-b315-2b55d534e1d1', '7060be65-a566-469b-aea3-65457b55fe19')
   or e.id in (
     select ce.empresa_id
     from public.cuenta_empresas ce
     join public.cuenta_usuarios cu on cu.cuenta_id = ce.cuenta_id
     join public.usuarios u on u.id = cu.usuario_id
     where lower(u.email) = 'genesysc0d3@gmail.com'
   )
order by motivo, e.id;
