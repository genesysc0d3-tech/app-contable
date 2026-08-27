-- CRÍTICO (cazado en vivo 2026-08-26, antes de que doliera): el CHECK de
-- boletas_emitidas.tipo_dte venía del create original mock (39/41/61) y
-- rechazaba las FACTURAS 33/34. Con el carril real eso significaba: el SII
-- emite el folio y el INSERT del registro rebota — folio real vivo sin
-- guardar (la invariante sagrada rota). También bloqueaba el carril mock de
-- facturas. Idempotente.

ALTER TABLE public.boletas_emitidas
  DROP CONSTRAINT IF EXISTS boletas_emitidas_tipo_dte_check;
ALTER TABLE public.boletas_emitidas
  ADD CONSTRAINT boletas_emitidas_tipo_dte_check
  CHECK (tipo_dte IN (33, 34, 39, 41, 61));
