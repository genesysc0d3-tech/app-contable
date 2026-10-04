-- LOTES CIEGOS (métrica de la Fase 4, Check agrupado): de los abonos que una persona
-- JUZGÓ en Check (los sacó de pendiente/editado a listo, sin boleta o a Emitir), ¿qué
-- parte se decidió en un lote grande sin mirar? Línea base del plan: 62% → meta < 25%.
-- Solo lectura, solo conteos. Corre sobre el log propuesta_decisiones (Fase 1), así que
-- cuenta desde el deploy de 20261004160000. Empresas es_prueba fuera; abonos de boleta.
--
-- Juicio de una fila = su PRIMER evento humano que la saca de pendiente/editado.
--   mirada  check_fila / check_detalle, abierta=true, o check_lote ≤ 25 filas
--   grupo   check_grupo sin tocar a mano: respondió una PREGUNTA en grupo (sabe qué
--           decidió: "estas 12 personas me compraron"). No es ciega; se reporta aparte.
--   ciega   el resto: "Poner listas (300)", selección de todo y ✓, etc.
-- Aparte: nacidas 'listo' (regla/alta confianza) que se fueron a Emitir con un
-- "Aprobar" de >25 filas sin que nadie las abriera (nacio_lista_aprobada_ciega).
--
-- Uso (Mac mini, Management API, transacción de solo lectura como linea-base.sql):
--   begin transaction read only; \i lotes-ciegos.sql  rollback;
with emp as (
  select e.id from public.empresas e where not e.es_prueba
),
pob as (
  select p.id, p.empresa_id, p.orig_estado
  from public.propuestas_ia p
  join public.movimientos_raw m on m.id = p.movimiento_id
  join emp on emp.id = p.empresa_id
  where p.orig_capturada_at is not null
    and m.tipo_flujo = 'entrada'
    and coalesce(p.orig_mesa, p.mesa, 'boleta') = 'boleta'
),
juicio as (
  select distinct on (d.propuesta_id)
         d.propuesta_id, d.created_at, d.canal, d.lote_n, d.abierta
  from public.propuesta_decisiones d
  join pob on pob.id = d.propuesta_id
  where d.accion = 'cambio'
    and d.canal in ('check_fila', 'check_detalle', 'check_lote', 'check_grupo')
    and d.antes_estado in ('pendiente', 'editado')
    and d.despues_estado in ('listo', 'rechazado', 'aprobado')
  order by d.propuesta_id, d.created_at, d.id
),
clasif as (
  select date_trunc('week', created_at)::date as semana,
         case
           when canal in ('check_fila', 'check_detalle') or abierta is true
                or (canal = 'check_lote' and lote_n <= 25) then 'mirada'
           when canal = 'check_grupo' then 'grupo'
           else 'ciega'
         end as como
  from juicio
),
nacidas_listas as (
  select date_trunc('week', d.created_at)::date as semana, count(distinct d.propuesta_id) as n
  from public.propuesta_decisiones d
  join pob on pob.id = d.propuesta_id and pob.orig_estado = 'listo'
  where d.accion = 'cambio' and d.canal = 'aprobar_cartola'
    and d.antes_estado = 'listo' and d.despues_estado = 'aprobado'
    and d.lote_n > 25 and d.abierta is not true
    and not exists (select 1 from juicio j where j.propuesta_id = d.propuesta_id)
  group by 1
)
select c.semana,
       count(*)                                         as n_juzgadas,
       count(*) filter (where como = 'mirada')          as n_mirada,
       count(*) filter (where como = 'grupo')           as n_grupo,
       count(*) filter (where como = 'ciega')           as n_ciega,
       round(100.0 * count(*) filter (where como = 'ciega') / nullif(count(*), 0), 1) as pct_ciega,
       coalesce(max(n.n), 0)                            as n_nacio_lista_aprobada_ciega,
       round(100.0 * (count(*) filter (where como = 'ciega') + coalesce(max(n.n), 0))
             / nullif(count(*) + coalesce(max(n.n), 0), 0), 1) as pct_ciega_con_nacidas_listas
from clasif c
left join nacidas_listas n on n.semana = c.semana
group by c.semana
order by c.semana;
