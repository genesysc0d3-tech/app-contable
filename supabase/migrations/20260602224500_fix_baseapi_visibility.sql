-- Corrige visibilidad de emisiones BaseAPI sandbox realizadas antes de fijar
-- la fecha visible de la app. Se limita a emisiones recientes.

UPDATE public.boletas_emitidas
SET fecha_emision = created_at::date
WHERE emision_proveedor = 'baseapi'
  AND emision_sandbox = true
  AND created_at >= now() - interval '14 days'
  AND fecha_emision <> created_at::date;

INSERT INTO public.documentos_subidos (
  empresa_id,
  nombre_archivo,
  tipo,
  storage_path,
  estado,
  movimientos_detectados,
  created_at,
  progreso_ia
)
SELECT
  b.empresa_id,
  'Boleta #' || b.folio || ' - ' || COALESCE(b.receptor_razon_social, 'consumidor final'),
  'boleta_unica',
  CASE WHEN b.propuesta_id IS NULL THEN 'boleta-unica://' || b.id ELSE 'boleta-lote://' || b.id END,
  'procesado',
  1,
  (b.fecha_emision::text || 'T12:00:00.000Z')::timestamptz,
  jsonb_build_object(
    'origen', CASE WHEN b.propuesta_id IS NULL THEN 'emision_directa' ELSE 'emision_lote' END,
    'proveedor', b.emision_proveedor,
    'sandbox', b.emision_sandbox,
    'propuesta_id', b.propuesta_id,
    'boleta_id', b.id,
    'folio', b.folio,
    'tipo_dte', b.tipo_dte,
    'monto_total', b.monto_total,
    'receptor', COALESCE(b.receptor_razon_social, 'consumidor final'),
    'etiqueta', CASE WHEN b.propuesta_id IS NULL THEN 'Boleta unica' ELSE 'Boleta emitida' END
  )
FROM public.boletas_emitidas b
WHERE b.emision_proveedor = 'baseapi'
  AND b.created_at >= now() - interval '14 days'
  AND NOT EXISTS (
    SELECT 1
    FROM public.documentos_subidos d
    WHERE d.progreso_ia->>'boleta_id' = b.id::text
  );
