-- Intento de la BOLETA ÚNICA (seguridad de emisión 2026-09-30, revisión adversarial M1).
--
-- Lo que se tecleó en el SII (monto, tipo, receptor, detalle) queda en el job. Si la
-- boleta queda a medias, la lápida dice QUÉ boleta buscar y su folio se registra con
-- estos datos, no con el borrador que la persona tenga abierto después.
--
-- ADITIVA y opcional: el código funciona sin ella (el UPDATE best-effort falla y el
-- folio a mano pide monto y tipo declarados). Sin índice: se lee por job_id.

ALTER TABLE public.emision_jobs
  ADD COLUMN IF NOT EXISTS intento jsonb;

COMMENT ON COLUMN public.emision_jobs.intento IS
  'Boleta única: {monto, tipo_dte, receptor_rut, receptor_nombre, detalle} enviados al SII. Para resolver una lápida (revision_pendiente) con los datos reales del intento.';
