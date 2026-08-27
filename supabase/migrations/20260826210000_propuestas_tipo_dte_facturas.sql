-- El CHECK de propuestas_ia.tipo_dte era de la era boletas (39/41/61) y
-- rechazaba las FACTURAS 33/34 — la factura única real rebotaba con
-- "violates check constraint propuestas_ia_tipo_dte_check" (cazado en vivo
-- 2026-08-26 en la primera prueba del carril). Idempotente.

ALTER TABLE public.propuestas_ia
  DROP CONSTRAINT IF EXISTS propuestas_ia_tipo_dte_check;
ALTER TABLE public.propuestas_ia
  ADD CONSTRAINT propuestas_ia_tipo_dte_check
  CHECK (tipo_dte IS NULL OR tipo_dte IN (33, 34, 39, 41, 61));

COMMENT ON COLUMN public.propuestas_ia.tipo_dte IS
  'Tipo de DTE decidido (33 factura afecta / 34 factura exenta / 39 boleta afecta / 41 boleta exenta / 61 NC). NULL = sin decisión explícita; la cola aplica su gate de confianza.';
