-- Default de operación por CUENTA: semilla para auto-clasificar la 1ª cartola.
--
-- Problema (bloqueante #1 pre-beta): la primera cartola de un cliente nace 100%
-- "por revisar" porque no hay hint por documento NI reglas aprendidas todavía, así
-- que el cable de tipo_dte (processor.ts) no tiene con qué decidir afecta/exenta.
--
-- Este campo deja que el cliente declare, UNA vez en su empresa, a qué se dedica
-- ("hago P2P de cripto", "presto servicios", etc.). El cable lo usa como hint por
-- defecto cuando la cartola no trae uno propio → la 1ª cartola ya nace clasificada.
--
-- Mismos 5 valores que documentos_subidos.tipo_operacion_hint (DocumentoHint).
-- NULL = sin default (la IA decide, comportamiento actual). Aditiva y segura.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS operacion_hint_default text
  CHECK (
    operacion_hint_default IS NULL
    OR operacion_hint_default IN ('p2p_cripto', 'forex_divisas', 'servicios', 'ventas', 'mixto')
  );

COMMENT ON COLUMN empresas.operacion_hint_default IS
  'Hint por defecto del tipo de operación del contribuyente (p2p_cripto/forex_divisas/servicios/ventas/mixto). Semilla para auto-clasificar la 1ª cartola cuando no hay hint por documento ni reglas aprendidas. El hint por documento (más específico) manda sobre este. NULL = la IA decide.';
