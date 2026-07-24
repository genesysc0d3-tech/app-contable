-- Dedup por hash de archivo (auditoría 2026-07-24).
--
-- Re-subir la MISMA cartola (error humano común) duplicaba el 100% de los
-- movimientos: el carril bypass (planillas parseadas, el caso normal) salta el
-- dedup por-movimiento, y no había chequeo de hash de archivo. Se agrega el hash
-- del contenido para detectar el re-upload EXACTO y devolver el documento ya
-- procesado (idempotente) en vez de crear uno nuevo y re-procesar.
--
-- Columna nullable + índice parcial: los documentos viejos quedan con hash NULL
-- (no participan del dedup, sin migración de datos).

ALTER TABLE public.documentos_subidos ADD COLUMN IF NOT EXISTS archivo_hash text;

CREATE INDEX IF NOT EXISTS idx_documentos_subidos_empresa_hash
  ON public.documentos_subidos (empresa_id, archivo_hash)
  WHERE archivo_hash IS NOT NULL;
