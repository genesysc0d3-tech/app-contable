-- Realtime para documentos_subidos: la mesa del escritorio v5 (DocCardList) se
-- suscribe a INSERT/UPDATE para auto-refrescar cuando llega/termina un comprobante
-- (Telegram, panel) SIN que el usuario haga F5. Sin esto la suscripción es inerte.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'documentos_subidos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documentos_subidos;
  END IF;
END $$;

-- REPLICA IDENTITY FULL: necesario para que el filtro empresa_id=eq.X matchee en
-- UPDATE/DELETE (si no, el WAL no trae las columnas viejas para evaluar el filtro).
ALTER TABLE public.documentos_subidos REPLICA IDENTITY FULL;
