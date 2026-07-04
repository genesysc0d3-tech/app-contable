-- Glosa común por documento (MassDTE): cuando se sube un Excel y se emiten
-- N boletas, normalmente la glosa es la misma para todo el lote (ej. "P2P todo
-- el día" → "Compraventa de criptoactivos"). Se configura una vez en el
-- documento y aplica a todas sus boletas. El toggle glosa_activa permite
-- desactivarla en bloque; el detalle por ítem (avanzado) puede sobrescribirla.
ALTER TABLE public.documentos_subidos
  ADD COLUMN IF NOT EXISTS glosa_comun text,
  ADD COLUMN IF NOT EXISTS glosa_activa boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.documentos_subidos.glosa_comun IS
  'Glosa común para todas las boletas emitidas desde este documento (MassDTE). Si vacía, se usa un default por tipo de operación.';
COMMENT ON COLUMN public.documentos_subidos.glosa_activa IS
  'Si false, las boletas de este documento se emiten sin glosa (toggle de bloque).';
