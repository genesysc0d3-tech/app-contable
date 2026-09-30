# Pruebas masivas del lector de cartolas — 2026-09-30

Método: 51 cartolas reales ya subidas (leídas SOLO en local, sin IA; descargadas y borradas) → 23 specs de formato
(solo estructura: títulos de columna del banco, tipos, formatos, resúmenes; sin montos, glosas, nombres ni RUT) en
`scripts/corpus-cartolas/specs/`. Con ellos se generaron 4.202 cartolas sintéticas con verdad conocida (1.916 por spec,
990 combinaciones de mutaciones, 1.167 variantes inventadas por DeepSeek como generador adversarial de formatos,
50 sabotajes y 79 casos adversariales). Se corrió lector ACTUAL (origin/dev) vs NUEVO (feat/lector-cartolas-con-juez
@39d19aa) sobre todo el corpus, y NUEVO+IA sobre una muestra estratificada de 695.

IA: solo DeepSeek por OpenCode Go (640 llamadas reales). **0 llamadas a Fireworks redirigidas, 0 bloqueadas a otros
hosts.** Cero uso de Vercel (todo local). Producción: solo SELECT y descarga puntual para leer local.

## Las 17 cartolas "todo es entrada" de producción
Estaban BIEN leídas: son exports que solo traen ingresos ("Depósitos / Abonos" de BancoEstado, "Ingreso (+)" de BCI
transferencias recibidas, "Abono EXENTAS", "MONTO" de una planilla editada, 2 con Egreso vacío al 100%). El nuevo las
lee igual; no las sella porque no hay saldo/total que lo pruebe.

Corpus: **4202 cartolas** (spec 1916 · combo 990 · deepseek 1167 · sabotaje 50 · adversarial 79); ambiguas por construcción 28.

## 1. ACTUAL vs NUEVO (sin IA), corpus completo

| Resultado | ACTUAL | NUEVO |
|---|---|---|
| Exacta (fecha, monto y dirección de cada fila) | 60.7% (2552/4202; IC95 59.2–62.2) | 79.5% (3342/4202; IC95 78.3–80.7) |
| Exacta con prueba (sello saldo/total_banco) | — | 13.6% (570/4202; IC95 12.6–14.6) |
| Exacta con sello cliente (plantilla massDTE) | — | 2.7% (115/4202; IC95 2.3–3.3) |
| Exacta pidiendo confirmar | — | 63.2% (2657/4202; IC95 61.8–64.7) |
| Mal leída CON aviso | 1.2% (51/4202; IC95 0.9–1.6) | 2.9% (123/4202; IC95 2.5–3.5) |
| Mal leída, pide confirmar SIN alerta | — | 4.6% (194/4202; IC95 4.0–5.3) |
| SILENCIOSA (mal y sin aviso) | 14.1% (592/4202; IC95 13.1–15.2) | — (el nuevo siempre pide confirmar sin sello) |
| SELLO QUE MIENTE (mal y sellada) | — | 0.2% (7/4202; IC95 0.1–0.3) |
| Capa 4 (IA lee la hoja entera) | 14.8% (623/4202; IC95 13.8–15.9) | 9.0% (377/4202; IC95 8.1–9.9) |
| Rechazo falso (capa 4 pudiendo leerla exacta) | 9.1% (384/4202; IC95 8.3–10.0) | 3.8% (159/4202; IC95 3.2–4.4) |
| Error (excepción) | 0.0% (0/4202; IC95 0.0–0.1) | 0.0% (0/4202; IC95 0.0–0.1) |

Pares: el nuevo lee exacta donde el actual NO: **791**; el actual exacta y el nuevo NO: **1**. Silenciosas del actual que el nuevo lee exacta: 246; silenciosas del actual que el nuevo marca (aviso o pide confirmar): 339.

## 2. Métrica «nunca preguntar» (NUEVO sin IA)

- Comprobadas SOLAS (sello saldo/total_banco y exactas): **13.6% (570/4202; IC95 12.6–14.6)**
- Sin contar plantilla massDTE ni ambiguas: 14.2% (567/3991; IC95 13.2–15.3)
- No preguntan (sello saldo/total_banco/cliente): 16.5% (692/4202; IC95 15.4–17.6)

Qué impide sellar el resto:

| Motivo | Cartolas | % del resto |
|---|---|---|
| sin_saldo_ni_totales | 984 | 28.0% |
| primera_fila_sin_saldo_inicial | 971 | 27.6% |
| capa4 | 536 | 15.2% |
| export_filtrado_un_sentido | 221 | 6.3% |
| plata_sin_leer_o_monto_dudoso | 211 | 6.0% |
| totales_calzan_sin_direccion | 200 | 5.7% |
| banco_contradice | 165 | 4.7% |
| saldo_no_cierra | 107 | 3.0% |
| menos_de_10_filas | 51 | 1.5% |
| signo_sin_titulo | 48 | 1.4% |
| sum_parcial | 14 | 0.4% |
| plantilla_cliente | 7 | 0.2% |
| otras_hojas_con_movimientos | 2 | 0.1% |

Cota superior con verificación por la CARTOLA ANTERIOR (saldo inicial = saldo final verdadero de la cartola previa, re-sellando con el mismo juez): se sellarían **910** más (exactas) → comprobadas solas 35.2% (1480/4202; IC95 33.8–36.7). Por motivo:

| Motivo original | Se sellarían con la cartola anterior |
|---|---|
| primera_fila_sin_saldo_inicial | 894 |
| plantilla_cliente | 9 |
| menos_de_10_filas | 7 |

Ojo: con la regla simulada, 0 cartolas MAL leídas quedarían selladas (el sello mentiría).

## 3. Secuencias de 2-3 cartolas consecutivas de la misma cuenta

Regla A (estricta): la anterior quedó comprobada por el banco. Regla B: la anterior quedó comprobada o el cliente la confirmó UNA vez.

| Posición | n | Sellada sola | Con regla A | Con regla B | Sello que miente (A/B) |
|---|---|---|---|---|---|
| 1ª | 326 | 18.7% (61/326; IC95 14.9–23.3) | 18.7% (61/326; IC95 14.9–23.3) | 18.7% (61/326; IC95 14.9–23.3) | 0/0 |
| 2ª | 326 | 18.4% (60/326; IC95 14.6–23.0) | 18.4% (60/326; IC95 14.6–23.0) | 39.3% (128/326; IC95 34.1–44.7) | 0/0 |
| 3ª | 163 | 18.4% (30/163; IC95 13.2–25.1) | 18.4% (30/163; IC95 13.2–25.1) | 39.9% (65/163; IC95 32.7–47.5) | 0/0 |

Cartolas 2ª y 3ª: sola 18.4% (90/489; IC95 15.2–22.1) → regla A 18.4% (90/489; IC95 15.2–22.1) → regla B 39.5% (193/489; IC95 35.2–43.9).
Solo las que traen columna de saldo: sola 25.6% (63/246; IC95 20.6–31.4) → regla A 25.6% (63/246; IC95 20.6–31.4) → regla B 66.3% (163/246; IC95 60.1–71.9).

| Familia | 2ª-3ª sola | regla A | regla B | n |
|---|---|---|---|---|
| bancochile-cartola-historica | 87.5% | 87.5% | 87.5% | 24 |
| bancoestado-chequera-completa | 25.0% | 25.0% | 62.5% | 24 |
| bancoestado-chequera-solo-abonos | 0.0% | 0.0% | 0.0% | 15 |
| bancoestado-fechas-compactas | 22.2% | 22.2% | 66.7% | 27 |
| bci-detallado-invertido | 22.2% | 22.2% | 77.8% | 27 |
| bci-mes-actual-xls | 14.3% | 14.3% | 14.3% | 21 |
| bci-movimientos-detallado | 22.2% | 22.2% | 77.8% | 27 |
| bci-transferencias-recibidas | 14.3% | 14.3% | 14.3% | 21 |
| bice-estado-de-cuenta-solo-abonos | 0.0% | 0.0% | 0.0% | 18 |
| bice-estado-de-cuenta | 71.4% | 71.4% | 71.4% | 21 |
| cartola-cuenta-corriente-simple | 18.5% | 18.5% | 63.0% | 27 |
| cartola-simple-fecha-tipo-saldo | 22.2% | 22.2% | 63.0% | 27 |
| clp-bs-montos-como-fecha | 0.0% | 0.0% | 0.0% | 18 |
| clp-bs-planilla-casera | 0.0% | 0.0% | 0.0% | 18 |
| me-planilla-fecha-monto-comision | 14.3% | 14.3% | 14.3% | 21 |
| mis-movimientos-completa | 22.2% | 22.2% | 77.8% | 27 |
| mis-movimientos-solo-ingresos-con-saldo | 0.0% | 0.0% | 0.0% | 21 |
| mis-movimientos-solo-ingresos | 0.0% | 0.0% | 0.0% | 18 |
| plantilla-massdte-boletas | 0.0% | 0.0% | 14.3% | 21 |
| santander-3-columnas-editada | 0.0% | 0.0% | 0.0% | 18 |
| santander-movimientos-ctacte-completa | 14.8% | 14.8% | 55.6% | 27 |
| santander-movimientos-ctacte | 0.0% | 0.0% | 0.0% | 21 |

| Variante | 2ª-3ª sola | regla A | regla B | n |
|---|---|---|---|---|
| base | 9.1% | 9.1% | 43.9% | 66 |
| sin_saldo | 9.1% | 9.1% | 9.1% | 33 |
| orden_invertido | 9.1% | 9.1% | 45.5% | 66 |
| saldo_inicial_fila | 96.3% | 96.3% | 96.3% | 27 |
| fecha_sin_anio | 10.0% | 10.0% | 43.3% | 60 |
| pocas_filas | 4.5% | 4.5% | 4.5% | 66 |
| columna_insertada | 9.1% | 9.1% | 40.9% | 66 |
| titulos_genericos | 0.0% | 0.0% | 20.0% | 60 |
| resumen_arriba | 75.6% | 75.6% | 82.2% | 45 |

## 4. ACTUAL vs NUEVO vs NUEVO+IA (muestra estratificada n=695)

| Resultado | ACTUAL | NUEVO | NUEVO+IA |
|---|---|---|---|
| Exacta | 61.9% (430/695; IC95 58.2–65.4) | 80.0% (556/695; IC95 76.9–82.8) | 81.2% (564/695; IC95 78.1–83.9) |
| EXACTA_PROBADA | — | 12.1% (84/695; IC95 9.9–14.7) | 12.4% (86/695; IC95 10.1–15.0) |
| EXACTA_PREGUNTA | — | 64.3% (447/695; IC95 60.7–67.8) | 65.2% (453/695; IC95 61.6–68.6) |
| MAL_CON_AVISO | 1.0% (7/695; IC95 0.5–2.1) | 3.3% (23/695; IC95 2.2–4.9) | 3.2% (22/695; IC95 2.1–4.7) |
| MAL_PREGUNTA_SIN_ALERTA | — | 4.6% (32/695; IC95 3.3–6.4) | 4.3% (30/695; IC95 3.0–6.1) |
| SELLO_MIENTE | — | 0.0% (0/695; IC95 0.0–0.5) | 0.0% (0/695; IC95 0.0–0.5) |
| CAPA4 | 14.8% (103/695; IC95 12.4–17.7) | 8.3% (58/695; IC95 6.5–10.6) | 7.6% (53/695; IC95 5.9–9.8) |
| RECHAZO_FALSO | 7.2% (50/695; IC95 5.5–9.4) | 3.7% (26/695; IC95 2.6–5.4) | 3.7% (26/695; IC95 2.6–5.4) |
| SILENCIOSA (actual) | 15.1% (105/695; IC95 12.6–18.0) | — | — |

La IA arregla 8 y estropea 0; disputas (dos opiniones distintas → pide mirar) 17. Latencia del orquestador con IA: p50 10052 ms, p90 20055 ms, máx 40151 ms.

Comprobadas solas: NUEVO 12.1% (84/695; IC95 9.9–14.7) vs NUEVO+IA 12.4% (86/695; IC95 10.1–15.0).

## 5. Por familia de formato (corpus completo, sin IA)

| Familia | n | Exacta ACTUAL | Exacta NUEVO | Comprobada sola NUEVO | Silenciosa ACTUAL | Sello miente NUEVO | Capa 4 A→N |
|---|---|---|---|---|---|---|---|
| bancochile-cartola-historica | 195 | 70.3% | 94.4% | 82.6% (IC 76.6–87.2) | 11 | 0 | 44→9 |
| bancoestado-chequera-completa | 193 | 68.9% | 89.1% | 12.4% (IC 8.5–17.8) | 8 | 0 | 52→20 |
| bancoestado-chequera-solo-abonos | 170 | 69.4% | 77.6% | 0.0% (IC 0.0–2.2) | 9 | 0 | 34→29 |
| bancoestado-fechas-compactas | 199 | 71.4% | 94.0% | 15.6% (IC 11.2–21.3) | 10 | 0 | 47→12 |
| bci-detallado-invertido | 199 | 54.8% | 86.9% | 11.6% (IC 7.8–16.7) | 12 | 0 | 78→25 |
| bci-mes-actual-xls | 183 | 82.0% | 89.6% | 8.7% (IC 5.5–13.7) | 17 | 0 | 16→10 |
| bci-movimientos-detallado | 197 | 3.0% | 86.8% | 16.8% (IC 12.2–22.6) | 10 | 0 | 181→26 |
| bci-transferencias-recibidas | 177 | 80.8% | 94.4% | 9.0% (IC 5.6–14.2) | 13 | 0 | 21→9 |
| bice-estado-de-cuenta-solo-abonos | 176 | 77.8% | 88.6% | 0.0% (IC 0.0–2.1) | 16 | 0 | 23→10 |
| bice-estado-de-cuenta | 193 | 60.6% | 79.8% | 73.1% (IC 66.4–78.8) | 21 | 0 | 55→39 |
| cartola-cuenta-corriente-simple | 201 | 73.6% | 90.5% | 11.4% (IC 7.7–16.6) | 10 | 0 | 41→19 |
| cartola-simple-fecha-tipo-saldo | 182 | 85.2% | 95.1% | 13.2% (IC 9.0–18.9) | 6 | 0 | 17→9 |
| clp-bs-montos-como-fecha | 169 | 14.2% | 17.8% | 0.0% (IC 0.0–2.2) | 89 | 0 | 49→43 |
| clp-bs-planilla-casera | 166 | 0.0% | 0.0% | 0.0% (IC 0.0–2.3) | 145 | 0 | 21→45 |
| me-planilla-fecha-monto-comision | 177 | 78.0% | 91.5% | 9.6% (IC 6.1–14.8) | 15 | 0 | 23→14 |
| mis-movimientos-completa | 197 | 70.1% | 90.4% | 16.8% (IC 12.2–22.6) | 16 | 0 | 43→15 |
| mis-movimientos-solo-ingresos-con-saldo | 189 | 19.6% | 24.3% | 0.0% (IC 0.0–2.0) | 30 | 0 | 122→122 |
| mis-movimientos-solo-ingresos | 185 | 72.4% | 85.4% | 0.0% (IC 0.0–2.0) | 25 | 0 | 20→18 |
| plantilla-massdte-boletas | 183 | 78.1% | 89.1% | 2.2% (IC 0.9–5.5) | 20 | 7 | 20→10 |
| santander-3-columnas-editada | 181 | 65.2% | 81.2% | 0.0% (IC 0.0–2.1) | 26 | 0 | 28→21 |
| santander-movimientos-ctacte-completa | 186 | 71.0% | 91.9% | 8.6% (IC 5.4–13.5) | 32 | 0 | 19→11 |
| santander-movimientos-ctacte | 175 | 66.3% | 92.0% | 0.0% (IC 0.0–2.1) | 36 | 0 | 21→13 |
| sabotajes | 50 | 76.0% | 100.0% | 2.0% (IC 0.4–10.5) | 5 | 0 | 7→0 |
| adversariales | 79 | 49.4% | 77.2% | 8.9% (IC 4.4–17.2) | 10 | 0 | 25→7 |

## 6. Por mutación (specs base, mutación simple)

| Mutación | n | Exacta A | Exacta N | Sola N | Silenciosa A | Miente N |
|---|---|---|---|---|---|---|
| base | 44 | 84.1% | 88.6% | 9.1% | 2 | 0 |
| titulos_ingles | 40 | 67.5% | 87.5% | 5.0% | 2 | 0 |
| titulos_genericos | 40 | 70.0% | 90.0% | 0.0% | 2 | 0 |
| titulos_abreviados | 40 | 67.5% | 85.0% | 5.0% | 0 | 0 |
| sin_titulos | 40 | 70.0% | 90.0% | 5.0% | 2 | 0 |
| columna_insertada | 44 | 77.3% | 86.4% | 9.1% | 4 | 0 |
| columnas_invertidas | 44 | 72.7% | 84.1% | 9.1% | 8 | 0 |
| columnas_barajadas | 44 | 75.0% | 86.4% | 9.1% | 5 | 0 |
| basura_extra | 44 | 81.8% | 86.4% | 36.4% | 4 | 0 |
| glosa_con_total | 36 | 83.3% | 88.9% | 11.1% | 0 | 0 |
| montos_formato_ingles | 44 | 0.0% | 88.6% | 9.1% | 27 | 0 |
| montos_texto_pesos | 44 | 79.5% | 88.6% | 9.1% | 2 | 0 |
| montos_texto_decimales | 44 | 86.4% | 90.9% | 9.1% | 2 | 0 |
| montos_texto_cl | 44 | 81.8% | 86.4% | 9.1% | 4 | 0 |
| sin_saldo | 22 | 90.9% | 90.9% | 9.1% | 0 | 0 |
| orden_invertido | 44 | 81.8% | 86.4% | 9.1% | 4 | 0 |
| fecha_iso | 44 | 59.1% | 77.3% | 4.5% | 3 | 0 |
| fecha_sin_anio | 40 | 80.0% | 85.0% | 10.0% | 4 | 0 |
| fecha_compacta | 38 | 84.2% | 89.5% | 5.3% | 3 | 0 |
| fecha_anio_corto | 44 | 40.9% | 40.9% | 9.1% | 0 | 0 |
| fecha_mes_texto | 44 | 0.0% | 90.9% | 9.1% | 0 | 0 |
| fecha_con_puntos | 44 | 0.0% | 0.0% | 0.0% | 0 | 0 |
| fecha_serial_sin_formato | 44 | 86.4% | 90.9% | 9.1% | 3 | 0 |
| fecha_excel | 24 | 100.0% | 100.0% | 16.7% | 0 | 0 |
| monto_con_signo | 20 | 10.0% | 90.0% | 10.0% | 0 | 0 |
| monto_y_bandera | 20 | 80.0% | 90.0% | 10.0% | 2 | 0 |
| filtrado_solo_abonos | 20 | 55.0% | 55.0% | 0.0% | 0 | 0 |
| resumen_abajo | 32 | 84.4% | 90.6% | 78.1% | 3 | 0 |
| fila_total | 38 | 86.8% | 92.1% | 10.5% | 2 | 0 |
| sum_formula | 38 | 78.9% | 84.2% | 7.9% | 4 | 0 |
| subtotal_por_dia | 30 | 6.7% | 13.3% | 13.3% | 14 | 2 |
| glosa_partida | 36 | 72.2% | 94.4% | 11.1% | 7 | 0 |
| saldo_inicial_fila | 18 | 88.9% | 100.0% | 100.0% | 0 | 0 |
| hoja_resumen_antes | 40 | 85.0% | 87.5% | 10.0% | 3 | 0 |
| hoja_readme_despues | 44 | 86.4% | 90.9% | 9.1% | 3 | 0 |
| filas_vacias_intercaladas | 44 | 70.5% | 77.3% | 9.1% | 10 | 0 |
| csv_punto_y_coma | 38 | 15.8% | 84.2% | 10.5% | 26 | 0 |
| csv_coma | 38 | 15.8% | 81.6% | 10.5% | 25 | 0 |
| xls_antiguo | 42 | 85.7% | 90.5% | 9.5% | 3 | 0 |
| pocas_filas | 44 | 90.9% | 90.9% | 6.8% | 3 | 0 |
| muchas_filas | 44 | 86.4% | 90.9% | 9.1% | 4 | 0 |
| vacio_como_cero | 20 | 70.0% | 90.0% | 20.0% | 0 | 0 |
| vacio_como_guion | 20 | 70.0% | 90.0% | 20.0% | 0 | 0 |
| columna_indice | 44 | 70.5% | 88.6% | 9.1% | 8 | 0 |
| montos_rango_serial | 44 | 86.4% | 90.9% | 9.1% | 1 | 0 |
| dos_fechas | 36 | 86.1% | 86.1% | 11.1% | 4 | 0 |
| ceros_en_texto | 44 | 86.4% | 90.9% | 9.1% | 2 | 0 |
| fecha_mm_dd | 12 | 0.0% | 100.0% | 16.7% | 0 | 0 |
| fecha_ddmmyyyy_texto | 32 | 75.0% | 81.3% | 6.3% | 4 | 0 |
| resumen_arriba | 30 | 80.0% | 86.7% | 76.7% | 4 | 0 |
| celdas_combinadas | 42 | 81.0% | 85.7% | 4.8% | 3 | 0 |
| saldo_en_texto | 20 | 80.0% | 90.0% | 0.0% | 0 | 0 |
| separar_cargo_abono | 6 | 83.3% | 83.3% | 0.0% | 0 | 0 |

## 7. Los 20 peores casos del NUEVO

| # | Cartola (id = repro) | ACTUAL | NUEVO | NUEVO+IA | Detalle |
|---|---|---|---|---|---|
| 1 | `plantilla-massdte-boletas|subtotal_por_dia|s28330` | SILENCIOSA | SELLO_MIENTE (cliente) | — | capa 3 · leídas 54/27 faltan 0 sobran 27; Plantilla massDTE llenada por el cliente: se lee tal cual |
| 2 | `plantilla-massdte-boletas|subtotal_por_dia+dos_fechas|s218012` | SILENCIOSA | SELLO_MIENTE (cliente) | — | capa 3 · leídas 163/132 faltan 0 sobran 31; Plantilla massDTE llenada por el cliente: se lee tal cual |
| 3 | `plantilla-massdte-boletas|orden_invertido+subtotal_por_dia+fecha_sin_anio|s218040` | SILENCIOSA | SELLO_MIENTE (cliente) | — | capa 3 · leídas 28/14 faltan 0 sobran 14; Plantilla massDTE llenada por el cliente: se lee tal cual |
| 4 | `plantilla-massdte-boletas|ds006:cartola_mensual_con_resumen|s503884` | SILENCIOSA | SELLO_MIENTE (cliente) | — | capa 3 · leídas 199/168 faltan 0 sobran 31; Plantilla massDTE llenada por el cliente: se lee tal cual |
| 5 | `bci-mes-actual-xls|subtotal_por_dia|s15330` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 129/98 faltan 0 sobran 31; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 6 | `bice-estado-de-cuenta-solo-abonos|subtotal_por_dia|s18330` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 98/69 faltan 0 sobran 29; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 7 | `clp-bs-montos-como-fecha|columna_insertada|s22050` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 196/196 faltan 196 sobran 196; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 8 | `clp-bs-montos-como-fecha|columnas_invertidas|s22060` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 115/115 faltan 115 sobran 115; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 9 | `clp-bs-montos-como-fecha|montos_formato_ingles|s22100` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 281/281 faltan 281 sobran 281; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 10 | `clp-bs-montos-como-fecha|montos_texto_cl|s22130` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 267/267 faltan 267 sobran 267; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 11 | `clp-bs-montos-como-fecha|fecha_ddmmyyyy_texto|s22160` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 206/206 faltan 206 sobran 206; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 12 | `clp-bs-montos-como-fecha|fecha_iso|s22171` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 281/281 faltan 281 sobran 281; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 13 | `clp-bs-montos-como-fecha|fecha_compacta|s22190` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | capa 2 · leídas 110/110 faltan 110 sobran 110; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 14 | `clp-bs-montos-como-fecha|sum_formula|s22321` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | capa 2 · leídas 191/191 faltan 191 sobran 191; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 15 | `clp-bs-montos-como-fecha|hoja_resumen_antes|s22361` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 319/319 faltan 319 sobran 319; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 16 | `clp-bs-montos-como-fecha|xls_antiguo|s22410` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 87/87 faltan 87 sobran 87; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 17 | `clp-bs-montos-como-fecha|pocas_filas|s22421` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 7/7 faltan 7 sobran 7; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 18 | `clp-bs-montos-como-fecha|muchas_filas|s22430` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | capa 2 · leídas 721/721 faltan 721 sobran 721; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 19 | `clp-bs-montos-como-fecha|celdas_combinadas|s22460` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 317/317 faltan 317 sobran 317; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |
| 20 | `clp-bs-montos-como-fecha|columna_indice|s22471` | SILENCIOSA | MAL_PREGUNTA_SIN_ALERTA (sin_comprobar) | — | capa 2 · leídas 243/243 faltan 243 sobran 243; La cartola no trae saldo ni totales del banco con qué comprobar la lectura |

Reproducir: `LECTOR_ACTUAL=… npx tsx scripts/corpus-cartolas/correr.ts --repro=<id>` escribe el archivo.
