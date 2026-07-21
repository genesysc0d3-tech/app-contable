-- Estado-lápida (tombstone) para una boleta "a medias": se cliqueó EMITIR en el
-- SII (posible folio real quemado) pero no se pudo capturar/persistir el folio.
-- Es DISTINTO de 'cancelled' (fracaso pre-emit seguro, sin folio): mientras un job
-- de una propuesta esté en 'revision_pendiente', esa propuesta NO puede re-emitirse
-- ni aparecer como "lista". Se levanta a 'completed' cuando el folio queda
-- registrado (recover_latest → backfill en /api/sii-local/result).
--
-- La tabla emision_jobs (20260615160000_cuenta_pagadora_fase1) nace con el CHECK de
-- estado inline (nombre autogenerado). Se descubre el nombre real y se reemplaza de
-- forma robusta, sin asumir el nombre.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'emision_jobs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
    AND pg_get_constraintdef(con.oid) ILIKE '%created%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.emision_jobs DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.emision_jobs
  ADD CONSTRAINT emision_jobs_estado_check
  CHECK (estado IN ('created','running','completed','failed','expired','cancelled','revision_pendiente'));

-- "Esta propuesta quedó a medias" — barato para pendientes-emision + el gate de arranque.
CREATE INDEX IF NOT EXISTS idx_emision_jobs_revision
  ON public.emision_jobs (propuesta_id)
  WHERE propuesta_id IS NOT NULL AND estado = 'revision_pendiente';

-- Anti-carrera: "esta propuesta tiene un job aún en vuelo" (2 pestañas / única+lote).
CREATE INDEX IF NOT EXISTS idx_emision_jobs_en_vuelo
  ON public.emision_jobs (propuesta_id)
  WHERE propuesta_id IS NOT NULL AND estado IN ('created','running');
