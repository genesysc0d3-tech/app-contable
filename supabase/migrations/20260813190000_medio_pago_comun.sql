-- Medio de pago a nivel DOCUMENTO (espejo de glosa_comun).
--
-- El SII exige método de pago en cada boleta. Hoy la app solo lo pide en boletas
-- sobre 135 UF (donde el receptor es obligatorio); en el resto viaja vacío y la
-- extensión rellena "Efectivo" por defecto (sii-worker.js). Resultado real de
-- beta 2026-08-13: 65 boletas de una cartola bancaria salieron como "Efectivo"
-- siendo transferencias electrónicas — dato incorrecto en un documento
-- tributario. En una cartola, por definición, nada entra en efectivo.
--
-- Con esto el usuario fija el medio de pago de TODAS las boletas del documento
-- de una vez. Precedencia al emitir: propuesta.medio_pago (individual) >
-- documento.medio_pago_comun > "Efectivo" (fallback del worker).
ALTER TABLE documentos_subidos
  ADD COLUMN IF NOT EXISTS medio_pago_comun text;

COMMENT ON COLUMN documentos_subidos.medio_pago_comun IS
  'Método de pago aplicado a todas las boletas del documento (Transferencia, Efectivo, Tarjeta de débito...). Las cartolas bancarias sugieren Transferencia. Una propuesta puede sobrescribirlo con su propio medio_pago.';
