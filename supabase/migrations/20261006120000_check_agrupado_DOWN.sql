-- Revierte 20261006120000_check_agrupado.sql.
--
-- ORDEN: revertir PRIMERO el código (el código nuevo sella 'check_grupo' y escribe
-- nacio_lote). Antes de correr esto: respaldo en la Mac mini
-- (~/.massdte-respaldo/respaldar.sh --ahora).
--
-- Lo que NO se deshace, a propósito:
--  - El CHECK de canales SIGUE aceptando 'check_grupo': hay filas y eventos del log
--    sellados con él, y un CHECK sin el valor haría fallar cualquier UPDATE posterior
--    de esas filas (el CHECK se evalúa sobre la fila nueva completa, y editado_canal
--    no cambia en cada escritura). Un superconjunto no rompe al código viejo.
--  - Las reglas que nacieron en una respuesta en grupo se quedan (tabla SAGRADA); solo
--    se pierde el vínculo nacio_lote (respaldado en _respaldo_nacio_lote_<fecha>).
--
-- evidencia_reglas vuelve al cuerpo de 20261005120000: check_grupo deja de contar como
-- mirada (esas reglas necesitan 3 cartolas para quedar firmes) y OJO: un "Sí" de grupo a
-- ciegas (check_grupo, abierta=false) VUELVE a contar como confirmación de la regla.
-- responder_grupo_ventas se elimina: el código de la Fase 4 deja de poder responder en grupo.

set lock_timeout = '5s';

do $$
declare
  v_tabla text := '_respaldo_nacio_lote_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clasificacion_reglas' and column_name = 'nacio_lote') then
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format('create table public.%I as select id, empresa_id, nacio_lote from public.clasificacion_reglas where nacio_lote is not null', v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
    raise notice 'respaldo: public.%', v_tabla;
  end if;
end $$;

drop function if exists public.responder_grupo_ventas(uuid, uuid, uuid, integer, uuid, boolean, jsonb);
drop index if exists public.idx_clasificacion_reglas_nacio_lote;
alter table public.clasificacion_reglas drop column if exists nacio_lote;

create or replace function public.evidencia_reglas(p_empresa_id uuid, p_regla_ids uuid[] default null)
returns table (
  regla_id uuid,
  confirmadas integer,
  confirmadas_miradas integer,
  aciertos integer,
  soportes integer,
  confirmadas_tras_correccion integer,
  documentos_confirman uuid[],
  glosa text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    select cr.id, cr.tipo_dte, cr.evidencia_desde, cr.corregida_at
      from public.clasificacion_reglas cr
     where cr.empresa_id = p_empresa_id
       and (p_regla_ids is null or cr.id = any(p_regla_ids))
  ),
  p as (
    select pr.id, pr.regla_id, coalesce(pr.orig_documento_id, m.documento_id) as documento_id,
           m.descripcion, pr.created_at
      from public.propuestas_ia pr
      join r on r.id = pr.regla_id
      join public.movimientos_raw m on m.id = pr.movimiento_id
     where pr.empresa_id = p_empresa_id
       -- solo filas nacidas después de la última corrección (B1: las confirmaciones
       -- viejas eran del tipo corregido y no pueden re-promover la regla)
       and pr.created_at > coalesce(r.evidencia_desde, '-infinity'::timestamptz)
  ),
  ok as (
    select p.id, p.regla_id, p.documento_id,
           p.created_at > coalesce(r.corregida_at, 'infinity'::timestamptz) as tras_correccion,
           exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id
                and (d.canal in ('check_fila', 'check_detalle')
                     or (d.canal in ('check_lote', 'aprobar_cartola') and d.lote_n <= 25))
           ) as mirada
      from p
      join r on r.id = p.regla_id
     where exists (
             select 1 from public.boletas_emitidas b
              where b.propuesta_id = p.id
                and b.empresa_id = p_empresa_id
                and b.estado in ('aceptado', 'aceptado_reparos')
                and b.emision_sandbox is not true
                and b.tipo_dte = r.tipo_dte
           )
       and not exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id
                and d.canal in ('check_fila', 'check_detalle', 'check_lote', 'mcp', 'telegram')
                and d.antes_tipo_dte is distinct from d.despues_tipo_dte
           )
       -- una hermana que la PROPAGACIÓN ligó a la regla (misma cartola que la enseñó, a
       -- ciegas) no es evidencia independiente
       and not exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id and d.canal = 'propagacion'
           )
  ),
  docs as (
    select ok.regla_id, ok.documento_id, bool_or(ok.mirada) as mirada, count(*)::int as filas,
           bool_or(ok.tras_correccion) as tras_correccion
      from ok
     where ok.documento_id is not null
     group by 1, 2
  ),
  glosa_soporte as (
    select distinct on (s.regla_id) s.regla_id, m.descripcion
      from public.clasificacion_regla_soportes s
      join r on r.id = s.regla_id
      join public.movimientos_raw m on m.id = s.movimiento_id
     where s.empresa_id = p_empresa_id
     order by s.regla_id, s.created_at desc
  ),
  glosa_propuesta as (  -- la glosa no depende de la ventana de evidencia
    select distinct on (pr.regla_id) pr.regla_id, m.descripcion
      from public.propuestas_ia pr
      join r on r.id = pr.regla_id
      join public.movimientos_raw m on m.id = pr.movimiento_id
     where pr.empresa_id = p_empresa_id
     order by pr.regla_id, pr.created_at desc
  )
  select r.id,
         coalesce((select count(*) from docs where docs.regla_id = r.id), 0)::int,
         coalesce((select count(*) from docs where docs.regla_id = r.id and docs.mirada), 0)::int,
         coalesce((select sum(filas) from docs where docs.regla_id = r.id), 0)::int,
         coalesce((select count(*) from public.clasificacion_regla_soportes s where s.regla_id = r.id), 0)::int,
         coalesce((select count(*) from docs where docs.regla_id = r.id and docs.tras_correccion), 0)::int,
         coalesce((select array_agg(docs.documento_id order by docs.documento_id) from docs where docs.regla_id = r.id), '{}'::uuid[]),
         coalesce((select gs.descripcion from glosa_soporte gs where gs.regla_id = r.id),
                  (select gp.descripcion from glosa_propuesta gp where gp.regla_id = r.id))
    from r;
$$;

revoke all on function public.evidencia_reglas(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.evidencia_reglas(uuid, uuid[]) to service_role;

reset lock_timeout;
