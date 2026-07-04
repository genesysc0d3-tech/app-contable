-- Correct test emissions created during the Chile evening of 2026-06-02.
-- They were stamped with the UTC date 2026-06-03 before emission routes used America/Santiago.
with fixed_boletas as (
  update boletas_emitidas
  set fecha_emision = '2026-06-02'
  where fecha_emision = '2026-06-03'
    and created_at >= '2026-06-03T00:00:00Z'
    and created_at < '2026-06-03T04:00:00Z'
  returning id
)
update documentos_subidos d
set created_at = '2026-06-02T12:00:00Z'
from fixed_boletas b
where d.progreso_ia->>'boleta_id' = b.id::text;

select pg_notify('pgrst', 'reload schema');
