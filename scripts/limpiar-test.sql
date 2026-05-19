-- ═══════════════════════════════════════════════════════════════════
-- limpiar-test.sql — Limpia datos de prueba sin perder lo importante
-- 
-- PROPÓSITO: Reset rápido para modo test/desarrollo.
-- Preserva adapters de parseo, reglas de clasificación, datos fiscales,
-- y análisis de IA (propuestas, movimientos, documentos).
--
-- TABLAS QUE SE BORRAN (datos operativos de prueba):
--   audit_chunks, ia_uso, creditos_uso, periodos_contables
--
-- TABLAS QUE NO SE TOCAN:
--   parser_adapters          → conocimiento de formatos bancarios
--   parser_logs              → auditoría de parseo
--   clasificacion_reglas     → reglas de clasificación
--   boletas_caf_mock         → secuencia de folios
--   boletas_emitidas         → fiscal (track_id SII)
--   clientes                 → catálogo compartido
--   usuarios                 → credenciales
--   empresas                 → configuración
--   propuestas_ia            → clasificaciones y análisis de IA
--   movimientos_raw          → movimientos procesados por la IA
--   documentos_subidos       → documentos subidos
--
-- SEGURIDAD: DELETE en orden FK-safe para no violar constraints.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Auditoría y métricas (sin FK salientes)
DELETE FROM public.audit_chunks;
DELETE FROM public.ia_uso;
DELETE FROM public.creditos_uso;
DELETE FROM public.periodos_contables;

-- NOTA: propuestas_ia, movimientos_raw y documentos_subidos NO se borran
-- porque contienen el análisis de la IA (clasificaciones, propuestas,
-- movimientos procesados). El usuario necesita conservarlos entre sesiones
-- de test para no perder el trabajo de clasificación.

COMMIT;

-- ═══ Verificación post-limpieza ═══
SELECT 'audit_chunks' AS tabla, count(*) FROM public.audit_chunks
UNION ALL SELECT 'ia_uso', count(*) FROM public.ia_uso
UNION ALL SELECT 'creditos_uso', count(*) FROM public.creditos_uso
UNION ALL SELECT 'periodos_contables', count(*) FROM public.periodos_contables
UNION ALL SELECT 'propuestas_ia (NO TOCADA)', count(*) FROM public.propuestas_ia
UNION ALL SELECT 'movimientos_raw (NO TOCADA)', count(*) FROM public.movimientos_raw
UNION ALL SELECT 'documentos_subidos (NO TOCADA)', count(*) FROM public.documentos_subidos
UNION ALL SELECT 'parser_adapters (NO TOCADA)', count(*) FROM public.parser_adapters
UNION ALL SELECT 'clasificacion_reglas (NO TOCADA)', count(*) FROM public.clasificacion_reglas
UNION ALL SELECT 'boletas_emitidas (NO TOCADA)', count(*) FROM public.boletas_emitidas;
