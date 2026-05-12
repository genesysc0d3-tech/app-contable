-- Hint por documento: el usuario puede marcar una cartola como "toda P2P cripto",
-- "servicios profesionales", "ventas retail", etc. El clasificador usa este
-- hint como señal fuerte cuando la glosa no es suficiente (ej "Transf de Juan"
-- sin mencionar cripto explícitamente).
--
-- Valores aceptados (texto libre pero sugeridos):
--   "p2p_cripto"     → exchange de cripto / stablecoins, default EXENTA
--   "forex_divisas"  → compraventa de divisas, default EXENTA
--   "servicios"      → servicios profesionales, default AFECTA
--   "ventas"         → venta de bienes, default AFECTA
--   "mixto"          → clasificador decide por glosa/patrón (comportamiento actual)
--   null             → equivalente a "mixto"

ALTER TABLE public.documentos_subidos
  ADD COLUMN IF NOT EXISTS tipo_operacion_hint text;

COMMENT ON COLUMN public.documentos_subidos.tipo_operacion_hint IS
  'Hint del usuario sobre la naturaleza de las operaciones en esta cartola. Usado por el clasificador de tipo de boleta (afecta/exenta).';
