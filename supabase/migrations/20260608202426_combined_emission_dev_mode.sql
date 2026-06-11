-- Combined emission routing and per-user developer mode.
-- Keeps legacy emision_proveedor for compatibility while new code reads split providers.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS dev_mode boolean DEFAULT false;

ALTER TABLE public.usuarios
  ALTER COLUMN dev_mode SET DEFAULT false;

UPDATE public.usuarios
SET dev_mode = false
WHERE dev_mode IS NULL;

ALTER TABLE public.usuarios
  ALTER COLUMN dev_mode SET NOT NULL;

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS boletas_emision_proveedor text,
  ADD COLUMN IF NOT EXISTS facturas_emision_proveedor text;

UPDATE public.empresas
SET boletas_emision_proveedor = CASE
    WHEN emision_proveedor = 'sii_local' THEN 'sii_local'
    WHEN emision_proveedor = 'simpleapi' THEN 'simpleapi'
    ELSE 'mock'
  END
WHERE boletas_emision_proveedor IS NULL;

UPDATE public.empresas
SET facturas_emision_proveedor = CASE
    WHEN emision_proveedor = 'simpleapi' THEN 'simpleapi'
    ELSE 'mock'
  END
WHERE facturas_emision_proveedor IS NULL;

ALTER TABLE public.empresas
  ALTER COLUMN boletas_emision_proveedor SET DEFAULT 'sii_local',
  ALTER COLUMN boletas_emision_proveedor SET NOT NULL,
  ALTER COLUMN facturas_emision_proveedor SET DEFAULT 'simpleapi',
  ALTER COLUMN facturas_emision_proveedor SET NOT NULL;

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_boletas_emision_proveedor_check,
  DROP CONSTRAINT IF EXISTS empresas_facturas_emision_proveedor_check,
  DROP CONSTRAINT IF EXISTS empresas_emision_proveedor_check;

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_boletas_emision_proveedor_check
    CHECK (boletas_emision_proveedor IN ('mock', 'sii_local', 'simpleapi')),
  ADD CONSTRAINT empresas_facturas_emision_proveedor_check
    CHECK (facturas_emision_proveedor IN ('mock', 'simpleapi')),
  ADD CONSTRAINT empresas_emision_proveedor_check
    CHECK (emision_proveedor IN ('mock', 'sii_local', 'simpleapi'));

ALTER TABLE public.boletas_emitidas
  DROP CONSTRAINT IF EXISTS boletas_emitidas_emision_proveedor_check;

ALTER TABLE public.boletas_emitidas
  ADD CONSTRAINT boletas_emitidas_emision_proveedor_check
    CHECK (emision_proveedor IN ('mock', 'baseapi', 'sii_local', 'simpleapi'));

COMMENT ON COLUMN public.usuarios.dev_mode IS
  'Habilita herramientas internas y modo de prueba visible para este usuario.';

COMMENT ON COLUMN public.empresas.boletas_emision_proveedor IS
  'Proveedor para boletas 39/41: mock, sii_local o simpleapi.';

COMMENT ON COLUMN public.empresas.facturas_emision_proveedor IS
  'Proveedor para facturas 33/34: mock o simpleapi.';

COMMENT ON COLUMN public.empresas.emision_proveedor IS
  'Proveedor legacy de emision; usar boletas_emision_proveedor/facturas_emision_proveedor en codigo nuevo.';

COMMENT ON COLUMN public.boletas_emitidas.emision_proveedor IS
  'Proveedor usado para emitir este documento: mock, sii_local, simpleapi o baseapi legacy.';
