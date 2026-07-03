-- Realtime para propuestas_ia y boletas_emitidas (auditoría #17b). La pestaña
-- Emitir (EmitirTabContent) se suscribe a INSERT/UPDATE de ambas para auto-refrescar
-- sin F5, pero solo documentos_subidos estaba publicada (20260629170000) → esas
-- suscripciones eran inertes. Mismo patrón: publicar + REPLICA IDENTITY FULL para
-- que el filtro empresa_id=eq.X matchee en UPDATE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'propuestas_ia'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.propuestas_ia;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'boletas_emitidas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.boletas_emitidas;
  END IF;
END $$;

ALTER TABLE public.propuestas_ia REPLICA IDENTITY FULL;
ALTER TABLE public.boletas_emitidas REPLICA IDENTITY FULL;
