-- DOWN de 20260930160000_emision_jobs_intento.sql
-- DESTRUYE: los intentos guardados en emision_jobs.intento (monto/tipo/receptor de
-- boletas únicas). Sin ellos, una lápida de boleta única pide el monto y tipo a mano.
-- Respaldar antes: SELECT job_id, intento FROM public.emision_jobs WHERE intento IS NOT NULL;

ALTER TABLE public.emision_jobs
  DROP COLUMN IF EXISTS intento;
