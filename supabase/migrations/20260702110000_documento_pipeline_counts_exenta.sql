-- Auditoría #16/#19: el RPC documento_pipeline_counts omitía el tipo 'exenta'
-- (la normalización de empresa exenta, 2026-07-02) en sus listas de tipos
-- boleteables, desalineado con TIPOS_EMITIBLES (pendientes-emision.ts + emitir-lote).
-- Efecto del bug: toda propuesta 'exenta' (venta exenta genérica) contaba como
-- no_aplica en el avance por documento, aunque sí se emite. Se recrea la función
-- agregando 'exenta' a las 3 listas.
create or replace function public.documento_pipeline_counts(p_empresa uuid, p_desde timestamptz, p_hasta timestamptz)
returns table(documento_id uuid, total int, emitida int, lista int, por_revisar int, no_aplica int)
language sql stable as $$
  with pr as (
    select pi.id, pi.tipo_propuesto, pi.estado, mr.documento_id,
      exists(select 1 from public.boletas_emitidas be where be.propuesta_id = pi.id and be.estado <> 'anulada') as emitida
    from public.propuestas_ia pi
    join public.movimientos_raw mr on mr.id = pi.movimiento_id
    where pi.empresa_id = p_empresa and pi.created_at >= p_desde and pi.created_at < p_hasta and mr.documento_id is not null
  )
  select documento_id,
    count(*)::int,
    count(*) filter (where emitida)::int,
    count(*) filter (where not emitida and tipo_propuesto in ('boleta','exenta','transferencia_p2p','compraventa_crypto','operacion_forex') and estado in ('aprobado','editado'))::int,
    count(*) filter (where not emitida and tipo_propuesto in ('boleta','exenta','transferencia_p2p','compraventa_crypto','operacion_forex') and estado not in ('aprobado','editado','rechazado','omitido'))::int,
    count(*) filter (where not emitida and (tipo_propuesto not in ('boleta','exenta','transferencia_p2p','compraventa_crypto','operacion_forex') or estado in ('rechazado','omitido')))::int
  from pr group by documento_id;
$$;
