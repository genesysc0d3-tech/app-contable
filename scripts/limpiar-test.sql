-- ═══════════════════════════════════════════════════════════════════
-- limpiar-test.sql — Limpia datos de prueba sin perder lo importante
-- 
-- PROPÓSITO: Reset rápido para modo test/desarrollo.
-- Preserva adapters de parseo, reglas de clasificación, y datos fiscales.
--
-- TABLAS QUE SE BORRAN (datos operativos de prueba):
--   audit_chunks, ia_uso, creditos_uso, periodos_contables,
--   propuestas_ia, movimientos_raw, documentos_subidos
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
--
-- SEGURIDAD: DELETE en orden FK-safe para no violar constraints.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Auditoría y métricas (sin FK salientes)
DELETE FROM public.audit_chunks;
DELETE FROM public.ia_uso;
DELETE FROM public.creditos_uso;
DELETE FROM public.periodos_contables;

-- 2. Propuestas (SET NULL en boletas_emitidas.propuesta_id)
DELETE FROM public.propuestas_ia;

-- 3. Movimientos (CASCADE desde documento)
DELETE FROM public.movimientos_raw;

-- 4. Documentos (SET NULL en parser_logs.documento_id)
DELETE FROM public.documentos_subidos;

COMMIT;

-- ═══ Verificación post-limpieza ═══
SELECT 'audit_chunks' AS tabla, count(*) FROM public.audit_chunks
UNION ALL SELECT 'ia_uso', count(*) FROM public.ia_uso
UNION ALL SELECT 'creditos_uso', count(*) FROM public.creditos_uso
UNION ALL SELECT 'periodos_contables', count(*) FROM public.periodos_contables
UNION ALL SELECT 'propuestas_ia', count(*) FROM public.propuestas_ia
UNION ALL SELECT 'movimientos_raw', count(*) FROM public.movimientos_raw
UNION ALL SELECT 'documentos_subidos', count(*) FROM public.documentos_subidos
UNION ALL SELECT 'parser_adapters (NO TOCADA)', count(*) FROM public.parser_adapters
UNION ALL SELECT 'clasificacion_reglas (NO TOCADA)', count(*) FROM public.clasificacion_reglas
UNION ALL SELECT 'boletas_emitidas (NO TOCADA)', count(*) FROM public.boletas_emitidas;
