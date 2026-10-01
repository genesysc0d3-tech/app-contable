# Sellos falsos: batería de daños económicos — 2026-09-30

Objetivo del fundador: **cero "sellos que mienten"** (la cartola sale comprobada/sellada pero está mal leída). Las
falsas alarmas no importan: si el lector duda, se le abre al cliente el popup de acomodar columnas.

Todo local (notebook para tests cortos; lo pesado en la Mac mini), **sin IA** (0 llamadas: 0 a Fireworks
redirigidas, 0 bloqueadas), cero Vercel, cero producción. Resultados crudos en el scratchpad
(`sobrevivencia/mini/`: `antes-final/`, `d4/`, `corpus-antes/`, `corpus-despues/`, `unicidad-antes/`, `cadenas.md`).

## Resumen (≤20 líneas)

- **Sellos que mienten en el corpus completo (4.202, sin IA): 7 → 0** (0,2% → 0,0%; IC95 0,0–0,1).
- **Supervivencia de sellos falsos bajo 25 daños económicos: 29,6% → 0,0%** (6.906/23.359 → 0/22.903; IC95 0,0–0,02).
- Lo que más mentía: ±$1 (84,5%), AutoFiltro (99,5%), fila oculta de $1 (86,8%), cargo↔abono cruzado (51–64%),
  sello "cliente" de la plantilla (49,8% de sus daños), subtotales (18%), otra hoja y celda combinada (17%).
- Exactas **iguales** (3.342/4.202). Comprobadas solas 570 → 559 (−11). "No preguntan" 692 → 673: **19 cartolas
  pasan a pedir popup** (7 eran las que mentían; 12 estaban bien leídas y bajan por duda — el precio aceptado).
- Unicidad: de 562 sellos saldo/total_banco del lector de antes, **1** tenía segunda solución (0,2%). Costo p50 17 ms.
- Cadena: con "cualquier raíz" una cartola A confirmada con cierre malo deja **52,8%** de las B selladas mintiendo;
  con **lineage objetivo 0%**, pero esa regla estricta no agrega cobertura (2ª-3ª: 7,7% → 7,7%; P1 daría 67%).
- Cartolas reales locales (santander.xlsx, Cartola N°02): **idénticas** en filas, montos y sello.
- 8 grupos de arreglos, cada uno con test que primero falló (`src/lib/parsers/sellos-falsos.test.ts`, 22 tests).

## 1. Cómo se probó

`scripts/corpus-cartolas/danos.ts` toca el ARCHIVO ya rendido (no el formato): cada una de las 666-684 cartolas
del generador que hoy sale sellada y exacta recibe hasta 2 daños por tipo (semilla por `id|daño|j`), ~34 por
cartola. Cada daño trae la **verdad mutada** y un **oráculo**:

- `lectura`: el sello solo vale si la lectura = verdad mutada **y** ningún testigo del banco (saldo corrido,
  total/saldo final impreso, total por valor, =SUM sin recalcular) quedó contradiciendo el daño.
- `sin_sello`: el archivo quedó ambiguo o contradictorio por construcción (fila oculta con plata, filtro, otra
  hoja, títulos cruzados contra el saldo, monto desplazado por celda combinada): cualquier sello es falso.

Las =SUM se recalculan como Excel al guardar, salvo en los daños "solo <v>", "solo <f>" y "monto sin recalcular".
`sobrevivencia.ts` mide, minimiza (misma semilla con menos movimientos: casi todos se reproducen con 3) y agrupa.
fast-check no está en node_modules: generador propio con semilla (no se instaló nada).

Nota honesta: el oráculo se corrigió 3 veces mientras se medía (filas ocultas mal ubicadas por un `!rows` ralo;
"cruzar datos" en columnas sin títulos de dirección no cambia la verdad; "saldo disponible" no es testigo; borrar
el último movimiento solo lo ve un saldo final). El ANTES de abajo es el lector de antes medido con el oráculo
FINAL (la primera medición, con el oráculo viejo, daba 30,0%: 7.009/23.367).

## 2. Antes vs después por daño (tasa de sello falso, IC95 Wilson)

| Daño | Oráculo | ANTES | DESPUÉS |
|---|---|---|---|
| borrar_mov | lectura | 2.7% (36/1354; 1.9–3.7) | 0.0% (0/1332; 0.0–0.3) |
| duplicar_mov | lectura | 7.2% (98/1354; 6.0–8.7) | 0.0% (0/1332; 0.0–0.3) |
| cambiar_digito | lectura | 4.4% (60/1354; 3.5–5.7) | 0.0% (0/1332; 0.0–0.3) |
| mas_un_peso | lectura | 84.5% (1144/1354; 82.5–86.3) | 0.0% (0/1332; 0.0–0.3) |
| menos_un_peso | lectura | 84.5% (1144/1354; 82.5–86.3) | 0.0% (0/1332; 0.0–0.3) |
| invertir_direccion | lectura | 0.2% (2/1018; 0.1–0.7) | 0.0% (0/1000; 0.0–0.4) |
| cruzar_datos_cargo_abono | lectura | 51.1% (462/904; 47.8–54.4) | 0.0% (0/886; 0.0–0.4) |
| cruzar_titulos_cargo_abono | sin_sello | 63.8% (554/868; 60.6–67.0) | 0.0% (0/850; 0.0–0.4) |
| oculta_un_peso | sin_sello | 86.8% (1016/1170; 84.8–88.7) | 0.0% (0/1148; 0.0–0.3) |
| oculta_grande | sin_sello | 17.9% (210/1170; 15.9–20.3) | 0.0% (0/1148; 0.0–0.3) |
| oculta_par_que_cuadra (±X oculto, saldo coherente) | sin_sello | 22.3% (138/618; 19.2–25.8) | 0.0% (0/614; 0.0–0.6) |
| autofiltro | sin_sello | 99.5% (1164/1170; 98.9–99.8) | 0.0% (0/1148; 0.0–0.3) |
| primera_fila | lectura | 4.3% (58/1354; 3.3–5.5) | 0.0% (0/1332; 0.0–0.3) |
| subtotal_con_glosa | lectura | 18.5% (183/989; 16.2–21.0) | 0.0% (0/977; 0.0–0.4) |
| subtotal_mudo | lectura | 18.1% (177/979; 15.8–20.6) | 0.0% (0/967; 0.0–0.4) |
| rango_sum_corto | lectura | 0.0% (0/178; 0.0–2.1) | 0.0% (0/164; 0.0–2.3) |
| rango_sum_corrido | lectura | 0.0% (0/178; 0.0–2.1) | 0.0% (0/164; 0.0–2.3) |
| solo_v_cacheado | lectura | 0.0% (0/178; 0.0–2.1) | 0.0% (0/164; 0.0–2.3) |
| solo_f | lectura | 0.0% (0/178; 0.0–2.1) | 0.0% (0/164; 0.0–2.3) |
| monto_sin_recalcular | lectura | 7.9% (14/178; 4.7–12.8) | 0.0% (0/164; 0.0–2.3) |
| segunda_hoja | sin_sello | 17.0% (216/1268; 15.1–19.2) | 0.0% (0/1246; 0.0–0.3) |
| fuera_de_rango (movimiento bajo el total) | sin_sello | 3.2% (20/618; 2.1–4.9) | 0.0% (0/600; 0.0–0.6) |
| plata_como_texto | lectura | 0.0% (0/1008; 0.0–0.4) | 0.0% (0/986; 0.0–0.4) |
| combinada_desplaza | sin_sello | 17.2% (210/1221; 15.2–19.4) | 0.0% (0/1199; 0.0–0.3) |
| fecha_corrida | lectura | 0.0% (0/1344; 0.0–0.3) | 0.0% (0/1322; 0.0–0.3) |
| **Total** | | **29.6% (6906/23359; 29.0–30.2)** | **0.0% (0/22903; 0.0–0.02)** |

Por sello de la cartola antes del daño: saldo 29,3% → 0,0% (0/12.580); total_banco 21,3% → 0,0% (0/7.113);
cliente (plantilla massDTE) 49,8% → 0,0% (0/3.210).

## 3. Corpus completo (4.202, sin IA) antes vs después

| Resultado (lector nuevo) | ANTES | DESPUÉS |
|---|---|---|
| **SELLO QUE MIENTE** | 0.2% (7/4202; IC95 0.1–0.3) | **0.0% (0/4202; IC95 0.0–0.1)** |
| Exacta | 79.5% (3342/4202; 78.3–80.7) | 79.5% (3342/4202; 78.3–80.7) |
| Comprobada sola (saldo/total_banco y exacta) | 13.6% (570/4202; 12.6–14.6) | 13.3% (559/4202; 12.3–14.4) |
| Exacta con sello cliente (plantilla) | 2.7% (115/4202) | 2.7% (114/4202) |
| No preguntan (cualquier sello) | 16.5% (692/4202; 15.4–17.6) | 16.0% (673/4202; 14.9–17.2) |
| Piden popup / confirmar | 3.510 | 3.529 (**+19**) |
| Mal leída CON aviso | 2.9% (123/4202) | 3.4% (144/4202) |
| Mal leída, pide confirmar sin alerta | 4.6% (194/4202) | 4.3% (180/4202) |
| Capa 4 | 9.0% (377/4202) | 9.0% (377/4202) |

Las 7 que mentían (plantilla massDTE con "Total del día" / resumen leído como ventas) ahora piden mirar con
alerta. Las 12 bien leídas que bajan: 11 comprobadas del generador (4 por "la =SUM calza pero es de las mismas
celdas", 3 porque el <v> cacheado del generador no es el de Excel —suma también los montos en texto; en un archivo
real el <v> lo calcula Excel—, 3 por "posible subtotal" y 1 por unicidad) y 1 plantilla con sello cliente.
Cota "cartola anterior" casi igual (910 → 911 más sellables).

Cartolas reales locales, solo determinístico: santander.xlsx 238 filas, entradas $69.807.341, firma 39b90d47dd6f,
sin_comprobar (igual antes y después); Cartola N°02 675 filas, entradas $50.206.203 / salidas $51.715.000, firma
7156543dafc0, **sello saldo** (igual antes y después; la unicidad no la baja).

## 4. Los arreglos (cada uno con test que primero falló)

1. **Tolerancia del sello exacta** (`saldo-cuadre.ts toleranciaDelSello`): con montos enteros el cuadre es al peso
   ($0); el ±$1 queda solo si alguna celda de plata trae centavos. Aplica al saldo corrido y a los totales.
2. **Filas/columnas ocultas con plata** (`orchestrator.ts ocultasConPlata`, libro leído con `cellStyles`): se
   **leen igual** (están en el archivo) pero la cartola **no se sella**, con alerta que nombra las filas y
   `censo.filas_ocultas`. Decisión: ni fuera ni dentro en silencio; baja el sello y se muestran.
3. **Títulos que contradicen el mapa** (cargo↔abono, también "Credit/Debit") nunca sellan, aunque el saldo cierre;
   se miran también las filas sobre una "SALDO INICIAL".
4. **=SUM recalculada** (`formulasSuma`: `recalculado`, `editada`): si el <v> cacheado no es la suma de sus celdas
   (reglas de Excel: solo números), el archivo fue editado → no es testigo y se avisa (alerta).
5. **Un solo rol por celda** (sin ciclos): la =SUM es función de las mismas celdas leídas → **ya no sella** (solo
   contradice). Una fila leída como movimiento que dice "Total…" o cuyo monto es la suma de ≥2 del mismo día
   (`posiblesSubtotales`) no deja sellar total_banco ni la plantilla; movimientos a los dos lados de una fila de
   totales tampoco. La plantilla massDTE ya no tapa las alertas (otra hoja, plata sin leer, ocultas).
   Esto eliminó los 7 sellos falsos de la plantilla con subtotal_por_dia (verificado: 7 → 0).
6. **Subtotal por estructura** exige sumar ≥2 movimientos: una fila **duplicada** ya no se bota callada.
7. **Unicidad** (`unicidad.ts`): antes de sellar se buscan otras asignaciones cargo/abono/monto/saldo, otra fila de
   inicio (±2) y otra columna de fecha que cambie el MES; si alguna también pasa el juez con otra lectura → sin sello.
8. **Censo** con la fecha que la columna fecha sabe leer (dd/mm/aa) y un monto que cayó en la columna fecha
   (serial de 2039) va al censo; el **resumen de otra hoja** del libro contradice (nunca sella).

## 5. Cadena entre cartolas (solo simulación, NO implementada en el lector)

Formatos con saldo, 195 cadenas de 3 meses. P1 = encadena con cualquier cartola anterior aceptada (incluida la que
confirmó el cliente); P2 = lineage objetivo (la raíz tiene que ser saldo/total_banco). Veneno: A confirmada por el
cliente con cierre +δ y B con su primera fila −δ (el peor caso, el error de B compensa el de A).

| Escenario | 2ª cartola sellada y exacta P1 / P2 | Sello que miente en la 2ª P1 / P2 |
|---|---|---|
| limpio | 68.2% / 7.7% | 0 / 0 |
| veneno | 7.7% / 7.7% | **52.8% (103/195)** / **0% (0/195)** |

El veneno no pasa a la 3ª porque B cierra con el saldo del banco. Conclusión: si algún día se encadena, que sea
con lineage objetivo; pero así de estricta la continuidad **no cubre nada nuevo** (7,7% → 7,7%): la cartola que
necesita la anterior es justo la que no tiene raíz objetiva. Lo que cubre de verdad es P1, y P1 miente con veneno.

## 6. Límites que quedan (decididos, no escondidos)

- Cola truncada (falta el último movimiento) sin saldo final impreso: nada en el archivo la contradice.
- "Saldo disponible" no se usa como saldo final (en Chile incluye retenciones o línea de crédito).
- Con centavos se mantiene el ±$1: un +$1 en una cartola con decimales seguiría pasando.
- Fechas: el saldo no las prueba; la unicidad solo mira otra columna de fecha si cambia el mes.
- Hoja principal oculta con la visible de resumen: no probado.
- Gates: vitest del notebook en los archivos tocados y los 12 que fallaron en la mini (fallan allá solo por no
  copiar supabase/, extensions/ ni next.config: en el notebook pasan); suite de parsers+cartola 35/35; lint
  limpio; tsc sin errores nuevos (los de `.next/types` y `headers.test` son del entorno).

Reproducir: `npx tsx scripts/corpus-cartolas/sobrevivencia.ts --etiqueta=X --parte=k/8` (y `--juntar`,
`--unicidad` con `LECTOR_RAIZ=<lector>`, `--cadenas`).
