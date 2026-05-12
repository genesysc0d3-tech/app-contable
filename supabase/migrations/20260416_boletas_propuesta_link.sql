-- Vincula boletas_emitidas con la propuesta_ia que la originó.
-- Permite (a) evitar emitir dos veces la misma propuesta, (b) trazabilidad
-- propuesta → boleta, y (c) auditoría desde el revisor.

ALTER TABLE public.boletas_emitidas
  ADD COLUMN IF NOT EXISTS propuesta_id uuid REFERENCES public.propuestas_ia(id) ON DELETE SET NULL;

-- Una propuesta solo puede tener una boleta vigente (no anulada).
-- Permitimos múltiples si la primera se anula y se reemite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_boletas_propuesta_unica_vigente
  ON public.boletas_emitidas (propuesta_id)
  WHERE propuesta_id IS NOT NULL AND estado <> 'anulada';

CREATE INDEX IF NOT EXISTS idx_boletas_propuesta
  ON public.boletas_emitidas (propuesta_id)
  WHERE propuesta_id IS NOT NULL;
