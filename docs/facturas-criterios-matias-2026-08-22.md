# Criterios de Matías (contador) para el motor de Facturación — 2026-08-22

Resumen práctico entregado por Matías (experiencia real con el portal gratuito
del SII y pymes chilenas). Fuente de verdad para el diseño del motor 33/34.
Los 26 puntos originales, agrupados por lo que implican para MassDTE:

## Principios rectores
- **El sistema NUNCA adivina decisiones tributarias.** Boleta vs factura la
  define el COMPRADOR; se le pregunta al usuario (1, 6).
- **Las facturas NO nacen de cartolas bancarias** — no traen datos tributarios
  suficientes. Carga estructurada (Excel/planilla o formulario) (5, 8, 25).
- Simplicidad + edición manual + calcar la usabilidad real del portal SII (26).
- NO calcular IVA automáticamente: mostrar info confiable (RCV); un motor de
  IVA es proyecto aparte (26).

## Receptores
- Base de clientes persistente (se repiten mes a mes) + agregar/editar fácil (3).
- RUT no basta: hay contribuyentes sin inicio de actividades u otras
  restricciones — capturar las respuestas del SII y alertar claro (4).
- La cuenta de origen del pago NO determina al receptor (8).
- El receptor puede RECLAMAR el documento; el acuse tiene efectos comerciales;
  estado visible en los registros electrónicos del SII (16).
- Receptor puede perder derecho a crédito fiscal (consecuencia tributaria, no
  bloqueo de emisión) (17).

## Mecánica del portal (calcar o advertir)
- Sin decimales; el portal redondea → diferencias de $1. Replicar o advertir (9).
- Forma de pago default "crédito" con aviso previo + edición individual (10).
- Ciudad = texto libre, a veces no autocompleta → editable (11).
- Las facturas SÍ permiten ajustar fecha (a diferencia de boletas) (12).
- Advertencias solo por montos ~$100M+; sin otros límites prácticos (13).
- Error en la firma del certificado suele CONSUMIR FOLIO (14) → cuidado con
  reintentos (misma filosofía fail-closed del circuito de boletas).
- Varios giros: uno por defecto, cambiable a pedido (15).
- Tras firmar no hay pasos extra: el registro de ventas se completa solo (18).

## Corrección de errores
- Documento equivocado → se ANULA con nota de crédito + se emite el correcto (7).
- NC idealmente el MISMO día o dentro del período (evita desfases por acuse y
  períodos tributarios) (19).
- Correcciones reales y justificadas; sin miedo a fiscalización por volumen si
  las operaciones son consistentes (23, 24 — caso Factop fue por operaciones
  artificiales, no por cantidad).

## Fuera de alcance (v1)
- Cambio de sujeto: sin respuesta práctica aún (20).
- Exterior / RUT genéricos: reglas especiales, lo maneja el usuario o su
  contador (21).
- Si el comprador emite FACTURA DE COMPRA, el vendedor NO emite factura por
  esa operación (22) — regla dura, no feature.
