-- Denylist de NO-VENTAS bancarias — nacida de la auditoría del cerebro
-- (2026-09-02, cartolas reales de clientes corridas como cliente emulado).
--
-- CASO REAL: "Transferencia Desde Linea Sobregiro a Cta Cte" (abono $5.460,
-- cartola BCI real) matcheó la regla P2P (prioridad 115) y nació como
-- propuesta de BOLETA al 80% — plata que el banco le prestó al cliente,
-- vestida de venta. Boletearla infla la base imponible con un crédito.
--
-- DISEÑO (mismo contrato que 20260814000000_reglas_transferencias.sql):
-- · prioridad 110-111: ANTES de las genéricas de transferencia (115-118) —
--   loadReglas ordena ASCENDENTE y la primera gana. Las específicas de
--   producto (80-...) y las de usuario (50) siguen ganándoles.
-- · tipo_propuesto 'no_comercial': el gate de emisión lo marca NO_BOLETAR
--   (advertencia si el humano aprueba igual — el humano manda, nunca veto).
-- · confianza 0.90: acá la evidencia ES fuerte — "sobregiro"/"línea de
--   crédito" en una glosa bancaria describe la operación sin ambigüedad.
--   Sigue bajo ningún riesgo de auto-emisión: no_comercial no es emitible.
-- · Idempotente por nombre; rollback: DELETE por los 2 nombres de abajo
--   (solo afecta procesamiento futuro — nada retroactivo).
-- · Test permanente: src/lib/ai/reglas-transferencias.test.ts.

INSERT INTO public.clasificacion_reglas
  (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad, activa)
SELECT v.nombre, v.patron, 'regex', v.tipo_propuesto, v.tipo_flujo_match, 0.90, v.prioridad, true
FROM (VALUES
  ('Sobregiro / línea de crédito (no es venta)', '\b(sobregiro|l[ií]nea\s+(de\s+)?(sobregiro|cr[eé]dito))\b', 'no_comercial', 'entrada', 110),
  ('Avance / préstamo del banco (no es venta)',  '\b(avance\s+en\s+efectivo|desembolso\s+(de\s+)?cr[eé]dito|cr[eé]dito\s+cursado)\b', 'no_comercial', 'entrada', 111)
) AS v(nombre, patron, tipo_propuesto, tipo_flujo_match, prioridad)
WHERE NOT EXISTS (
  SELECT 1 FROM public.clasificacion_reglas r
  WHERE r.nombre = v.nombre AND r.empresa_id IS NULL
);
