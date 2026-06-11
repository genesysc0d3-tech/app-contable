-- Metadata del proveedor real/mock usado al emitir cada boleta.

ALTER TABLE public.boletas_emitidas
  ADD COLUMN IF NOT EXISTS emision_proveedor text NOT NULL DEFAULT 'mock'
    CHECK (emision_proveedor IN ('mock', 'baseapi')),
  ADD COLUMN IF NOT EXISTS emision_sandbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proveedor_respuesta jsonb;

COMMENT ON COLUMN public.boletas_emitidas.emision_proveedor IS
  'Proveedor usado para emitir este documento: mock o baseapi.';

COMMENT ON COLUMN public.boletas_emitidas.emision_sandbox IS
  'Indica si la emision del proveedor externo fue en sandbox.';

COMMENT ON COLUMN public.boletas_emitidas.proveedor_respuesta IS
  'Respuesta resumida del proveedor externo, sin credenciales ni secretos.';
