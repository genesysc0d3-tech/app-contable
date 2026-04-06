# Audit: Procesamiento Cartola N°02 - 11 2025.xlsx

## Referencia del banco
- Abonos totales: $50,206,203
- Cargos totales: $51,715,000

---

## RUN 1 — 6 Abril 2026
- **Movimientos**: 642
- **Propuestas**: 642 (1:1 ✅)
- **Omitidos**: 30
- **Clientes auto-creados**: 29

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 626 | 0.95 |
| gasto_egreso | 14 | 0.95 |
| factura_afecta | 1 | 0.80 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor | Esperado |
|---|---|---|
| Ingresos | $2,616,118,079 | ~$50M |
| Egresos | $37,361,019 | ~$51M |

---

## RUN 2 — 6 Abril 2026
- **Movimientos**: 644
- **Propuestas**: 646 (2 extra — posible doble propuesta en algún movimiento)
- **Omitidos**: 28
- **Clientes auto-creados**: 29

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 629 | 0.95 |
| gasto_egreso | 15 | 0.95 |
| factura_afecta | 1 | 0.85 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor | Esperado |
|---|---|---|
| Ingresos | $5,190,553,373 | ~$50M |
| Egresos | $39,061,019 | ~$51M |

---

## COMPARACIÓN RUN 1 vs RUN 2

| Métrica | RUN 1 | RUN 2 | Diferencia |
|---|---|---|---|
| Movimientos | 642 | 644 | +2 |
| Propuestas | 642 | 646 | +4 |
| Omitidos | 30 | 28 | -2 |
| Clientes | 29 | 29 | = |
| transferencia_p2p | 626 | 629 | +3 |
| gasto_egreso | 14 | 15 | +1 |
| Ingresos | $2.6B | $5.1B | +$2.5B ⚠️ |
| Egresos | $37M | $39M | +$2M |

---

## PROBLEMAS IDENTIFICADOS

### 1. SALDOS COMO MOVIMIENTOS (CRÍTICO)
RUN 1: $2.6B ingresos. RUN 2: $5.1B ingresos. Esperado: ~$50M.
Mistral sigue extrayendo la columna "Saldo diario" como un movimiento separado.
El filtro de >50% total abonos NO funciona porque los saldos dominan el total.
**Se necesita filtrar ANTES de sumar** o detectar la columna saldo en el TSV.

### 2. RESULTADOS NO DETERMINÍSTICOS
Mismo documento produce diferente cantidad de movimientos (642 vs 644),
omitidos (30 vs 28) y tipos. Mistral Small con temperature=0.1 no es 100% determinístico.
**Aceptable** para una herramienta de propuestas — el usuario revisa.

### 3. CONFIANZA PLANA (0.95 para todo)
Mistral pone 0.95 a casi todo. No diferencia entre casos claros y ambiguos.
El sistema de confianza alta/media/baja no sirve si todo es "alta".
**Necesita mejorar el prompt** para forzar variación en confianza.

### 4. MONOTIPO (97% transferencia_p2p)
626-629 de 642-644 son transferencia_p2p. Puede ser correcto para una
cartola P2P, pero Mistral no está considerando que los cargos a SKIPO
son gastos operacionales, no P2P.

---

## RUN 3 — 6 Abril 2026
- **Movimientos**: 634
- **Propuestas**: 634 (1:1 ✅)
- **Omitidos**: 38
- **Clientes auto-creados**: 38

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 620 | 0.95 |
| gasto_egreso | 12 | 0.95 |
| factura_afecta | 1 | 0.95 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor | Esperado |
|---|---|---|
| Ingresos | $2,611,319,628 | ~$50M |
| Egresos | $42,049,653 | ~$51M |

### Notas
- Proceso demoró más que RUN 1 y 2
- UI no actualizó al completar — requirió recargar página manualmente
- Botón "Reprocesar" aparece brevemente al subir, desaparece al recargar

---

## COMPARACIÓN RUN 1-2-3

| Métrica | RUN 1 | RUN 2 | RUN 3 |
|---|---|---|---|
| Movimientos | 642 | 644 | 634 |
| Propuestas | 642 | 646 | 634 |
| Omitidos | 30 | 28 | 38 |
| Clientes | 29 | 29 | 38 |
| transferencia_p2p | 626 | 629 | 620 |
| gasto_egreso | 14 | 15 | 12 |
| Ingresos | $2.6B | $5.1B | $2.6B |
| Egresos | $37M | $39M | $42M |

### Variabilidad observada
- Movimientos: 634-644 (rango 10, ~1.5%)
- Omitidos: 28-38 (rango 10, ~27% variación)
- Clientes: 29-38 (rango 9)
- Ingresos: $2.6B-$5.1B (saldo corrupto varía entre runs)

---

## BUGS DE UI REPORTADOS (RUN 3)

### BUG A — Botón "Reprocesar" aparece al subir
Al subir archivo, aparece brevemente botón "Reprocesar" que no debería mostrarse.
Desaparece al recargar la página. Probablemente el estado "subido" se muestra
antes de que cambie a "procesando".

### BUG B — UI no refresca al completar procesamiento
A veces el documento termina de procesarse pero la UI sigue mostrando
"Procesando" hasta que el usuario recarga manualmente. El realtime
subscription no está detectando el cambio de estado a "procesado".

---

## RUN 4 — 6 Abril 2026
- **Movimientos**: 635
- **Propuestas**: 636
- **Omitidos**: 39
- **Clientes**: 29

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 620 | 0.95 |
| gasto_egreso | 14 | 0.95 |
| factura_afecta | 1 | 0.80 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor |
|---|---|
| Ingresos | $2,611,052,961 |
| Egresos | $42,049,653 |

---

## RUN 5 — 6 Abril 2026 (con audit logging)
- **Movimientos**: 644
- **Propuestas**: 645
- **Omitidos**: 23
- **Clientes**: 38
- **Audit chunks**: 7

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 631 | 0.95 |
| gasto_egreso | 12 | 0.95 |
| factura_afecta | 1 | 0.85 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor | Esperado |
|---|---|---|
| Ingresos | $37,034,867 | ~$50M |
| Egresos | $43,146,386 | ~$51M |

### Audit: lo que Mistral recibe y responde
- **Chunk 0**: header + primeras tx. Mistral extrae 87 movs/87 props ✅
  - Input: TSV con tabs del Excel original (incluye header "Cartola de cuenta corriente")
  - Response: tipo_flujo correcto ("entrada"/"salida"), montos correctos
  - Transfer a SKIPO $1.6M clasificado como salida ✅
- **Chunk 1**: 100 movs/100 props. Montos con formato "240,000" (coma como separador miles)
  - ⚠️ tipo_flujo: Mistral pone "salida" para TRANSFERS que son entradas
  - ⚠️ Todos los montos con coma se interpretan correctamente
- **Chunk 2**: 95 movs/95 props. Similar a chunk 1.

### Hallazgo clave RUN 5
- **Ingresos $37M vs $50M esperado**: Mistral clasifica TRANSFERS recibidas como "salida"
  en vez de "entrada". En chunk 1, "TRANSFER DE C.PAEZ ALVARE $240,000" sale como salida
  cuando es un abono (entrada). Esto explica por qué egresos ($43M) están más cerca del
  esperado que ingresos ($37M) — parte de los ingresos están clasificados como egresos.
- **Sin saldo corrupto esta run** — el filtro >50% funcionó o Mistral no lo extrajo

## RUN 6 — 6 Abril 2026 (con audit)
- **Movimientos**: 641
- **Propuestas**: 641 (1:1 ✅)
- **Omitidos**: 30
- **Clientes**: 29

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 624 | 0.95 |
| gasto_egreso | 15 | 0.95 |
| factura_afecta | 1 | 0.80 |
| no_comercial | 1 | 0.95 |

### Montos
| Métrica | Valor |
|---|---|
| Ingresos | $3,897,452,146 ⚠️ saldo de vuelta |
| Egresos | $42,308,154 |

### Audit chunks (7 chunks)
| Chunk | Movs | Props | tipo_flujo primer mov |
|---|---|---|---|
| 0 | 87 | 87 | salida (SKIPO $1.6M) ✅ |
| 1 | 100 | 100 | salida (TRANSFER DE C.PAEZ $240K) ⚠️ debería ser entrada |
| 2 | 100 | 100 | entrada (TRANSFER DE GUTIERREZ $50K) ✅ |
| 3 | 99 | 99 | entrada (TRANSFER DE J.CHOURIO $110K) ✅ |
| 4 | 100 | 100 | entrada (TRANSFER DE MARIANA $30K) ✅ |
| 5 | 99 | 99 | entrada (TRANSFER DE GABRIEL $25K) ✅ |
| 6 | 87 | 87 | salida (TRANSFER DE J.HERNANDEZ $40K) ⚠️ debería ser entrada |

### Comparación chunk 1: RUN 5 vs RUN 6
**Mismo input** ("TRANSFER DE C.PAEZ ALVARE $240,000"):
- RUN 5: tipo_flujo="salida" ❌
- RUN 6: tipo_flujo="salida" ❌ (consistente pero incorrecto)
- El TSV no indica si es Cargo/Abono — Mistral adivina mal

### Hallazgos RUN 6
- Saldo volvió a aparecer ($3.8B en ingresos vs $37M en RUN 5)
- Chunks 1 y 6: Mistral clasifica TRANSFERS recibidas como "salida"
- El problema es que el TSV no tiene la columna "Depósitos y Abono" / "Cheques y otros cargos"
  como headers separados — Mistral no sabe cuál columna es cuál

## RUN 7 — 6 Abril 2026 (con audit)
- **Movimientos**: 563
- **Propuestas**: 563 (1:1 ✅)
- **Omitidos**: 0
- **Clientes**: 24
- **Audit chunks**: 7

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 546 | 0.95 |
| gasto_egreso | 17 | 0.95 |

### Montos
| Métrica | Valor | Esperado |
|---|---|---|
| Ingresos | $35,076,663 | ~$50M |
| Egresos | $34,411,019 | ~$51M |

### Hallazgos RUN 7
- **Sin saldo corrupto** ✅ (2do run sin saldo, tras RUN 5)
- **Movimientos bajó a 563** — mucho menor que runs previos (634-644). Variabilidad alta.
- **0 omitidos** — ningún movimiento descartado por RUT/heurística
- **Solo 2 tipos**: desaparecieron factura_afecta y no_comercial (estaban en todos los runs 1-6)
- Ingresos y egresos ambos ~20-30% bajo el esperado — probable tipo_flujo invertido en varios chunks

---

## RUN 8 — 6 Abril 2026 (con finish_reason audit)
- **Movimientos**: 645
- **Propuestas**: 645 (1:1 ✅)
- **Clientes**: 29
- **Audit chunks**: 7

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 629 | 0.95 |
| gasto_egreso | 15 | 0.95 |
| factura_afecta | 1 | 0.80 |

### Montos
| Métrica | Valor |
|---|---|
| Ingresos | $2,616,341,079 ⚠️ saldo de vuelta |
| Egresos | $39,061,019 |

### Audit chunks (finish_reason + response_length)
| Chunk | Movs | finish | resp_len | tokens_out |
|---|---|---|---|---|
| 0 | 87 | stop | 55,474 | 21,269 |
| 1 | 100 | stop | 65,566 | 24,289 |
| 2 | 100 | stop | 62,993 | 24,115 |
| 3 | 100 | stop | 66,620 | 24,164 |
| 4 | 100 | stop | 65,785 | 24,678 |
| 5 | 100 | stop | 66,741 | 24,219 |
| 6 | 86 | stop | 57,313 | 21,015 |

### Hallazgos clave RUN 8
- **finish_reason=stop en TODOS los chunks** — NO hay truncation por max_tokens
- **tokens_output ~21-24K por chunk** — cerca del límite típico pero Mistral termina con "stop"
- **RUN 7 chunk 2 (18 movs) NO fue por length** — Mistral "decidió" parar antes. Bug distinto: respuesta incompleta con finish="stop". Posible: el modelo generó `"movimientos": [...18 items...]` y luego cerró el JSON prematuramente.
- **Saldo corrupto volvió** ($2.6B) — intermitente
- **645 movs**: consistente con rango alto (644-646) de runs previos

---

## RUN 9 — 6 Abril 2026
- **Movimientos**: 643
- **Propuestas**: 644 (+1 extra)
- **Clientes**: 29
- **Audit chunks**: 7

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 622 | 0.94 |
| gasto_egreso | 19 | 0.94 |
| no_comercial | 2 | 0.95 |
| factura_afecta | 1 | 0.80 |

### Montos
| Métrica | Valor |
|---|---|
| Ingresos | $3,908,719,986 ⚠️ saldo de vuelta |
| Egresos | $32,905,289 |

### Audit chunks
| Chunk | Movs | finish | resp_len | tokens_out |
|---|---|---|---|---|
| 0 | 87 | stop | 48,689 | 19,436 |
| 1 | 100 | stop | 56,766 | 21,489 |
| 2 | 100 | stop | 66,431 | 25,312 |
| 3 | 99 | stop | 65,409 | 24,299 |
| 4 | 100 | stop | 63,987 | 23,279 |
| 5 | 100 | stop | 62,372 | 22,984 |
| 6 | 86 | stop | 44,348 | 18,297 |

### Hallazgos RUN 9
- Todos finish=stop, consistente con RUN 8 — chunks completos
- Chunk 3 con 99 en vez de 100 (pequeña variación dentro de chunks medios)
- +1 propuesta extra (644 props vs 643 movs) — doble propuesta en algún mov
- Confianza mostró variación 0.80-0.95 (p2p y gasto bajaron a 0.94 avg por primera vez ligeramente)
- Saldo corrupto volvió
- Egresos $32.9M — más bajo aún que RUN 7 ($34M), consistente con tipo_flujo invertido

---

## RUN 10 — 6 Abril 2026 (final)
- **Movimientos**: 642
- **Propuestas**: 643 (+1 extra)
- **Clientes**: 29
- **Audit chunks**: 7

### Por tipo
| Tipo | Total | Conf avg |
|---|---|---|
| transferencia_p2p | 628 | 0.95 |
| gasto_egreso | 12 | 0.95 |
| no_comercial | 2 | 0.95 |
| factura_afecta | 1 | 0.85 |

### Montos
| Métrica | Valor |
|---|---|
| Ingresos | $3,902,449,281 ⚠️ saldo |
| Egresos | $39,061,019 |

### Audit chunks
| Chunk | Movs | finish | resp_len | tokens_out |
|---|---|---|---|---|
| 0 | 87 | stop | 58,576 | 22,475 |
| 1 | 100 | stop | 57,998 | 21,457 |
| 2 | 99 | stop | 65,981 | 25,174 |
| 3 | 99 | stop | 65,432 | 24,309 |
| 4 | 100 | stop | 56,814 | 21,645 |
| 5 | 99 | stop | 64,989 | 24,263 |
| 6 | 87 | stop | 49,393 | 18,921 |

---

## RESUMEN FINAL RUN 1-10

| RUN | Movs | Props | Clientes | Ingresos | Egresos | Saldo? |
|---|---|---|---|---|---|---|
| 1 | 642 | 642 | 29 | $2.6B | $37M | sí |
| 2 | 644 | 646 | 29 | $5.1B | $39M | sí |
| 3 | 634 | 634 | 38 | $2.6B | $42M | sí |
| 4 | 635 | 636 | 29 | $2.6B | $42M | sí |
| 5 | 644 | 645 | 38 | **$37M** | $43M | **no** ✅ |
| 6 | 641 | 641 | 29 | $3.9B | $42M | sí |
| 7 | 563 | 563 | 24 | **$35M** | $34M | **no** ✅ |
| 8 | 645 | 645 | 29 | $2.6B | $39M | sí |
| 9 | 643 | 644 | 29 | $3.9B | $33M | sí |
| 10 | 642 | 643 | 29 | $3.9B | $39M | sí |

### Estadísticas
- **Movs**: rango 563-645 (variación 13%, mediana ~643)
- **Propuestas**: casi siempre 1:1, ocasional +1 extra
- **Saldo corrupto**: 8/10 runs ❌ (bug no resuelto)
- **Runs limpias (sin saldo)**: RUN 5 y RUN 7 — ambas con ingresos ~$35-37M (cerca del real $50M pero bajo)
- **Egresos**: rango $32.9M-$43M (variación 30%, vs esperado $51M)
- **finish_reason**: 14/14 chunks en RUN 8-10 = "stop", confirmado sin truncation por length
- **Confianza**: casi siempre 0.95, rarísimo 0.80-0.85

### Conclusiones del audit
1. **Saldo corrupto (80% de runs)** — bug principal. Mistral extrae "Saldo diario" como movimiento. Filtro >50% falla porque saldo domina. **Requiere fix**: filtrar la columna saldo antes del TSV o detectar línea-saldo por patrón.
2. **tipo_flujo invertido** — incluso en runs limpias (5 y 7), ingresos quedan bajos y egresos dispares. Mistral confunde "Depósitos/Abono" vs "Cheques/Cargos" sin headers claros. **Requiere fix**: preservar headers del Excel o pasar flag de columna.
3. **Variabilidad aceptable (±1-2%)** en chunks normales — ruido esperado de LLM. Solo RUN 7 tuvo un outlier (chunk 2 con 18 movs, finish=stop sin truncation → Mistral "decide" terminar antes).
4. **Confianza plana (0.95)** — no sirve para priorizar revisión. **Requiere fix**: mejorar prompt para forzar variación.
5. **Tipos**: 96-97% transferencia_p2p estable. Mistral no detecta cargos a SKIPO como gastos operacionales.

### Próximos pasos sugeridos
- **Fix A (alta prioridad)**: detectar y filtrar líneas de saldo diario antes de enviar a Mistral
- **Fix B**: preservar headers del Excel en el TSV para dar contexto de columnas
- **Fix C**: prompt tuning para forzar variación en confianza
- **Fix D (UI)**: bugs de "Reprocesar" y realtime refresh pendientes
