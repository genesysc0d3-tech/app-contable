-- Enlace propuesta ↔ job de emisión (motor masivo MassDTE).
--
-- El lote emite N boletas, una por propuesta. El folio REAL que devuelve el SII
-- debe quedar pegado a SU propuesta para dos garantías:
--   (a) la propuesta deja de aparecer como "pendiente por emitir" (getPendientesEmision
--       cruza boletas_emitidas.propuesta_id), y
--   (b) re-correr el lote NO la re-emite: el índice UNIQUE parcial de
--       boletas_emitidas.propuesta_id (migración 20260416_boletas_propuesta_link)
--       ya impide dos boletas vivas para la misma propuesta.
--
-- El dato viaja: la app crea el job con propuesta_id → al registrar el folio, el
-- endpoint /api/sii-local/result lee job.propuesta_id y lo copia a la boleta.
-- La boleta única (sin propuesta) sigue con propuesta_id NULL, como hoy.

ALTER TABLE public.emision_jobs
  ADD COLUMN IF NOT EXISTS propuesta_id uuid REFERENCES public.propuestas_ia(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emision_jobs_propuesta
  ON public.emision_jobs (propuesta_id)
  WHERE propuesta_id IS NOT NULL;
