-- ═══════════════════════════════════════════════════════════════════
-- reset-completo.sql — Reset total de datos de prueba
--
-- PROPÓSITO: Deja la app como recién instalada, conservando solo
-- empresas, usuarios, clientes, proveedores, reglas de clasificación
-- y adapters de parseo. Todo lo demás (documentos, movimientos,
-- propuestas, boletas emitidas, folios, auditoría) se borra.
--
-- ORDEN FK-safe: se elimina en orden inverso a las dependencias.
--
-- TABLAS QUE SE PRESERVAN:
--   empresas, usuarios, clientes, proveedores
--   clasificacion_reglas, parser_adapters
--
-- TABLAS QUE SE BORRAN:
--   items_documento, boletas_emitidas, gastos, documentos_tributarios
--   propuestas_ia, movimientos_raw, ia_uso, audit_chunks, parser_logs
--   documentos_subidos, boletas_caf_mock, creditos_uso, periodos_contables
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Items de documentos tributarios
DELETE FROM public.items_documento;

-- 2. Boletas emitidas (auto-referencia: anulada_por_id, referencia_id)
DELETE FROM public.boletas_emitidas;

-- 3. Gastos
DELETE FROM public.gastos;

-- 4. Documentos tributarios
DELETE FROM public.documentos_tributarios;

-- 5. Propuestas IA
DELETE FROM public.propuestas_ia;

-- 6. Movimientos raw
DELETE FROM public.movimientos_raw;

-- 7. Uso de IA
DELETE FROM public.ia_uso;

-- 8. Auditoría
DELETE FROM public.audit_chunks;

-- 9. Logs de parseo
DELETE FROM public.parser_logs;

-- 10. Documentos subidos
DELETE FROM public.documentos_subidos;

-- 11. Folios / CAF (rangos de folios)
DELETE FROM public.boletas_caf_mock;

-- 12. Créditos y periodos contables
DELETE FROM public.creditos_uso;
DELETE FROM public.periodos_contables;

COMMIT;

-- ═══ Verificación post-reset ═══
SELECT 'items_documento' AS tabla, count(*) FROM public.items_documento
UNION ALL SELECT 'boletas_emitidas', count(*) FROM public.boletas_emitidas
UNION ALL SELECT 'gastos', count(*) FROM public.gastos
UNION ALL SELECT 'documentos_tributarios', count(*) FROM public.documentos_tributarios
UNION ALL SELECT 'propuestas_ia', count(*) FROM public.propuestas_ia
UNION ALL SELECT 'movimientos_raw', count(*) FROM public.movimientos_raw
UNION ALL SELECT 'ia_uso', count(*) FROM public.ia_uso
UNION ALL SELECT 'audit_chunks', count(*) FROM public.audit_chunks
UNION ALL SELECT 'parser_logs', count(*) FROM public.parser_logs
UNION ALL SELECT 'documentos_subidos', count(*) FROM public.documentos_subidos
UNION ALL SELECT 'boletas_caf_mock', count(*) FROM public.boletas_caf_mock
UNION ALL SELECT 'creditos_uso', count(*) FROM public.creditos_uso
UNION ALL SELECT 'periodos_contables', count(*) FROM public.periodos_contables
UNION ALL SELECT '--- PRESERVADAS ---', 0
UNION ALL SELECT 'empresas', count(*) FROM public.empresas
UNION ALL SELECT 'usuarios', count(*) FROM public.usuarios
UNION ALL SELECT 'clientes', count(*) FROM public.clientes
UNION ALL SELECT 'proveedores', count(*) FROM public.proveedores
UNION ALL SELECT 'clasificacion_reglas', count(*) FROM public.clasificacion_reglas
UNION ALL SELECT 'parser_adapters', count(*) FROM public.parser_adapters
ORDER BY 1;
