-- Receptor: E-mail y Teléfono en TODAS las superficies de captura (espejo del
-- formulario e-Boleta del SII, cuyo toggle "Receptor" pide RUT, Nombre, Dirección,
-- E-mail y Teléfono). Boleta única ya los capturaba; esto los suma a los editores
-- de revisión (propuestas_ia) y los deja registrados en la boleta (boletas_emitidas).
--
-- SON CONTACTO, no campos fiscales del DTE: el SII los usa para ENVIAR la boleta al
-- receptor (email) / contactarlo (teléfono), no van en el XML. Se tratan como
-- hermanos exactos de receptor_direccion/receptor_comuna (manuales, opcionales).
--
-- PROTECCIÓN DE DATOS: son PII de un tercero, igual que RUT/nombre. Como
-- dirección/comuna, NO los infiere el clasificador (nunca se auto-guardan); solo
-- existen si el humano los tipea a mano. La minimización bajo 135 UF del clasificador
-- (processor.ts) no los toca porque nunca los produce. Aditivo, reversible, sin
-- backfill ni pérdida de datos.

ALTER TABLE public.propuestas_ia  ADD COLUMN IF NOT EXISTS receptor_email    text;
ALTER TABLE public.propuestas_ia  ADD COLUMN IF NOT EXISTS receptor_telefono text;

ALTER TABLE public.boletas_emitidas ADD COLUMN IF NOT EXISTS receptor_email    text;
ALTER TABLE public.boletas_emitidas ADD COLUMN IF NOT EXISTS receptor_telefono text;
