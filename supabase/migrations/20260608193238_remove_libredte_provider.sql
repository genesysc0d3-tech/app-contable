-- Remove LibreDTE as an emission provider.
-- BaseAPI remains valid only for legacy boletas that may still carry saved PDFs.

UPDATE public.empresas
SET emision_proveedor = 'mock'
WHERE emision_proveedor = 'libredte';

UPDATE public.boletas_emitidas
SET emision_proveedor = 'mock'
WHERE emision_proveedor = 'libredte';

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_emision_proveedor_check;

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'sii_local'));

ALTER TABLE public.boletas_emitidas
  DROP CONSTRAINT IF EXISTS boletas_emitidas_emision_proveedor_check;

ALTER TABLE public.boletas_emitidas
  ADD CONSTRAINT boletas_emitidas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'baseapi', 'sii_local'));

COMMENT ON COLUMN public.empresas.emision_proveedor IS
  'Proveedor activo de emision: mock o sii_local.';

COMMENT ON COLUMN public.boletas_emitidas.emision_proveedor IS
  'Proveedor usado para emitir este documento: mock, sii_local o baseapi legacy.';
