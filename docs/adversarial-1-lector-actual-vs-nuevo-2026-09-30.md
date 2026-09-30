# Adversarial #1 — lector de cartolas ACTUAL (origin/dev d0aab37) vs NUEVO (feat/lector-cartolas-con-juez) — 2026-09-30

Revisor: adversarial #1. No me fié de las cifras del constructor: las reproduje y después armé un banco propio de 51 cartolas que él no conocía. Corrí el **orquestador completo** de cada versión (plantilla → caché → heurística → nombres → [IA] → capa 4), no solo la heurística.

- Proveedor IA: **DeepSeek `deepseek-v4-flash` vía OpenCode Go** (helper `scripts/lib/solo-opencode.ts`, que imprime `proveedor: opencodego (fireworks bloqueado)`). **0 llamadas a Fireworks redirigidas** y 0 a otros hosts bloqueadas, en las 3 corridas. En total fueron 102 llamadas reales a DeepSeek (50 del banco del constructor + 52 del mío).
- Producción no se tocó: nada de Supabase, Vercel, push ni migraciones. Sin credenciales de Supabase en el proceso, el `adapter-store` devuelve null (sin caché, sin guardar).
- Cartolas reales (`santander.xlsx`, `Cartola N°02 - 11 2025.xlsx`): solo con lectores determinísticos y con `fetch` reemplazado por uno que lanza error (**0 intentos de red**). Este informe no trae montos, glosas ni sumas de las clientas: solo conteos.
- Scripts y salidas crudas (fuera del repo): `/private/tmp/claude-501/…/scratchpad/adversarial-1/` (`casos.ts`, `medir.ts`, `reales.ts`, `nci.json`, `banco50-con-ia.txt`).
- Aviso: en este worktree aparece `src/lib/parsers/__adv2__/` (sin trackear, es de otro revisor). Uno de sus tests falla a propósito. Sin esa carpeta, los 313 tests del constructor en `src/lib/parsers` y `src/lib/cartola` pasan.

## Clasificación usada

| Clase | Qué significa |
|---|---|
| OK_PROBADO | Lectura exacta (fecha, monto y dirección de cada fila) y sello `saldo` o `total_banco` |
| OK_PREGUNTA | Exacta, pero sello `sin_comprobar`: aparece "Así la leímos" (advierte, **no bloquea**) |
| MAL_PREGUNTA | Mal leída con sello `sin_comprobar`: se advierte, no se bloquea (atrapado *débil*) |
| ATRAPADO_CAPA4 | Ningún lector determinístico la aceptó: se va a capa 4 (hoja entera a la IA como texto) con alarma |
| RECHAZO_FALSO | Capa 4, pero algún mapa determinístico de esa versión la leía exacta |
| PROBADO_CON_FALTANTES_VISIBLES / MAL_CON_FALTANTES_VISIBLES | Mal leída, pero el cuadre muestra "Faltan N" (descartes no legítimos u otras hojas). En el nuevo, además, con sello **probado** encima |
| **SILENCIOSO** | Mal leída, aceptada y sin ninguna señal. En el nuevo, además, **sellada como probada** ("El saldo corrido cuadra fila a fila") |

En el actual no hay sello: toda lectura aceptada cuenta como "OK", y no existe "pide confirmar".

---

## 1. Banco de 50 sabotajes del constructor: reproducido, las cifras calzan

`npx tsx scripts/comparar-lector-deepseek.ts` (ref actual = origin/dev):

| | Resultado |
|---|---|
| Actual | **38 OK · 5 silenciosos** · 3 atrapados · 4 rechazos falsos |
| Nuevo sin IA | **46 OK_PROBADO + 4 OK_PREGUNTA · 0 silenciosos** (sellos: 45 saldo, 1 total_banco, 4 sin_comprobar) |
| Nuevo + IA | Idéntico al nuevo sin IA: 46 + 4, 0 disputas. **En este banco la IA no aporta nada** |
| IA sola (mapa DeepSeek) | 42 OK · 3 MAL · 5 timeouts (20 s) |
| Latencia DeepSeek | Mediana 4,6 s; máximo 20,0 s (timeout) |

Veredicto: las cifras del constructor son reales. Pero en ese banco 45 de 50 cartolas traen saldo corrido con 30 movimientos, así que el sello "saldo" es fácil de ganar. Por eso armé el banco propio.

## 2. Banco adversarial nuevo: 51 cartolas que el constructor no conocía

Resumen (misma cartola, orquestador completo):

| | OK prob. | OK pregunta | Atrapado capa 4 | Rechazo falso | Mal pregunta | Mal con faltantes visibles | **SILENCIOSO** |
|---|---|---|---|---|---|---|---|
| **Actual** | 27 (sin sello) | — | 16 | 1 | — | 4 | **3** |
| **Nuevo sin IA** | 22 | 6 | 11 | 1 | 1 | 3 (sellados "saldo") | **7** |
| **Nuevo + IA** | 22 | 7 | 10 | 0 | 4 | 3 (sellados "saldo") | **5** |
| IA sola (mapa) | 30 OK · 13 MAL · 8 error (4 timeouts, 4 "mapa fuera de rango") | | | | | | |

- Lecturas exactas: actual 27 · nuevo 28 · nuevo+IA 29.
- Silenciosos: actual 3 · **nuevo 7** · nuevo+IA 5. Uno de los silenciosos (`fila_informativa`) es de verdad discutible y aparece en las tres columnas.
- Latencia: los lectores determinísticos tardan ~2 ms por cartola (máx. 11 ms), igual en ambos. DeepSeek: **mediana 4,3 s, p90 12,1 s, máx. 20,0 s**, con 4 timeouts en 51 llamadas.

### Detalle por caso
| # | caso | banco | qué tiene | actual | nuevo sin IA (sello) | nuevo + IA (sello) | IA sola |
|---|---|---|---|---|---|---|---|
| 1 | `bice_resumen_abajo` | BICE | BICE con saldo corrido y bloque RESUMEN DEL PERIODO abajo (saldo anterior, total abonos/cargos, saldo final). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 2 | `bice_sin_saldo_resumen` | BICE | BICE sin columna saldo; resumen abajo con saldo anterior/final y totales. | OK | OK_PROBADO (total_banco) | OK_PROBADO (total_banco) | OK |
| 3 | `scotia_saldo_solo_fin_dia` | Scotiabank | Scotiabank: Fecha Mov. + Fecha Contable, saldo SOLO en la última fila de cada día (saldo diario). | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 4 | `scotia_montos_coma_00` | Scotiabank | Scotiabank con montos como texto '12.345,00' y saldo '1.234.567,00'. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 5 | `falabella_monto_signado_saldo` | Falabella | Banco Falabella: UNA columna Monto con signo (negativo = cargo) + Saldo, números tipados. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 6 | `falabella_monto_signado_sin_saldo` | Falabella | Falabella: Monto con signo, SIN saldo (sin bandera de tipo). | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 7 | `falabella_signo_texto` | Falabella | Falabella: Monto como texto '-$12.345' / '$12.345' + Saldo texto. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 8 | `security_ddmm_con_periodo` | Security | Security: fechas 'dd/mm' sin año, con 'Período: 01/09/2026 al 30/09/2026' arriba. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 9 | `security_ddmm_cruce_anio_periodo` | Security | Security dd/mm cruzando diciembre→enero, con período 20/12/2025 al 10/01/2026. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 10 | `security_ddmm_cruce_sin_periodo` | Security | dd/mm cruzando dic→ene SIN período impreso (el año hay que deducirlo). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 11 | `ripley_csv_puntoycoma` | Ripley | Banco Ripley: CSV con ';', fechas dd/mm/yyyy, montos '1.234.567' (texto en el CSV). | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | MAL |
| 12 | `ripley_csv_signo_coma00` | Ripley | CSV ';' con monto con signo y ',00' ('-12.345,00'). | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | MAL |
| 13 | `csv_coma_montos_planos` | Genérico CSV | CSV ',' con montos SIN separador de miles y fechas dd/mm/yyyy (día ≤ 12 en la mitad). | SILENCIOSO | SILENCIOSO (saldo) | SILENCIOSO (saldo) | MAL |
| 14 | `coopeuch_pesos_coma00` | Coopeuch | Coopeuch: '$ 12.345,00' en cargo/abono y saldo. | ATRAPADO_CAPA4 | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 15 | `coopeuch_titulos_2_filas` | Coopeuch | Títulos en 2 filas: 'Montos' arriba de 'Cargo / Abono'. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 16 | `bchile_txt_tab` | Banco de Chile | TXT separado por TAB (subido como .csv), montos '1.234.567'. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | MAL |
| 17 | `bchile_txt_ancho_fijo` | Banco de Chile | TXT de ancho fijo (espacios), una sola columna para SheetJS. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 18 | `glosa_partida_2_filas` | Genérico | Glosa partida en 2 filas (la 2ª fila solo trae texto). | OK | SILENCIOSO (saldo) | MAL_PREGUNTA (sin_comprobar) disputa | OK |
| 19 | `glosa_partida_con_num_doc` | Genérico | Glosa partida: la 2ª fila trae 'RUT …' y el N° de operación en la columna Doc. | SILENCIOSO | SILENCIOSO (saldo) | MAL_PREGUNTA (sin_comprobar) disputa | OK |
| 20 | `fecha_solo_primera_del_dia` | Genérico | La fecha aparece solo en la 1ª fila de cada día (resto vacías). | MAL_CON_FALTANTES_VISIBLES | MAL_PREGUNTA (sin_comprobar) | MAL_PREGUNTA (sin_comprobar) | ERROR |
| 21 | `meses_cruzados` | Genérico | Cartola que cruza agosto→septiembre con fechas completas. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 22 | `subtotal_dia_con_fecha_en_glosa` | Genérico | Fila 'Total del día' CON fecha, subtotal en cargo/abono y el saldo repetido (4 días, 36 movs). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 23 | `subtotal_dia_sin_fecha` | Genérico | Fila 'Subtotal dd/mm/yyyy' SIN fecha en la columna fecha. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 24 | `celdas_desplazadas` | Genérico | 3 filas corridas una columna a la derecha (artefacto de celdas combinadas/PDF→Excel). | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | PROBADO_CON_FALTANTES_VISIBLES (saldo) | MAL |
| 25 | `columnas_vacias_intercaladas` | Genérico | Una columna vacía entre cada columna. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 26 | `solo_abonos_col_cargo_vacia` | Genérico | Cartola solo de abonos: la columna Cargos existe pero está vacía. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 27 | `solo_abonos_sin_col_cargo` | Genérico | Solo abonos, sin columna Cargos: Fecha / Descripción / Abonos / Saldo. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 28 | `solo_cargos_col_abono_vacia` | Genérico | Solo cargos (abonos vacíos), saldo bajando. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 29 | `duplicada_legitima_con_saldo` | Genérico | Dos movimientos idénticos el mismo día (misma glosa y monto), con saldo. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 30 | `duplicada_legitima_sin_saldo` | Genérico | Duplicado legítimo sin columna saldo. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 31 | `correlativo_parece_saldo` | Genérico | Sin saldo; 'Folio' con números grandes crecientes (45.123.001 + saltos) que parecen saldo. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 32 | `correlativo_parece_saldo_sin_titulos` | Genérico | Igual, sin fila de títulos. | RECHAZO_FALSO | RECHAZO_FALSO (-) | OK_PREGUNTA (sin_comprobar) disputa | OK |
| 33 | `resumen_arriba_no_calza_parcial` | Genérico | Resumen ARRIBA (saldo anterior, totales, saldo final) del mes COMPLETO, pero la cartola trae solo 20 de 32 movimientos (parcial). Saldo corrido presente. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 34 | `resumen_arriba_calza_sin_saldo` | Genérico | Resumen arriba que SÍ calza; sin columna saldo. | OK | OK_PROBADO (total_banco) | OK_PROBADO (total_banco) | OK |
| 35 | `resumen_arriba_banco_con_error` | Genérico | Resumen arriba con Total Abonos $1.000 más alto (error del banco); saldo corrido correcto. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 36 | `saldo_grande_titulos_genericos` | Genérico | Empresa con saldo ~$850 millones y movimientos chicos; títulos 'Columna N' (la dirección solo sale de la aritmética). | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | SILENCIOSO (saldo) | ERROR |
| 37 | `saldo_grande_sin_titulos` | Genérico | Saldo ~$850 millones, sin títulos, abono ANTES que cargo. | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | SILENCIOSO (saldo) | MAL |
| 38 | `fila_informativa_saldo_no_cambia` (discutible) | Genérico | 2 filas informativas con fecha y monto en Cargos pero el saldo NO cambia (retención en canje). Saldo ~$60M. | SILENCIOSO | SILENCIOSO (saldo) | SILENCIOSO (saldo) | MAL |
| 39 | `sobregiro_saldo_negativo` | Genérico | Saldo que pasa a negativo (sobregiro/línea). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 40 | `fechas_mes_texto` | Genérico | Fechas '05-SEP-2026' (mes en letras). | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | ERROR |
| 41 | `fecha_con_hora` | Genérico | Fecha con hora '05/09/2026 14:32'. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | ATRAPADO_CAPA4 (-) | MAL |
| 42 | `varias_hojas_resumen_primero` | Genérico | Libro con hoja 'Resumen' primero (3 filas mes/abonos/cargos/saldo con fechas) y la cartola en la 2ª hoja. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | MAL |
| 43 | `varias_hojas_dos_meses` | Genérico | Una hoja por mes (Agosto, Septiembre). Verdad = ambas. | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | PROBADO_CON_FALTANTES_VISIBLES (saldo) | MAL |
| 44 | `pocas_filas_con_saldo` | Genérico | Solo 6 movimientos con saldo corrido. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 45 | `ingles_con_decimales` | Genérico | Montos '1,234.00' (inglés con decimales) en cargo/abono/saldo. | ATRAPADO_CAPA4 | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 46 | `cargo_y_abono_misma_fila` | Genérico | Una fila trae abono 250.000 Y cargo 1.190 (comisión) a la vez. | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | PROBADO_CON_FALTANTES_VISIBLES (saldo) | MAL |
| 47 | `bandera_debe_haber` | Genérico | single_col con bandera 'Debe'/'Haber' y saldo. | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | MAL_PREGUNTA (sin_comprobar) disputa | MAL |
| 48 | `fechas_reales_excel` | Genérico | Fechas como Date de Excel y montos tipados; orden descendente. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 49 | `saldo_grande_titulos_reales_abono_primero` | Genérico | Saldo ~$850 millones, títulos reales 'Abonos / Cargos' (abono ANTES que cargo). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 50 | `saldo_medio_sin_titulos` | Genérico | Pyme con saldo ~$40 millones y movimientos ≤ $150.000, sin títulos, abono antes que cargo. | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | SILENCIOSO (saldo) | MAL |
| 51 | `fila_saldo_inicial_con_fecha` | Genérico | Primera fila '01/09/2026 / SALDO INICIAL / / / / 5.000.000' con fecha. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |

### Dónde gana el nuevo (banco adversarial)
- `coopeuch_pesos_coma00` ("$ 12.345,00") e `ingles_con_decimales` ("1,234.00"): el actual caía a capa 4 y el nuevo las lee exactas, con sello saldo. Esto sale del lector de montos por columna (`numeros.ts`), y es un avance real.
- Resúmenes del banco: `resumen_arriba_no_calza_parcial` y `resumen_arriba_banco_con_error` quedan **leídas bien y con ALERTA** ("el banco dice total abonos $X y leímos $Y"). El actual las aceptaba callado. `bice_sin_saldo_resumen` y `resumen_arriba_calza_sin_saldo` quedan selladas total_banco. El juez externo funciona.
- Con IA: `correlativo_parece_saldo_sin_titulos` pasa de rechazo falso a OK_PREGUNTA, y las dos `glosa_partida_*` pasan de silenciosas a disputa visible.
- Sin prueba, el nuevo pregunta en vez de callar: `pocas_filas_con_saldo`, `duplicada_legitima_sin_saldo`, `correlativo_parece_saldo`, `scotia_saldo_solo_fin_dia`. Eso tiene un costo de UX (falsas alarmas "Así la leímos"), pero es honesto.

### Dónde empeora el nuevo
- **`glosa_partida_2_filas`: REGRESIÓN, de OK a SILENCIOSO con sello saldo.** El actual la leía bien (heurística rechazada, entraba nombres). La heurística nueva sí pasa, pero parte en la fila 5 porque el primer bloque de ≥3 filas "de movimiento" seguidas empieza después de la 1ª continuación de glosa. Así pierde el **primer movimiento** y el censo independiente no lo ve, porque solo cuenta desde `skip_rows_before_data`. La ecuación del saldo cuadra en las 25 restantes y la cartola sale "probada" con 25/26.
- **`saldo_grande_titulos_genericos`, `saldo_grande_sin_titulos`, `saldo_medio_sin_titulos`: de capa 4 (con alarma) a SILENCIOSO con sello saldo y los 30 movimientos con la dirección INVERTIDA** (todo abono sale cargo y viceversa). La causa es la tolerancia de 1% del saldo: con saldo de $40 M, cualquier movimiento menor a ~$200 mil cabe en la tolerancia leído al revés. Las dos orientaciones "cuadran", `mejorTernaPorSaldo` empata y devuelve null, el respaldo por forma elige por posición y `formatoVerificadoPorSaldo` lo sella. Con títulos reales ("Abonos | Cargos") se lee bien (`saldo_grande_titulos_reales_abono_primero`). El riesgo aparece cuando los títulos no dicen la dirección. Con IA sigue silencioso: DeepSeek también lo invierte o hace timeout. Una pyme con saldo alto y movimientos chicos es un perfil común.
- `subtotal_dia_con_fecha_en_glosa`: lectura exacta, pero las 4 filas "Total del día" (con fecha) ahora quedan como descartes **no legítimos** `cargo_y_abono`. El cuadre mostraría "Faltan 4" falsos. El actual las marcaba como resumen legítimo. Es ruido visible, no una pérdida.
- En `celdas_desplazadas`, `cargo_y_abono_misma_fila` y `varias_hojas_dos_meses` ambos leen mal y los dos lo muestran en el cuadre. La diferencia es que el nuevo **además estampa "El saldo corrido cuadra fila a fila"**, y en `celdas_desplazadas` hay una fila fantasma de ~$700 mil (un N° de documento leído como cargo). El sello se contradice con el cuadre en la misma pantalla.

### Igual en ambos (deudas compartidas, no son regresión)
- **CSV: el camino está roto para formato chileno en los dos.** `XLSX.read` sobre un CSV convierte "1.500" en 1,5 y "05/09/2026" en **9 de mayo** (mm/dd), pero deja "13/09/2026" como texto. Resultado: `csv_coma_montos_planos` sale SILENCIOSO en ambos, con 11 fechas día↔mes cambiadas, y el nuevo lo **sella "saldo"** (la ecuación no mira fechas). `ripley_csv_*` y `bchile_txt_tab` caen a capa 4 en ambos. El comentario de `queue.ts` ("CSV = mismo lector determinístico") promete algo que no se cumple.
- `glosa_partida_con_num_doc` (silencioso en ambos: se pierde el 1er movimiento) y `fila_informativa_saldo_no_cambia` (discutible: 2 filas que no mueven el saldo se leen como cargos; el nuevo las sella "saldo").
- Capa 4 en ambos: montos con signo en una columna (Falabella ×3), `bandera_debe_haber`, `fechas_mes_texto` ("05-SEP-2026"), `fecha_con_hora`, `solo_abonos_sin_col_cargo`, TXT de ancho fijo. El nuevo no cubre ningún formato más aquí, salvo Debe/Haber con IA, que queda MAL_PREGUNTA con 16 filas perdidas y visibles.

## 3. Cartolas reales locales (solo determinístico, sin red)

| Archivo | Filas actual / nuevo | Lecturas idénticas (fecha, monto, dirección, glosa) | Descartes | Sello nuevo | Tiempo (mediana de 5) |
|---|---|---|---|---|---|
| santander.xlsx | 238 / 238 (todas abonos, bandera "A") | **sí, 0 diferencias** | iguales (1 resumen legítimo) | **saldo** | 13,2 ms / 10,6 ms |
| Cartola N°02 - 11 2025.xlsx | 675 / 675 (636 E, 39 S) | **sí, 0 diferencias** | iguales (0) | **saldo** | 23 ms / 27,8 ms |

**No hay regresión en reales**: mismas filas, mismos montos, mismas direcciones y mismas glosas. En la Cartola N°02 el sello saldo es sólido: 0 de 674 filas fallan la ecuación, y con la dirección invertida fallan 592.

**Pero en santander.xlsx el sello "saldo" es falso en su texto.** La ecuación falla en **31 de 237 filas (13,1%)**, incluso con tolerancia de $1. El archivo tiene solo abonos, y los saltos de saldo delatan movimientos que no están en la hoja (lo más probable es un export filtrado o parcial). Como el umbral acepta hasta 20% de filas fallidas, sale "El saldo corrido cuadra fila a fila", cuando el propio saldo está diciendo que la cartola viene incompleta. Las filas leídas están bien, pero la afirmación del sello no es cierta y esconde justo la señal útil.

## 4. Costo y latencia
- Los lectores determinísticos tardan 1–28 ms por cartola, sin diferencia apreciable entre actual y nuevo.
- La IA de estructura (con `LECTOR_ESTRUCTURA_IA=1`) agrega **~4–5 s de mediana, p90 ~12 s y 20 s en timeout**. Hubo 4/51 timeouts en mi banco y 5/50 en el del constructor, así que **~9% de las llamadas llegan al techo de 20 s**. Se llama **siempre**, incluso cuando el lector ya tiene prueba de saldo, y **una vez por hoja** (orchestrator.ts:240 dentro del `for` de hojas). Un libro de 3 hojas raras puede sumar 60 s.
- Aporte medido de la IA: en el banco del constructor, **0 cambios**. En el mío, 4 cambios: 2 silenciosos → disputa, 1 rechazo falso → OK_PREGUNTA, 1 capa 4 → MAL_PREGUNTA. No arregló ninguno de los silenciosos sellados por saldo invertido. Como mapa sola, DeepSeek acertó 30/51 (59%) contra 42/50 en el banco del constructor.

## Veredicto

**El nuevo es mejor en montos, en resúmenes del banco y en honestidad cuando NO hay prueba. Es igual en las cartolas reales (0 diferencias). Pero su sello "saldo" es demasiado blando y en ciertos casos es PEOR que el actual: convierte errores que antes caían a capa 4 con alarma en errores sellados como "probados", sin ninguna señal.** En el banco adversarial suben los silenciosos: actual 3, nuevo 7, nuevo+IA 5. Lo grave es que en el nuevo esos silenciosos vienen certificados, y un mapa sellado "saldo" se guarda **global y confirmado** (orchestrator.ts `guardarFormatoDerivado` → `saveAdapter` con `empresaId: null`), así que el error se contagia a otras empresas con la misma huella.

No lo daría por bueno para producción hasta corregir las fallas 1–3. Con eso resuelto, creo que sería claramente mejor que el actual.

## Fallas concretas, ordenadas por gravedad

1. **Sello "saldo" con tolerancia de 1% del saldo: aprueba cartolas con cargo/abono INVERTIDOS.**
   - Dónde: `src/lib/parsers/saldo-cuadre.ts:37` y `:73` (`Math.max(100, |esperado|*0.01)`), usado por `validator.ts:229` → `juez-banco.ts:312`. Empeora por `heuristic.ts:414-415`: el empate de ternas devuelve null y el respaldo por posición (`heuristic.ts:281+`) elige al azar la dirección.
   - Cómo reproducir: `casos.ts` → `saldo_medio_sin_titulos` (saldo $40 M, movimientos ≤ $150 mil, sin títulos, abono antes que cargo). Los 30 salen invertidos con sello saldo.
   - Arreglo sugerido: para el SELLO, tolerancia exacta (≤ $1) o proporcional al MONTO de la fila, nunca al saldo. Si las dos orientaciones cuadran, `sin_comprobar`.

2. **Sello "saldo" con hasta 20% de filas que NO cuadran.**
   - Dónde: `validator.ts:229` (`fallidas / revisadas <= 0.2`).
   - Cómo reproducir: `santander.xlsx` real (31/237 fallan y queda sellado), `celdas_desplazadas` (fila fantasma de ~$700 mil sellada), `fila_informativa_saldo_no_cambia`.
   - Arreglo sugerido: para sellar, 0 filas fallidas, o `sin_comprobar` con "N filas no cuadran". El 20% puede quedar para *elegir* un mapa, no para *certificarlo*.

3. **Filas ANTES del bloque detectado se pierden sin aviso.** Es la regresión de `glosa_partida_2_filas`.
   - Dónde: `apply.ts:499` (`censoIndependiente` parte en `cfg.skip_rows_before_data`) + `heuristic.ts:101` (`findTransactionBlockStart` exige ≥3 filas seguidas).
   - Cómo reproducir: `glosa_partida_2_filas` (el actual OK, el nuevo 25/26 sellado saldo) y `glosa_partida_con_num_doc`.
   - Arreglo sugerido: censar desde `header_row + 1`, no desde el inicio del bloque. Toda fila con fecha y plata sobre el bloque es `sin_leer`.

4. **El sello ignora descartes no legítimos distintos de `sin_leer` y `monto_ambiguo`.**
   - Dónde: `juez-banco.ts:310-312`. Una fila `cargo_y_abono`, `sin_fecha`, `tipo_desconocido` o `fecha_imposible` perdida no impide el sello "saldo".
   - Cómo reproducir: `cargo_y_abono_misma_fila`, `celdas_desplazadas`.
   - Arreglo sugerido: cualquier descarte no legítimo → `sin_comprobar` con alerta. El propio comentario de `sellarCartola` dice que "plata que el mapa no leyó gana a cualquier prueba".

5. **CSV: SheetJS destruye formato chileno (fechas mm/dd, "1.500" → 1,5). Compartido, pero el nuevo lo sella.**
   - Dónde: `orchestrator.ts` (`XLSX.read(buffer, {type:"array", cellDates:true})` también para CSV, `queue.ts:344`).
   - Cómo reproducir: `csv_coma_montos_planos` (11 fechas día↔mes cambiadas, sello saldo) y `ripley_csv_puntoycoma` (capa 4).
   - Arreglo sugerido: para CSV/TXT, `raw:true` / leer como texto (`cellText`, `cellDates:false`) y dejar las fechas y los montos a `parseFechaCartola` y `LectorMontos`.

6. **Mapa sellado por saldo nace GLOBAL y confirmado.**
   - Dónde: `orchestrator.ts` `guardarFormatoDerivado` → `adapter-store.ts:221` (`empresaId: null`).
   - Efecto: combinado con las fallas 1 y 2, un mapa invertido "probado" se aplica en caché a otras empresas con la misma huella.
   - Arreglo sugerido: compartir globalmente solo con prueba estricta (tolerancia $1, 0 fallidas) y ≥2 empresas.

7. **Dos opiniones: si ambas "cuadran" gana el lector, aunque lea menos filas.**
   - Dónde: `estructura-ia.ts:259`.
   - Cómo reproducir: en `glosa_partida_*` la IA leía 26/26 y el lector 25/26. Queda el lector con disputa.
   - Arreglo sugerido: desempatar por cobertura del censo (más filas con fecha y plata explicadas).

8. **Falsa alarma: subtotales "Total del día" CON fecha pasan a descarte no legítimo** (el actual los trataba como resumen legítimo).
   - Dónde: `apply.ts:377` (`(!conFecha && palabraEnGlosa)`).
   - Cómo reproducir: `subtotal_dia_con_fecha_en_glosa` → "Faltan 4".
   - Arreglo sugerido: una fila con fecha cuyos montos igualan la suma de las filas del mismo día → resumen.

9. **IA de estructura: latencia y alcance.**
   - Dónde: `orchestrator.ts:240`.
   - Qué pasa: corre siempre y por cada hoja; ~9% de timeouts a 20 s; aporte nulo en el banco del constructor.
   - Arreglo sugerido: llamarla solo si el lector no tiene prueba estricta, o con un presupuesto total por libro.

10. **(Menor)** "Se ve bien" sobre una muestra de 3 filas confirma el mapa propio (`lectura-actions.ts`), sin mirar si hay descartes o alertas. Con `necesitaConfirmacion` (`verificacion.ts:30-31`), un mapa ya confirmado deja de preguntar aunque la lectura siguiente salga `sin_comprobar`.

## Cómo reproducir todo
```
cd <worktree nuevo>
npx tsx scripts/comparar-lector-deepseek.ts                        # banco del constructor (50)
npx tsx <scratch>/adversarial-1/medir.ts [--sin-ia] [--solo=id]    # banco adversarial (51)
npx tsx <scratch>/adversarial-1/reales.ts                          # reales, sin red
```
(El worktree temporal `lector-actual` se eliminó al terminar. Para volver a correr `medir.ts`, recréalo con `git worktree add --detach <scratch>/lector-actual origin/dev` y un symlink a node_modules.)

---

# Vuelta 2 — después de los arreglos (commits 92e0398, 9f6f6e9, cf718e9)

Volví a medir lo mismo que en la vuelta 1, sobre el código arreglado: el worktree temporal de origin/dev (d0aab37), recreado y borrado al final, contra la rama nueva en cf718e9. Lo que corrí:

- el banco de 50 del constructor;
- mis 51 casos;
- 16 casos NUEVOS dirigidos a los arreglos;
- las 2 cartolas reales, solo con lector determinístico y sin red.

Todo, además, con "nuevo + IA" usando DeepSeek por OpenCode (`solo-opencode.ts`): **0 llamadas a Fireworks redirigidas y 0 a otros hosts bloqueadas en las 4 corridas**. Hubo 118 llamadas reales a DeepSeek (50 + 52 + 16), y en las 2 cartolas reales hubo 0 intentos de red.

## Resumen

| Banco | Actual | Nuevo sin IA | Nuevo + IA |
|---|---|---|---|
| 50 del constructor | 38 OK · **5 silenciosos** · 3 atrapados · 4 rechazos falsos | 46 OK_PROBADO + 4 OK_PREGUNTA · **0 silenciosos** | Igual (0 disputas) |
| Mis 51 (vuelta 1) | 27 OK · **3 silenciosos** · 16 capa 4 · 4 con faltantes visibles · 1 rechazo falso | **29 OK_PROBADO + 7 OK_PREGUNTA · 0 silenciosos** · 5 MAL_PREGUNTA · 9 capa 4 · 1 rechazo falso | 29 + 8 · **0 silenciosos** · 6 MAL_PREGUNTA · 8 capa 4 · 0 rechazos falsos (2 disputas) |
| 16 nuevos (vuelta 2) | 8 OK · **5 silenciosos** · 2 capa 4 · 1 con faltantes visibles | 7 OK_PROBADO + 4 OK_PREGUNTA · **1 silencioso** · 4 MAL_PREGUNTA | 8 + 4 · **1 silencioso** · 3 MAL_PREGUNTA |
| Reales (2) | 238 + 675 filas | **idénticas** (0 diferencias en fecha/monto/tipo/glosa) | (no se mandan a la IA) |

Lecturas exactas en los 67 casos míos: actual 35 · nuevo 47 · nuevo+IA 49. **Silenciosos: actual 8 · nuevo 1 · nuevo+IA 1.**

## Mis 51 casos: qué cambió respecto de la vuelta 1

| caso | actual | nuevo vuelta 1 | **nuevo vuelta 2** | nuevo + IA v2 |
|---|---|---|---|---|
| `ripley_csv_puntoycoma` | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `csv_coma_montos_planos` | SILENCIOSO | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `bchile_txt_tab` | ATRAPADO_CAPA4 | ATRAPADO_CAPA4 (-) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `glosa_partida_2_filas` | OK | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `glosa_partida_con_num_doc` | SILENCIOSO | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `celdas_desplazadas` | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | **MAL_PREGUNTA (sin_comprobar)** | MAL_PREGUNTA (sin_comprobar) |
| `saldo_grande_titulos_genericos` | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `saldo_grande_sin_titulos` | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |
| `fila_informativa_saldo_no_cambia` | SILENCIOSO | SILENCIOSO (saldo) | **MAL_PREGUNTA (sin_comprobar)** | MAL_PREGUNTA (sin_comprobar) |
| `varias_hojas_resumen_primero` | OK | OK_PROBADO (saldo) | **OK_PREGUNTA (sin_comprobar)** | OK_PREGUNTA (sin_comprobar) |
| `varias_hojas_dos_meses` | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | **MAL_PREGUNTA (sin_comprobar)** | MAL_PREGUNTA (sin_comprobar) |
| `cargo_y_abono_misma_fila` | MAL_CON_FALTANTES_VISIBLES | PROBADO_CON_FALTANTES_VISIBLES (saldo) | **MAL_PREGUNTA (sin_comprobar)** | MAL_PREGUNTA (sin_comprobar) |
| `saldo_medio_sin_titulos` | ATRAPADO_CAPA4 | SILENCIOSO (saldo) | **OK_PROBADO (saldo)** | OK_PROBADO (saldo) |

Los otros 38 casos quedaron igual que en la vuelta 1.

- **Los 7 silenciosos del nuevo en la vuelta 1 quedaron en 0.**
  - Saldo alto invertido: ahora lee al peso y la dirección sale correcta.
  - Glosa partida: lee 26/26.
  - CSV: "1.500" y "05/09" se leen chilenos.
  - Fila informativa: ahora "N filas no cuadran".
- Los 4 "probados con faltantes" (celdas desplazadas, cargo y abono en la misma fila, dos hojas) quedaron sin sello y con alerta.
- **Costo:** `varias_hojas_resumen_primero` bajó de OK_PROBADO a OK_PREGUNTA. Es una falsa alarma: la otra hoja es un resumen, pero "otra hoja con datos" le quita el sello. Es aceptable.
- Siguen en capa 4 en ambas versiones: montos con signo en una columna (Falabella ×3), Debe/Haber, fechas "05-SEP-2026", fecha con hora, solo abonos sin columna de cargos, TXT de ancho fijo y `ripley_csv_signo_coma00`. No son regresión; son cobertura pendiente.

## 16 casos nuevos dirigidos a los arreglos

| # | caso | qué ataca | actual | nuevo sin IA (sello) | nuevo + IA (sello) | IA sola |
|---|---|---|---|---|---|---|
| 1 | `v2_saldo_inicial_como_abono` | 1ª fila '01/09/2026 / SALDO INICIAL' con el saldo inicial ESCRITO EN ABONOS (y en saldo). La 1ª fila nunca se comprueba con la ecuación. | SILENCIOSO | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 2 | `v2_saldo_anterior_glosa_rara` | 1ª fila '01/09/2026 / SALDO ANT. CTA CTE' (abreviado) con el monto en Abonos y en Saldo. | SILENCIOSO | SILENCIOSO (saldo) | SILENCIOSO (saldo) | MAL |
| 3 | `v2_total_dia_con_fecha_sin_saldo` | 'Total del día' CON fecha y SIN columna saldo (no hay 'saldo quieto' que lo delate). | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 4 | `v2_pago_total_igual_suma_dia_sin_saldo` | Movimiento REAL 'PAGO TOTAL TARJETA CREDITO' al final del día, cuyo monto es igual a la suma de los cargos del día; sin saldo. | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 5 | `v2_subtotal_dia_sin_palabra` | Subtotal del día con fecha, glosa '*** 03/09/2026 ***' (sin la palabra total), saldo quieto. | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | ERROR |
| 6 | `v2_celda_rara_ingles_en_col_chilena` | Montos texto '1.234.567' y UNA celda de abono en formato inglés ('250,000'); con saldo. | SILENCIOSO | MAL_PREGUNTA (sin_comprobar) alerta | MAL_PREGUNTA (sin_comprobar) | MAL |
| 7 | `v2_celda_usd` (discutible) | Una celda de cargo 'USD 1.200' (en dólares) entre montos CLP; el saldo sí baja en CLP. | SILENCIOSO | MAL_PREGUNTA (sin_comprobar) alerta | MAL_PREGUNTA (sin_comprobar) | MAL |
| 8 | `v2_csv_dias_1_al_12` | CSV ';' chileno con TODOS los días entre 01 y 12 (dd/mm indistinguible de mm/dd). | ATRAPADO_CAPA4 | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 9 | `v2_csv_mmdd_real` | CSV ',' con fechas mm/dd/yyyy de verdad (hay días > 12 que lo prueban). | OK | OK_PROBADO (saldo) | OK_PROBADO (saldo) | MAL |
| 10 | `v2_csv_comillas_puntoycoma_en_glosa` | CSV ';' con comillas, ';' DENTRO de la glosa y montos '$1.234.567'. | SILENCIOSO | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 11 | `v2_csv_latin1_crlf_coma00` | CSV ';' en Latin-1 (Ñ/ó), fin de línea CRLF, montos '12.345,00'. | ATRAPADO_CAPA4 | OK_PROBADO (saldo) | OK_PROBADO (saldo) | OK |
| 12 | `v2_fila_sin_fecha_con_monto_y_saldo` | Fila SIN fecha pero con cargo 2.380 y saldo (comisión pegada al movimiento anterior, parece 'continuación'). | MAL_CON_FALTANTES_VISIBLES | MAL_PREGUNTA (sin_comprobar) alerta | MAL_PREGUNTA (sin_comprobar) | MAL |
| 13 | `v2_glosa_3_filas_al_inicio` | Los 2 primeros movimientos con glosa en 3 filas (bloque arranca 'roto'). | OK | MAL_PREGUNTA (sin_comprobar) alerta | OK_PROBADO (saldo) | OK |
| 14 | `v2_sum_parcial` | Sin saldo; fila Total con =SUM(C4:C24) / =SUM(D4:D24) que deja FUERA las 3 últimas filas (el banco sumó mal). | OK | OK_PREGUNTA (sin_comprobar) | OK_PREGUNTA (sin_comprobar) | OK |
| 15 | `v2_sum_completo` | Sin saldo; =SUM completo de Cargos y Abonos con títulos direccionales. | OK | OK_PROBADO (total_banco) | OK_PROBADO (total_banco) | OK |
| 16 | `v2_orden_intradia_invertido` | Días en orden ascendente pero dentro de cada día lo más nuevo arriba (la ecuación falla fila a fila aunque todo esté bien leído). | OK | OK_PREGUNTA (sin_comprobar) alerta | OK_PREGUNTA (sin_comprobar) | OK |

### Qué dicen los 16

- **Aguantan bien:**
  - **CSV chileno.** Días 1–12 salen dd/mm; el mm/dd real también sale bien porque la columna lo prueba. Las comillas con ";" dentro de la glosa, Latin-1 con CRLF y ",00" funcionan. Pasa de 2 capa 4 + 1 silencioso a 4 OK_PROBADO.
  - **Celda rara** ("250,000" en una columna chilena, "USD 1.200"). Va sola al censo con alerta y sin sello; antes la inventaba en silencio.
  - **"SALDO INICIAL"** escrito en la columna de abonos: ya no lo lee como movimiento.
  - **Subtotal del día sin la palabra "total"**: lo reconoce por estructura y ya no genera el falso "Faltan 5" que marcaba el actual.
  - **"Total del día" con fecha y sin saldo**, y un "PAGO TOTAL TARJETA" real que iguala la suma del día: los lee bien y pide confirmar (sin prueba no hay sello).
  - **SUM**: el completo sella total_banco. El parcial NO sella.
  - **Fila sin fecha con monto y saldo**: la avisa con alerta y no la pega a la glosa.
- **Queda un silencioso:** `v2_saldo_anterior_glosa_rara`. La 1ª fila "01/09/2026 | SALDO ANT. CTA CTE" con el saldo inicial en Abonos se lee como **un abono de $4 M** y la cartola sale sellada **"El saldo corrido cuadra al peso en todas las filas"**. También pasa con IA. El actual tampoco la veía (también quedaba silencioso), así que no es regresión. Pero es un error con sello falso.
- **Regresión visible (no silenciosa):** `v2_glosa_3_filas_al_inicio`. El actual la leía 26/26. El nuevo lee 24/26, con alerta "2 filas con fecha y plata que no leyó". Con IA sí lee 26/26 con sello.
- **Falsa alarma:** `v2_orden_intradia_invertido`. Todo está bien leído, pero sale la alerta "5 de 29 filas no cuadran (¿cartola filtrada?)". Con alerta se oculta "Se ve bien" (cf718e9) y el cliente tiene que escribir su saldo final. No se pierde nada, pero la fricción es real para bancos que ordenan así dentro del día.

## Cartolas reales (solo determinístico, sin red)

| Archivo | Filas actual / nuevo | ¿Idénticas? | Sello nuevo (v1 → v2) |
|---|---|---|---|
| santander.xlsx | 238 / 238 | **sí** | saldo (falso) → **sin_comprobar con alerta: "32 de 237 filas no cuadran (¿cartola filtrada o incompleta?)"**. Correcto: es lo que los datos dicen |
| Cartola N°02 - 11 2025.xlsx | 675 / 675 | **sí** | saldo → saldo ("cuadra al peso en todas las filas") |

Sin regresión en reales. El sello de santander ahora dice la verdad, aunque el cliente va a ver una alerta en esa cartola, que viene filtrada.

## Latencia y costo
- Lectores determinísticos: 2–30 ms por cartola, sin cambio.
- DeepSeek:
  - Banco del constructor: mediana 7,4 s, máx. 20 s, con **10/50 timeouts**. Es peor que en la vuelta 1 (5/50); se ve como variación del servicio, porque no depende del código.
  - Mis 51: mediana 5,3 s, p90 11,6 s, 4 timeouts.
  - 16 nuevos: mediana 5,3 s, máx. 9,2 s.
- **Ahora la IA solo se consulta cuando el lector no tiene prueba** (≤2 por libro). En el banco del constructor eso significa 0 consultas en las 46 cartolas con sello. En nuevo+IA la mediana por cartola baja a ~4 ms y el peor caso medido fue 5,1 s.
- Aporte de la IA en esta vuelta:
  - `correlativo_sin_titulos`: de rechazo falso a OK_PREGUNTA.
  - `v2_glosa_3_filas_al_inicio`: de MAL_PREGUNTA a OK_PROBADO.
  - `bandera_debe_haber`: de capa 4 a MAL_PREGUNTA.
  - No empeoró ninguno.

## Veredicto vuelta 2

**Listo para producción con el flag de IA APAGADO, con 1 arreglo chico antes (P1), y el resto como deuda anotada.**

- Frente al actual es claramente mejor: silenciosos 8 → 1 en mis 67 casos y 5 → 0 en los 50 del constructor. Lee exacto en 12 casos más, las cartolas reales salen idénticas, y los sellos ahora solo aparecen con prueba al peso.
- El único silencioso que queda también existe en el actual. La diferencia es que el nuevo le pone **sello "saldo"**, y en la mesa eso pesa más que el silencio del actual. Por eso es bloqueante, pero se arregla en pocas líneas.

### Qué falta (ordenado)

1. **P1 (bloqueante, chico): la PRIMERA fila leída nunca se comprueba y aun así se sella "todas las filas".**
   - Dónde: `saldo-cuadre.ts:138` (`if (prev === null)`: la primera fila con saldo abre la cadena sin verificar su monto) y `juez-banco.ts:362` (`todas = … revisadas === leidas - 1` acepta que la 1ª quede sin revisar).
   - Cómo reproducir: `casos2.ts` → `v2_saldo_anterior_glosa_rara`.
   - Arreglo sugerido: si la 1ª fila tiene |monto| = |saldo| (o su saldo − monto = 0), no sellar. O exigir el saldo inicial (resumen impreso, o la cartola anterior encadenada por cuenta) para que la 1ª fila cuente como revisada; si no, sello `saldo` con la 1ª fila mostrada como "no comprobada". Ampliar además el reconocimiento de "saldo anterior" a abreviaturas ("SALDO ANT.", "SDO. INICIAL").
2. **P2: glosa partida en 2+ filas seguidas al inicio del bloque.**
   - Dónde: `heuristic.ts:125-136` (`extenderBloqueHaciaArriba` exige que la fila anterior a una continuación sea un movimiento, así que dos continuaciones seguidas cortan la subida).
   - Hoy queda visible con alerta, así que no bloquea; es una regresión frente al actual en ese formato.
3. **P3: orden dentro del día invertido → falsa alerta "¿cartola filtrada?".**
   - Arreglo sugerido: probar la ecuación permitiendo reordenar dentro de cada fecha antes de concluir "no cierra".
4. **P4: SUM parcial** no sella (bien), pero el detalle dice "no trae saldo ni totales del banco", y eso es falso. Debería decir "la fórmula del banco no cubre todas las filas" (`juez-banco.ts:256-270`).
5. **P5 (cobertura, no seguridad):** formatos que ambas versiones mandan a capa 4. Los más comunes en Chile son el monto con signo en una columna (Falabella) y las fechas "05-SEP-2026".
6. **IA de estructura:** dejarla apagada (`LECTOR_ESTRUCTURA_IA` sin setear) en el primer despliegue.
   - Aporte real pero chico: 3 casos en 117.
   - Timeouts de 20 s en 8–20% de las llamadas según la hora.
   - Ya no puede empeorar un sello (solo entra sin prueba), así que prenderla después es de bajo riesgo.

### Cómo reproducir la vuelta 2
```
cd <worktree nuevo>
npx tsx scripts/comparar-lector-deepseek.ts
npx tsx <scratch>/adversarial-1/medir.ts [--sin-ia]          # mis 51 (necesita <scratch>/lector-actual = origin/dev)
npx tsx <scratch>/adversarial-1/medir.ts --v2 [--sin-ia]     # 16 casos dirigidos (casos2.ts)
npx tsx <scratch>/adversarial-1/reales.ts                    # reales, sin red
```
