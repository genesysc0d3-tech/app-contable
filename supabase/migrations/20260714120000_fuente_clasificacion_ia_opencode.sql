-- Rename del VALOR legacy "mistral" → "ia_opencode" en propuestas_ia.fuente_clasificacion.
-- El proveedor de IA real es OpenCode (Mistral/DeepSeek se eliminaron, ver src/lib/ai/provider.ts);
-- "mistral" era el nombre viejo. El código ya escribe "ia_opencode" (processor.ts). Este backfill
-- deja el histórico coherente.
--
-- SEGURO: fuente_clasificacion es un campo INFORMATIVO sin lectores (nadie filtra ni compara por él,
-- verificado en la auditoría del rename). Idempotente. No urgente — se puede aplicar cuando convenga.
UPDATE public.propuestas_ia
   SET fuente_clasificacion = 'ia_opencode'
 WHERE fuente_clasificacion = 'mistral';
