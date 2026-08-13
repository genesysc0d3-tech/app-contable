-- Checkpoint del procesamiento IA en la tabla del WORKER, no en progreso_ia.
--
-- progreso_ia (documentos_subidos) es un campo de UI que varios puntos
-- sobrescriben libremente: processOneJob al arrancar, el catch de error, y
-- markJobFailedOrRetryable. Guardar ahí el checkpoint de chunks ya clasificados
-- hacía que se borrara solo entre intentos → una cartola que no cabe en una
-- invocación reprocesaba los mismos lotes para siempre (incidente 2026-08-13:
-- 675 movs, 17 lotes, moría en el 7 y volvía al 0).
--
-- Acá vive junto al job, que es quien lo produce y consume.
ALTER TABLE document_processing_jobs
  ADD COLUMN IF NOT EXISTS checkpoint jsonb;

COMMENT ON COLUMN document_processing_jobs.checkpoint IS
  'Lotes ya clasificados por la IA {clave, chunks[]}: permite retomar donde quedó tras un yield por presupuesto de tiempo. Se limpia al completar el job.';
