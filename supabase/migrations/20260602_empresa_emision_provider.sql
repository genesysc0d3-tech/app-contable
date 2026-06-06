-- Configuracion del proveedor de emision de DTE por empresa.
-- Mantiene mock como default para no cambiar el comportamiento existente.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS emision_proveedor text NOT NULL DEFAULT 'mock'
    CHECK (emision_proveedor IN ('mock', 'baseapi')),
  ADD COLUMN IF NOT EXISTS emision_baseapi_sandbox boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.empresas.emision_proveedor IS
  'Proveedor usado por la emision por lote: mock o baseapi.';

COMMENT ON COLUMN public.empresas.emision_baseapi_sandbox IS
  'Si true, BaseAPI usa credenciales sandbox configuradas en el servidor.';
