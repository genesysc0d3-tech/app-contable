-- Regla global 119: transferencia RECIBIDA sin preposición ("Transf. NOMBRE").
--
-- Banco de pruebas de la mini, 2026-09-25, cartola Santander real de 547 filas:
-- 457 llegaban al modelo de IA porque la glosa del banco es
-- "0263796357 Transf. VILLARROEL ..." / "0269394404 Transf de SILVANA ..." y la regla 115
-- exige "transf (de|desde|recibida)". Con esta regla, 534/547 se resuelven por código
-- (13 al modelo): la cartola pasa de ~17 min a ~1 min con el mismo modelo, y de paso
-- casi no gasta CPU en Vercel ni tokens en la IA.
--
-- · Solo ENTRADAS: la dirección la da la columna del banco, no la palabra. Las formas
--   de salida ("transf a/hacia/enviada/para") quedan excluidas por lookahead y además
--   las reglas 117/118 (salida) las cubren.
-- · Prioridad 119: DESPUÉS de las específicas (honorarios 91, denylist 110-111,
--   transferencias 115-118) — solo caza lo que nadie reconoció.
-- · Confianza 0.80 < umbral 0.85 de auto-stage: NUNCA nace lista, el juicio sigue
--   siendo humano (misma doctrina que la 115).
-- · Espejo 1:1 en src/lib/ai/reglas-transferencias.test.ts.
-- · Idempotente (WHERE NOT EXISTS por nombre). Rollback: el _DOWN.
INSERT INTO public.clasificacion_reglas
  (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad, activa)
SELECT v.nombre, v.patron, 'regex', v.tipo_propuesto, v.tipo_flujo_match, 0.80, v.prioridad, true
FROM (VALUES
  ('Transferencia recibida (sin preposición)', '\btransf(er(encia)?)?\.?\s+(?!(a|hacia|enviada|para)\b)\S', 'transferencia_p2p', 'entrada', 119)
) AS v(nombre, patron, tipo_propuesto, tipo_flujo_match, prioridad)
WHERE NOT EXISTS (
  SELECT 1 FROM public.clasificacion_reglas r
  WHERE r.nombre = v.nombre AND r.empresa_id IS NULL
);
