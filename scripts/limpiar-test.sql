-- ==========================================================================
-- limpiar-test.sql - Limpieza segura de datos de prueba
--
-- OBJETIVO
--   Dejar la app limpia de datos operativos de prueba sin perder aprendizaje
--   reutilizable del parser/clasificador.
--
-- POR DEFECTO ES DRY-RUN
--   Este script abre una transaccion, muestra conteos, ejecuta los DELETE y
--   termina con ROLLBACK. Para aplicar de verdad, cambia el ROLLBACK final por
--   COMMIT despues de revisar los conteos.
--
-- SIEMPRE SE CONSERVA
--   parser_adapters      -> fingerprints/configs/adaptadores de Excel/PDF
--   parser_logs          -> auditoria tecnica: capa, adapter, warnings, filas
--   clasificacion_reglas -> reglas de clasificacion reutilizables
--   boletas_caf_mock     -> infraestructura mock de folios
--   usuarios, empresas   -> login/configuracion base
--
-- SE BORRA EN CLEAN REAL
--   audit_chunks, ia_uso, creditos_uso, periodos_contables,
--   gastos, documentos_tributarios, propuestas_ia, movimientos_raw,
--   documentos_subidos, clientes, proveedores,
--   boletas_emitidas SOLO cuando emision_proveedor = 'mock'.
--
-- NO SE BORRA AUTOMATICAMENTE
--   boletas_emitidas con emision_proveedor <> 'mock' (sii_local/baseapi legacy)
--   porque pueden tener folio/PDF real o evidencia de proveedor.
--   Tambien se conserva su cadena de trazabilidad propuesta->movimiento->doc
--   cuando existe, para no dejar boletas reales sin contexto.
-- ==========================================================================

BEGIN;

-- 1. Conteo previo: revisar antes de aplicar.
SELECT 'ANTES audit_chunks' AS item, count(*) FROM public.audit_chunks
UNION ALL SELECT 'ANTES ia_uso', count(*) FROM public.ia_uso
UNION ALL SELECT 'ANTES creditos_uso', count(*) FROM public.creditos_uso
UNION ALL SELECT 'ANTES periodos_contables', count(*) FROM public.periodos_contables
UNION ALL SELECT 'ANTES gastos', count(*) FROM public.gastos
UNION ALL SELECT 'ANTES documentos_tributarios', count(*) FROM public.documentos_tributarios
UNION ALL SELECT 'ANTES propuestas_ia', count(*) FROM public.propuestas_ia
UNION ALL SELECT 'ANTES movimientos_raw', count(*) FROM public.movimientos_raw
UNION ALL SELECT 'ANTES documentos_subidos', count(*) FROM public.documentos_subidos
UNION ALL SELECT 'ANTES clientes', count(*) FROM public.clientes
UNION ALL SELECT 'ANTES proveedores', count(*) FROM public.proveedores
UNION ALL SELECT 'ANTES boletas_emitidas mock', count(*) FROM public.boletas_emitidas WHERE emision_proveedor = 'mock'
UNION ALL SELECT 'ANTES boletas_emitidas reales/legacy (NO TOCAR)', count(*) FROM public.boletas_emitidas WHERE emision_proveedor <> 'mock'
UNION ALL SELECT 'PRESERVAR parser_adapters', count(*) FROM public.parser_adapters
UNION ALL SELECT 'PRESERVAR parser_logs', count(*) FROM public.parser_logs
UNION ALL SELECT 'PRESERVAR clasificacion_reglas', count(*) FROM public.clasificacion_reglas;

-- 2. Evidencia que requiere revision manual antes de borrar PDFs/folios reales.
SELECT
  emision_proveedor,
  count(*) AS cantidad,
  min(fecha_emision) AS primera_fecha,
  max(fecha_emision) AS ultima_fecha
FROM public.boletas_emitidas
GROUP BY emision_proveedor
ORDER BY emision_proveedor;

-- 2b. Archivos Storage que quedarian huerfanos si se aplica el clean real.
-- Revisar este listado para borrar objetos del bucket `documentos` en una fase
-- separada. El SQL limpia filas; Storage se limpia via API/SDK.
SELECT
  'documentos_subidos' AS origen,
  id::text AS ref_id,
  storage_path
FROM public.documentos_subidos
WHERE storage_path IS NOT NULL
  AND storage_path NOT LIKE 'boleta-unica://%'
  AND storage_path NOT LIKE 'boleta-lote://%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.movimientos_raw m
    JOIN public.propuestas_ia p ON p.movimiento_id = m.id
    JOIN public.boletas_emitidas b ON b.propuesta_id = p.id
    WHERE m.documento_id = documentos_subidos.id
      AND b.emision_proveedor <> 'mock'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.boletas_emitidas b
    WHERE b.emision_proveedor <> 'mock'
      AND (documentos_subidos.progreso_ia ->> 'boleta_id') = b.id::text
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.boletas_emitidas b
    WHERE b.emision_proveedor <> 'mock'
      AND b.proveedor_respuesta #>> '{pdf,storage_path}' = documentos_subidos.storage_path
  )
UNION ALL
SELECT
  'boletas_emitidas_mock_pdf' AS origen,
  id::text AS ref_id,
  proveedor_respuesta #>> '{pdf,storage_path}' AS storage_path
FROM public.boletas_emitidas
WHERE emision_proveedor = 'mock'
  AND proveedor_respuesta #>> '{pdf,storage_path}' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.boletas_emitidas b
    WHERE b.emision_proveedor <> 'mock'
      AND b.proveedor_respuesta #>> '{pdf,storage_path}' = boletas_emitidas.proveedor_respuesta #>> '{pdf,storage_path}'
  )
ORDER BY origen, ref_id;

-- 2c. Senales de aprendizaje por documentos antes de borrar datos operativos.
-- Si algun hint debe transformarse en regla reusable, hacerlo antes del COMMIT.
SELECT
  tipo,
  tipo_operacion_hint,
  count(*) AS documentos,
  sum(coalesce(movimientos_detectados, 0)) AS movimientos_detectados
FROM public.documentos_subidos
GROUP BY tipo, tipo_operacion_hint
ORDER BY documentos DESC;

-- 3. Limpieza FK-safe. Se preserva parser_logs aunque documento_id quede NULL
-- por ON DELETE SET NULL al borrar documentos_subidos.
DELETE FROM public.audit_chunks;
DELETE FROM public.ia_uso;
DELETE FROM public.creditos_uso;
DELETE FROM public.periodos_contables;
DELETE FROM public.gastos;
DELETE FROM public.documentos_tributarios;
DELETE FROM public.boletas_emitidas WHERE emision_proveedor = 'mock';

-- Mantener propuestas/movimientos/docs/clientes que trazan boletas no-mock.
DELETE FROM public.propuestas_ia p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.boletas_emitidas b
  WHERE b.propuesta_id = p.id
    AND b.emision_proveedor <> 'mock'
);

DELETE FROM public.movimientos_raw m
WHERE NOT EXISTS (
  SELECT 1
  FROM public.propuestas_ia p
  WHERE p.movimiento_id = m.id
);

DELETE FROM public.documentos_subidos d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.movimientos_raw m
  WHERE m.documento_id = d.id
)
AND NOT EXISTS (
  SELECT 1
  FROM public.boletas_emitidas b
  WHERE b.emision_proveedor <> 'mock'
    AND (d.progreso_ia ->> 'boleta_id') = b.id::text
);

DELETE FROM public.clientes c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.propuestas_ia p
  WHERE p.cliente_id = c.id
);
DELETE FROM public.proveedores;

-- 4. Conteo post-limpieza dentro de la transaccion.
SELECT 'DESPUES audit_chunks' AS item, count(*) FROM public.audit_chunks
UNION ALL SELECT 'DESPUES ia_uso', count(*) FROM public.ia_uso
UNION ALL SELECT 'DESPUES creditos_uso', count(*) FROM public.creditos_uso
UNION ALL SELECT 'DESPUES periodos_contables', count(*) FROM public.periodos_contables
UNION ALL SELECT 'DESPUES gastos', count(*) FROM public.gastos
UNION ALL SELECT 'DESPUES documentos_tributarios', count(*) FROM public.documentos_tributarios
UNION ALL SELECT 'DESPUES propuestas_ia', count(*) FROM public.propuestas_ia
UNION ALL SELECT 'DESPUES movimientos_raw', count(*) FROM public.movimientos_raw
UNION ALL SELECT 'DESPUES documentos_subidos', count(*) FROM public.documentos_subidos
UNION ALL SELECT 'DESPUES clientes', count(*) FROM public.clientes
UNION ALL SELECT 'DESPUES proveedores', count(*) FROM public.proveedores
UNION ALL SELECT 'DESPUES boletas_emitidas mock', count(*) FROM public.boletas_emitidas WHERE emision_proveedor = 'mock'
UNION ALL SELECT 'SIGUEN boletas_emitidas reales/legacy', count(*) FROM public.boletas_emitidas WHERE emision_proveedor <> 'mock'
UNION ALL SELECT 'SIGUEN parser_adapters', count(*) FROM public.parser_adapters
UNION ALL SELECT 'SIGUEN parser_logs', count(*) FROM public.parser_logs
UNION ALL SELECT 'SIGUEN clasificacion_reglas', count(*) FROM public.clasificacion_reglas;

-- DRY-RUN: no aplica cambios.
ROLLBACK;

-- Para ejecutar de verdad:
-- 1. Revisa los conteos anteriores.
-- 2. Confirma que boletas_emitidas reales/legacy no deben borrarse aqui.
-- 3. Cambia ROLLBACK por COMMIT y ejecuta el script completo.
