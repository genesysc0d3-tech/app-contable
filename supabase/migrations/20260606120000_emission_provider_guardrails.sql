-- Guardrails idempotentes para la configuracion de proveedores de emision.
-- Deja prod consistente aunque las migraciones previas de junio se apliquen fuera de orden.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS emision_proveedor text DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS emision_baseapi_sandbox boolean DEFAULT true;

UPDATE public.empresas
SET emision_proveedor = 'mock'
WHERE emision_proveedor IS NULL;

UPDATE public.empresas
SET emision_proveedor = 'libredte'
WHERE emision_proveedor = 'baseapi';

ALTER TABLE public.empresas
  ALTER COLUMN emision_proveedor SET DEFAULT 'mock',
  ALTER COLUMN emision_proveedor SET NOT NULL,
  ALTER COLUMN emision_baseapi_sandbox SET DEFAULT true,
  ALTER COLUMN emision_baseapi_sandbox SET NOT NULL;

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_emision_proveedor_check;

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'libredte', 'sii_local'));

COMMENT ON COLUMN public.empresas.emision_proveedor IS
  'Proveedor usado por la emision: mock, libredte o sii_local.';

COMMENT ON COLUMN public.empresas.emision_baseapi_sandbox IS
  'Flag legado de sandbox BaseAPI; se conserva solo para datos antiguos.';

ALTER TABLE public.boletas_emitidas
  ADD COLUMN IF NOT EXISTS emision_proveedor text DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS emision_sandbox boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS proveedor_respuesta jsonb;

UPDATE public.boletas_emitidas
SET emision_proveedor = 'mock'
WHERE emision_proveedor IS NULL;

UPDATE public.boletas_emitidas
SET emision_proveedor = 'libredte'
WHERE emision_proveedor = 'baseapi';

ALTER TABLE public.boletas_emitidas
  ALTER COLUMN emision_proveedor SET DEFAULT 'mock',
  ALTER COLUMN emision_proveedor SET NOT NULL,
  ALTER COLUMN emision_sandbox SET DEFAULT false,
  ALTER COLUMN emision_sandbox SET NOT NULL;

ALTER TABLE public.boletas_emitidas
  DROP CONSTRAINT IF EXISTS boletas_emitidas_emision_proveedor_check;

ALTER TABLE public.boletas_emitidas
  ADD CONSTRAINT boletas_emitidas_emision_proveedor_check
  CHECK (emision_proveedor IN ('mock', 'libredte', 'sii_local'));

COMMENT ON COLUMN public.boletas_emitidas.emision_proveedor IS
  'Proveedor usado para emitir este documento: mock, libredte o sii_local.';
