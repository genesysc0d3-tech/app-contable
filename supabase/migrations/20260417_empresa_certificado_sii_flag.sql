-- Trigger binario: la empresa declara que tiene su certificado digital SII
-- "cargado" en el intermediario (Haulmer/OpenFactura). Sin este flag en true,
-- el intermediario no puede actuar en nombre del contribuyente y la emisión
-- se bloquea. Mock: el toggle se controla manualmente desde la UI. En
-- producción real se completaría al subir el .pfx + clave tributaria.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS tiene_certificado_sii boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empresas.tiene_certificado_sii IS
  'Indica si la empresa delegó su certificado digital al intermediario PSTC. Sin true, no se puede emitir.';
