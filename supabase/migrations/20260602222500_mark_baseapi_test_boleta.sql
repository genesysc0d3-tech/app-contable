-- Corrige metadata de la boleta de prueba emitida por BaseAPI antes de crear
-- las columnas de proveedor. No afecta otras boletas.

UPDATE public.boletas_emitidas
SET emision_proveedor = 'baseapi',
    emision_sandbox = true
WHERE track_id = '9939045780'
  AND folio = 12
  AND fecha_emision = DATE '2026-06-02';
