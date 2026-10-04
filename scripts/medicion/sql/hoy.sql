-- Medición del clasificador HOY (Fase 0/1, solo lectura, sin log): cobertura al
-- nacer, abstención y FALSOS SEGUROS (cota inferior) por empresa × fuente × banda.
-- Funciona con o sin la migración 20261004160000 (lee orig_* y es_prueba vía
-- to_jsonb: si la columna no existe, cae al valor actual / false).
-- Exactitud: la banda "al nacer" sale de orig_* (foto inmutable de la Fase 1) cuando
-- existe → exacta. Sin foto (filas anteriores a 20261004160000) se usan los valores
-- ACTUALES, que ya no son los del nacimiento: Deshacer una regla (Fase 3) re-evalúa
-- confianza/fuente_clasificacion/regla_id y la propagación liga regla_id → aproximada.
-- Los cambios afecta↔exenta sin foto NO se ven (el valor quedó pisado): falsos
-- seguros = COTA INFERIOR.
-- Población: abonos (tipo_flujo='entrada') de la mesa boleta, empresas no es_prueba.
-- Salida: SOLO códigos y conteos; empresa_id lo seudonimiza el script (E1, E2…).
with emp as (
  select e.id
  from public.empresas e
  where not coalesce((to_jsonb(e) ->> 'es_prueba')::boolean, false)
),
pob as (
  select p.empresa_id,
         m.documento_id,
         p.estado,
         coalesce(to_jsonb(p) ->> 'orig_fuente', p.fuente_clasificacion, 'sin_fuente') as fuente,
         coalesce((to_jsonb(p) ->> 'orig_confianza')::numeric, p.confianza) as conf
  from public.propuestas_ia p
  join public.movimientos_raw m on m.id = p.movimiento_id
  join emp on emp.id = p.empresa_id
  where m.tipo_flujo = 'entrada'
    and coalesce(p.mesa, 'boleta') = 'boleta'
),
-- Cartola cerrada: procesada y sin nada pendiente de juicio.
abiertas as (
  select distinct documento_id from pob where estado in ('pendiente', 'editado', 'listo')
),
cerradas as (
  select d.id from public.documentos_subidos d
  where d.estado = 'procesado'
    and d.id in (select documento_id from pob)
    and d.id not in (select documento_id from abiertas)
)
select empresa_id::text as empresa_id,
       fuente,
       case
         when conf is null then 'sin'
         when conf >= 0.85 then 'alta'      -- AUTO_STAGE_THRESHOLD (processor.ts)
         when conf >= 0.80 then 'bulk'      -- BULK_MIN_CONFIANZA
         when conf >= 0.50 then 'baja'
         else 'muy_baja'
       end as banda,
       count(*) as n,
       count(*) filter (where documento_id in (select id from cerradas)) as n_cerrada,
       count(*) filter (where documento_id in (select id from cerradas)
                          and estado in ('rechazado', 'descartado', 'oculto')) as n_cerrada_juzgada_no
from pob
group by 1, 2, 3
order by 1, 2, 3;
