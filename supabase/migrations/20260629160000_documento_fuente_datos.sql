-- F2: cada documento sabe su FUENTE de datos (el canal por el que llegó):
-- panel | telegram | (futuro) mercadopago | binance. Aditivo.
-- El motor de cruce (F3) y los chips de origen de la UI lo usan. La clasificación
-- cripto-vs-no la hace el clasificador, no esto. (Distinto de movimientos_raw.fuente,
-- que es el origen de la CLASIFICACIÓN: regla/mistral.)
ALTER TABLE public.documentos_subidos ADD COLUMN IF NOT EXISTS fuente_datos text;

-- Backfill de lo existente: telegram por su marca; el resto, panel.
UPDATE public.documentos_subidos
SET fuente_datos = CASE
  WHEN nombre_archivo LIKE 'Telegram %'
    OR nombre_archivo LIKE 'Álbum %'
    OR (progreso_ia->>'origen') = 'telegram' THEN 'telegram'
  ELSE 'panel'
END
WHERE fuente_datos IS NULL;
