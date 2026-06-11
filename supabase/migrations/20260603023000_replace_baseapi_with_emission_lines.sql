-- Reemplaza BaseAPI como linea activa por proveedores separados:
-- mock, libredte y sii_local.

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_emision_proveedor_check;

UPDATE public.empresas
SET emision_proveedor = 'libredte'
WHERE emision_proveedor = 'baseapi';

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'libredte', 'sii_local'));

COMMENT ON COLUMN public.empresas.emision_proveedor IS
  'Proveedor usado por la emision: mock, libredte o sii_local.';

ALTER TABLE public.boletas_emitidas
  DROP CONSTRAINT IF EXISTS boletas_emitidas_emision_proveedor_check;

UPDATE public.boletas_emitidas
SET emision_proveedor = 'libredte'
WHERE emision_proveedor = 'baseapi';

ALTER TABLE public.boletas_emitidas
  ADD CONSTRAINT boletas_emitidas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'libredte', 'sii_local'));

COMMENT ON COLUMN public.boletas_emitidas.emision_proveedor IS
  'Proveedor usado para emitir este documento: mock, libredte o sii_local.';
