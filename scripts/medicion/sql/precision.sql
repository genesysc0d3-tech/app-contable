-- PRECISIÓN real del clasificador (Fase 1, ~2 semanas después del deploy de la
-- migración 20261004140000). Solo filas CON FOTO (orig_capturada_at no nulo = nacidas
-- después del deploy) en cartolas CERRADAS, empresas no es_prueba, abonos de boleta.
-- Por empresa × orig_tipo_dte_fuente × banda al nacer:
--   n_mirada            filas que un humano MIRÓ (algún evento check_fila/check_detalle o abierta=true)
--   k_acierto_mirada    de ésas: tipo final = foto, terminó aprobada y ningún canal humano
--                       le cambió tipo ni receptor                     → PRECISIÓN ESTRICTA
--   n_aceptada_ciega    aprobadas solo por aprobar_cartola / check_lote sin abrir (NO cuenta como acierto)
--   n_propagada / k_propagada_corregida  error de propagación (hermanos que después un humano corrigió)
--   n_sin_sello         filas con algún evento sin_sello (salud del sello: debería ser 0)
--   n_fuente_desconocida (salud: debería ser 0)
-- Salida: SOLO códigos y conteos.
with emp as (
  select e.id from public.empresas e where not e.es_prueba
),
pob as (
  select p.id, p.empresa_id, p.orig_documento_id as documento_id, p.estado, p.tipo_dte,
         p.orig_tipo_dte, coalesce(p.orig_tipo_dte_fuente, 'desconocido') as fuente_tipo,
         case
           when p.orig_confianza is null then 'sin'
           when p.orig_confianza >= 0.85 then 'alta'
           when p.orig_confianza >= 0.80 then 'bulk'
           when p.orig_confianza >= 0.50 then 'baja'
           else 'muy_baja'
         end as banda
  from public.propuestas_ia p
  join public.movimientos_raw m on m.id = p.movimiento_id
  join emp on emp.id = p.empresa_id
  where p.orig_capturada_at is not null
    and m.tipo_flujo = 'entrada'
    and coalesce(p.orig_mesa, p.mesa, 'boleta') = 'boleta'
),
cerradas as (
  select d.id from public.documentos_subidos d
  where d.estado = 'procesado'
    and d.id in (select documento_id from pob)
    and not exists (select 1 from pob x where x.documento_id = d.id and x.estado in ('pendiente', 'editado', 'listo'))
),
ev as (
  select l.propuesta_id,
         bool_or(l.canal in ('check_fila', 'check_detalle') or l.abierta is true) as mirada,
         bool_or(l.canal in ('check_fila', 'check_detalle', 'check_lote', 'mcp', 'telegram')
                 and (l.antes_tipo_dte is distinct from l.despues_tipo_dte or l.receptor_cambio)) as humano_cambio,
         bool_or(l.canal = 'propagacion') as propagada,
         min(l.created_at) filter (where l.canal = 'propagacion') as t_propagacion,
         bool_or(l.canal = 'sin_sello') as sin_sello,
         bool_or(l.despues_estado = 'aprobado' and l.canal in ('aprobar_cartola', 'check_lote') and l.abierta is not true) as aprobada_ciega
  from public.propuesta_decisiones l
  where l.propuesta_id in (select id from pob)
  group by l.propuesta_id
),
corregida_tras_propagar as (
  select distinct l.propuesta_id
  from public.propuesta_decisiones l
  join ev on ev.propuesta_id = l.propuesta_id and ev.propagada
  where l.created_at > ev.t_propagacion
    and l.canal in ('check_fila', 'check_detalle', 'check_lote')
    and l.antes_tipo_dte is distinct from l.despues_tipo_dte
)
select p.empresa_id::text as empresa_id,
       p.fuente_tipo,
       p.banda,
       count(*) as n,
       count(*) filter (where coalesce(ev.mirada, false)) as n_mirada,
       count(*) filter (where coalesce(ev.mirada, false)
                          and p.tipo_dte is not distinct from p.orig_tipo_dte
                          and p.estado = 'aprobado'
                          and not coalesce(ev.humano_cambio, false)) as k_acierto_mirada,
       count(*) filter (where p.estado = 'aprobado' and not coalesce(ev.mirada, false)
                          and coalesce(ev.aprobada_ciega, false)) as n_aceptada_ciega,
       count(*) filter (where coalesce(ev.propagada, false)) as n_propagada,
       count(*) filter (where p.id in (select propuesta_id from corregida_tras_propagar)) as k_propagada_corregida,
       count(*) filter (where coalesce(ev.sin_sello, false)) as n_sin_sello,
       count(*) filter (where p.fuente_tipo = 'desconocido') as n_fuente_desconocida
from pob p
left join ev on ev.propuesta_id = p.id
where p.documento_id in (select id from cerradas)
group by 1, 2, 3
order by 1, 2, 3;
