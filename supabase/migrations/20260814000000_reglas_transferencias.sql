-- Reglas globales de TRANSFERENCIAS — el caso central del producto (P2P).
--
-- HISTORIA (por qué existe esta migración): la versión original de estas
-- reglas ("Fix B" del PR #54) se aplicó A MANO en la base de la época y nunca
-- se versionó como archivo. Al reconstruirse el proyecto quedaron solo las 22
-- reglas base: producción clasificaba el 100% de las cartolas P2P vía IA
-- (lento, gasta cuota, y detonó los timeouts del 2026-08-13). REGLA DE
-- PROCESO DESDE HOY: toda regla global nace como migración versionada — nunca
-- más SQL a mano.
--
-- VALIDACIÓN (2026-08-13, arnés offline contra la Cartola N°02 real, 675
-- movimientos): cobertura 675/675 (100%), acuerdo 99,3% con la clasificación
-- IA previa; las divergencias favorecían a la regla (la IA clasificó textos
-- idénticos de forma inconsistente). Test permanente:
-- src/lib/ai/reglas-transferencias.test.ts (fija estos patrones 1:1).
--
-- DISEÑO:
-- · prioridad 115-118: loadReglas ordena ASCENDENTE (primero gana) — toda
--   regla específica existente (80-110) y de usuario (50) les sigue ganando.
-- · confianza 0.80 — DECISIÓN DEL FUNDADOR, principio de producto: la
--   clasificación del programa es PROCESAMIENTO; el juicio es SIEMPRE humano.
--   0.80 < 0.85 (AUTO_STAGE_THRESHOLD) ⇒ toda boleta nace "pendiente", nada
--   queda "listo" sin gesto humano.
-- · tipo_dte NULL: el gate por empresa decide (exento/afecta) — global no opina.
-- · Idempotente: re-aplicar no duplica (WHERE NOT EXISTS por nombre).
-- · Rollback: DELETE FROM clasificacion_reglas WHERE nombre IN (las 4 de abajo);
--   solo afecta procesamiento futuro — nada retroactivo.

INSERT INTO public.clasificacion_reglas
  (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad, activa)
SELECT v.nombre, v.patron, 'regex', v.tipo_propuesto, v.tipo_flujo_match, 0.80, v.prioridad, true
FROM (VALUES
  ('Transferencia recibida (P2P)', '\btransf(er(encia)?)?\.?\s+(de|desde|recibida)\b', 'transferencia_p2p', 'entrada', 115),
  ('Abono por transferencia',      '\babono\s+(por\s+tra?n?s?f|tercero)',              'transferencia_p2p', 'entrada', 116),
  ('Transferencia enviada',        '\btransf(er(encia)?)?\.?\s+(a|hacia|enviada)\b',   'gasto_egreso',      'salida',  117),
  ('Cargo por transferencia',      '\bcargo\s+por\s+tra?n?s?f',                        'gasto_egreso',      'salida',  118)
) AS v(nombre, patron, tipo_propuesto, tipo_flujo_match, prioridad)
WHERE NOT EXISTS (
  SELECT 1 FROM public.clasificacion_reglas r
  WHERE r.nombre = v.nombre AND r.empresa_id IS NULL
);
