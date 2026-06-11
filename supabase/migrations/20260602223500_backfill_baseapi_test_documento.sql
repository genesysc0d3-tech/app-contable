-- Crea el documento agregado para la boleta de prueba BaseAPI emitida antes
-- de que el flujo por lote insertara documentos_subidos.

INSERT INTO public.documentos_subidos (
  empresa_id,
  nombre_archivo,
  tipo,
  storage_path,
  estado,
  movimientos_detectados,
  progreso_ia
)
SELECT
  b.empresa_id,
  'Boleta #' || b.folio || ' - ' || COALESCE(b.receptor_razon_social, 'consumidor final'),
  'boleta_unica',
  'boleta-lote://' || b.id,
  'procesado',
  1,
  jsonb_build_object(
    'origen', 'emision_lote',
    'proveedor', b.emision_proveedor,
    'sandbox', b.emision_sandbox,
    'propuesta_id', b.propuesta_id,
    'boleta_id', b.id,
    'folio', b.folio,
    'tipo_dte', b.tipo_dte,
    'monto_total', b.monto_total,
    'receptor', COALESCE(b.receptor_razon_social, 'consumidor final'),
    'etiqueta', 'Boleta emitida'
  )
FROM public.boletas_emitidas b
WHERE b.track_id = '9939045780'
  AND b.folio = 12
  AND b.fecha_emision = DATE '2026-06-02'
  AND NOT EXISTS (
    SELECT 1
    FROM public.documentos_subidos d
    WHERE d.progreso_ia->>'boleta_id' = b.id::text
  );
