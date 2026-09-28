# Emisión confiable — plan único (2026-09-28)

Origen: caso LC 27-sep 23:37 (boleta 17 colgada, su propio candado la bloqueó, posible folio 24531 sin registrar).
Principios tipo Stripe/bancos: (1) referencia propia que viaja con la boleta, (2) anotar antes de actuar,
(3) resultado desconocido = se consulta, nunca se repite a ciegas, (4) conciliación diaria, (5) folio asignado por nosotros.

Detalle (archivo:línea) en los planes por área:
- `plan-emision-confiable-2026-09-28-app.md` (+ "Revisión adversarial" al final: 4 bloqueantes B1-B4)
- `plan-emision-confiable-2026-09-28-extension.md` (0.2.9)
- `plan-emision-confiable-2026-09-28-referencia.md` (ref propia, decisión del fundador: ENTRA)
- `plan-emision-confiable-2026-09-28-folio-propio.md` (SimpleAPI, largo plazo)

## Antes de construir (humano)
- Matías: ¿existe el folio 24531 de LC (23:37–23:52 del 27-sep)? + las 3 "a medias" del 27-sep.
- 3 consultas de solo lectura pendientes de autorización del fundador (causa H1/H2 del "cada ~20", jobs colgados
  viejos, ¿alguien usó SimpleAPI?) + medir cuántas glosas pasan de 63 caracteres.

## Orden final
1. **PR 1 app (sale con la extensión 0.2.8 actual):** fecha por boleta + guarda de medianoche (B2, ya en producción)
   + `folios_hoy` 39 y 41 + DELETE nunca `cancelled` con propuesta (riesgo C) + lápida acotada a jobs nuevos + veto
   ampliado a lápidas `sin_respuesta` + salida humana auditada "Revisé el SII y no está" (B3).
2. **PR 2 app:** tu propio candado no te bloquea (`is_mine`, copy honesto, "Equipo" solo con otra persona) +
   Reanudar sin cadena de fallidas + la boleta en vuelo sale del slice. Adopción del job colgado SOLO con el job
   vencido (+2 min) o la extensión confirmando que murió (B1).
3. **PR 3 app — ID interno `R-XXX-XXX`** (decisión final: NO se imprime en la boleta del SII ni en la personalizada):
   por propuesta, columna "Ref." en Boletas/Facturas y "Últimas emitidas", buscador para la clienta y soporte, viaja
   en la bitácora de la extensión.
4. **Extensión 0.2.9 (una sola versión, ensayo MV antes):** bitácora antes del clic (si no se anota, no se clickea;
   después de `assertEmisorNoCambio`), estado fuera de memoria + keepalive, `estado_perdido` en vez de muda, DONE
   tras el ack del guardado (causa H2 del "cada ~20"), calce con Tipo/fecha real, revisar `expires_at` justo antes
   del clic, telemetría `sw_boot_at`, y la ref interna en la bitácora. Contrato mínimo app↔extensión (B4).
   Ensayo MV: SW detenido a mitad, pestaña cerrada a mitad, POST lento, boleta cerca de las 23:59, columna Tipo.
5. **PR 4 app:** "Verificar y seguir" + correlatividad como condición para el calce por monto+tipo+hora.
6. **Después:** conciliación diaria (la hace la extensión al abrir la app al día siguiente; necesita rango de fechas
   y más de 250 filas en /reportes), "receipt" en /reportes (0.3.x tras ensayo MV).
7. **Largo plazo:** folio propio con SimpleAPI (F0 preguntas → F1 cerrar 5 huecos en certificación → F2 piloto con
   empresa que pague + DPA → F3 carril recomendado).

No hacer: acortar el TTL del candado, latido desde la página.
