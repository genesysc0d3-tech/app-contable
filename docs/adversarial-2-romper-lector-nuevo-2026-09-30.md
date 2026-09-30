# Adversarial #2 — romper el lector de cartolas nuevo (2026-09-30)

Rama `feat/lector-cartolas-con-juez` (HEAD `f719103`) contra `origin/dev`. Leí todo el diff (49 archivos).

**Base de cada hallazgo:**
- **[V]** = verificado: lo reproduje con un test que corre contra el worktree.
- **[V-dev]** = además corrí lo mismo contra `origin/dev` (copia con `git archive` en el scratchpad) para saber si es regresión.
- **[L]** = lo saqué leyendo el código, sin reproducirlo.
- **[NV]** = no verificado (depende de datos de prod, que no toqué).

Los tests de reproducción quedaron en `/private/tmp/claude-501/-Users-take-Desktop-app-contable/18f684e5-5d3f-4842-a134-c9642d024ad0/scratchpad/adversarial-2/tests/` (`sellos`, `formulas`, `montos`, `perdidas`, `privacidad`, `perf`, `reales`). Para correrlos, cópialos a `src/lib/parsers/__adv2__/` y ejecuta `npx vitest run src/lib/parsers/__adv2__`. En el worktree no quedó ningún archivo mío aparte de este doc.

**Red e IA:** 0 llamadas de red, a OpenCode y a Fireworks. No hizo falta la IA: todo se reprodujo con lectores determinísticos y `fetch` sin usar. Las cartolas reales (santander.xlsx y Cartola N°02) solo pasaron por el orquestador con el store mockeado y `LECTOR_ESTRUCTURA_IA` apagado.

**Suite:**
- `npx vitest run`: **181 archivos, 2140 tests OK, 5 skipped, exit 0**.
- `npx tsc --noEmit`: **1 error**, en `.next/types/app/(auth)/invitar/[token]/page.ts`. Es un tipo generado y viejo que está fuera del diff; con `src/` limpio, la rama no mete errores de tipos.
- Emisión: el diff **no toca** `src/lib/emission`, `extensions/`, `api/sii-local` ni `emision_jobs`. En `revisar/actions.ts` solo se agrega una llamada best-effort (dentro de try/catch) después de aprobar.
- Cartolas reales: santander (238 E) y N°02 (636 E / 39 S) dan **idénticos** a dev, con sello `saldo`. **[V-dev]**

---

## CRÍTICO

### C1. El sello `saldo` miente: la tolerancia es 1 % del SALDO y deja pasar hasta 20 % de filas malas; certifica cargo↔abono invertidos
- `src/lib/parsers/juez-banco.ts:312` usa `formatoVerificadoPorSaldo` (`validator.ts:214-230`): `revisadas >= 10 && fallidas/revisadas <= 0.2`.
- A su vez, `cuadreSaldo` (`saldo-cuadre.ts:37-38`) tolera `max(100, 1% × saldo esperado)`.
- Ese criterio se hizo para **orientar** el mapa y para decidir si un formato se comparte. Ahora se usa como **certificado** ("El saldo corrido cuadra fila a fila").

**Reproducción [V]** (`sellos.test.ts`):
- **ADV2-1:** cuenta con saldo de $50 M y 20 movimientos de $20–49 mil, con el mapa **invertido** (cargo=abonos). Resultado: sello `saldo`; se leen 5 entradas cuando en la cartola hay 15 abonos reales. Invertir cambia cada fila en 2 × monto, y eso cae dentro del 1 % de $50 M = $500 mil.
- **ADV2-1b** (orquestador completo, títulos neutros "Monto 1/Monto 2", abono a la izquierda):
  - La heurística elige el mapa invertido.
  - Sale sello `saldo`.
  - `saveAdapter` recibe `empresaId: null`, o sea que el mapa queda **GLOBAL y confirmado** para todas las empresas.
  - En dev pasa lo mismo con el mapa global **[V-dev]**. La diferencia es que dev no le ponía sello verde ni "confirmado".
- **ADV2-2:** 2 de 12 montos leídos ×1000 más chicos (celda texto "USD 105,000.00" → 105; ver M2) igual salen con sello `saldo`.

**Por qué importa:** una pyme con saldo alto y boletas chicas es justo el cliente típico. Sus ventas quedan como salidas, no se emite la boleta, y además `necesitaConfirmacion` devuelve false (sello con prueba), así que nadie le pide mirar. Y como el mapa queda global, **envenena a otros tenants** que tengan la misma huella de encabezado.

**Arreglo:**
- Separar "orientar" de "certificar". Para el sello: tolerancia **absoluta** (±$1, o ±max(1, 0,5 % del monto de la fila), nunca un % del saldo) y **0 filas fallidas**, o ≤1 si se explica en el detalle.
- Exigir además que la orientación elegida le gane **estrictamente** a la invertida (misma medición con cargo/abono cruzados). Si empatan, no hay sello.
- Compartir globalmente solo con este sello estricto.

### C2. Una fila real con fecha se bota como "resumen legítimo" si tiene "TOTAL"/"SALDO DISPONIBLE" en otra columna o en la glosa, y la cartola igual sale sellada
- `apply.ts:370-381` y `:408`: `palabraFueraDeGlosa` (RESUMEN_RE en **cualquier** celda de texto que no sea la glosa) o `saldoEnGlosa` marcan la fila como resumen **aunque tenga fecha**, y la línea 408 la descarta con `legitimo: true`.
- En dev, una fila con fecha nunca se botaba por la palabra: el resumen solo etiquetaba los descartes.

**Reproducción [V] [V-dev]** (`sellos.test.ts` ADV2-3):
- **Columna "Destinatario" = "TOTAL CHILE SPA":** la fila 7 sale como `resumen`, `legitimo: true` (13 leídas contra 14 en dev). En este caso el sello terminó en sin_comprobar, pero solo por casualidad: la misma celda "TOTAL…" se tomó como fila de totales del banco y "contradijo".
- **Glosa "TRASPASO SALDO DISPONIBLE LINEA CREDITO":** la fila se bota, **sello `saldo`** (13 contra 14 en dev). Se pierde un abono en silencio (legítimo = no aparece como "Faltan").

**Arreglo:**
- Con fecha válida, una fila solo es resumen por **estructura**: fórmula SUMA del banco, o su monto es la suma de lo leído, o está dentro del bloque de resumen **sin** fecha.
- Nunca por una palabra en otra columna. Ojo con razones sociales ("TOTAL CHILE", "DISTRIBUIDORA TOTAL").
- Si se mantiene la palabra, el descarte tiene que ser `legitimo: false` para que el cuadre lo muestre.

### C3. Una sola celda con otro formato manda la cartola ENTERA a capa 4 (hoja completa en claro a la IA)
- `numeros.ts:92-106` junto con `LectorMontos.formatoDe` (`:132`): si una columna mezcla una sola celda solo-inglesa con celdas solo-chilenas, **toda** la columna queda `ambiguo`, y cada fila se va a `monto_ambiguo`.
- La región considerada va de `desde` hasta el **final de la hoja**, así que también entran los pies de página.
- Con 0 líneas el validador falla en todas las capas y la cartola cae a capa 4 (TSV de la hoja completa al procesador IA).

**Reproducción [V] [V-dev]** (`privacidad.test.ts` P4/P5):

| Caso | Nuevo | Dev |
|---|---|---|
| 15 abonos "1xx.000" + uno "107,000" | capa 4, 0 leídas | capa 3, 15 leídas (una mal, 107) |
| Pie "Tasa de interés mensual \| 1.50" en la columna de abonos | capa 4 | capa 3, 15 leídas |

**Por qué importa:**
- Es una regresión de determinismo (va contra el flujo "determinístico → IA solo si no está seguro").
- Es un riesgo de privacidad: nombres, RUT y glosas completas salen a la IA. Según `ocr-sin-opencode.test.ts:3`, prod corre con `AI_PROVIDER=fireworks` **[NV en prod]**.

**Arreglo:**
- Decidir el formato solo con las filas que **tienen fecha** (región de movimientos), no con pies ni bloques de resumen.
- Por mayoría con umbral: si ≥90 % de las celdas es de un formato, solo las minoritarias quedan `monto_ambiguo`, no la columna entera.
- Un ambiguo nunca debería vaciar la lectura y empujarla a capa 4.

---

## ALTO

### A1. El sello ignora las filas perdidas no legítimas (fecha imposible, cargo_y_abono, sin_fecha, tipo_desconocido)
- `juez-banco.ts:307-311` solo bloquea el sello por `sin_leer` y `monto_ambiguo`.
- **[V]** (`perdidas.test.ts`): una fila con "31/09/2026" y otra con cargo y abono a la vez salen como descartes `legitimo:false`, y aun así el **sello es `saldo`**.
- **[V]** (`perf.test.ts`): 2000 de 4990 filas sin fecha también dan **sello `saldo`**.
- El cuadre muestra "Faltan N", pero el mapa igual nace **confirmado y global** (`orchestrator.ts` → `guardarFormatoDerivado`).

**Arreglo:** cualquier descarte `legitimo:false` con plata debe dejar `sin_comprobar` con `alerta`, y el mapa no se confirma ni se comparte.

### A2. "Se ve bien" sella `cliente` aunque el banco CONTRADIGA la lectura
- `LecturaMuestra.tsx:113` muestra el botón también cuando hay `alerta` (plata sin leer, monto ambiguo, totales del banco que no calzan, disputa de dos opiniones).
- `lectura-actions.ts:70-72` no revisa el sello anterior: sobrescribe con `tipo:"cliente"` (se borra `alerta`) y confirma el mapa propio.
- Con 3 filas de muestra no se puede juzgar "faltan 12 filas" ni "el total del banco no calza".
- **[L]**

**Arreglo:** con `alerta`, no ofrecer "Se ve bien". El server debe rechazar `se_ve_bien` si `cuadre.verificacion.alerta`; ahí solo vale "Corregir columnas" o el saldo final.

### A3. El error del saldo le dicta la respuesta al cliente
- `lectura-actions.ts:94-97` responde "tu saldo final debería ser $X". Cuando no hay saldo inicial conocido, el cliente también tipea el inicial (`:88`).
- Resultado: copia el número que le mostramos y queda sellado `cliente`, y el mapa confirmado. Es un sello de goma.
- **[L]**

**Arreglo:** no revelar el esperado; basta con "no cuadra, diferencia $D", o mejor aún ni eso. Y no aceptar el saldo inicial y el final tipeados los dos a la vez como prueba (el cliente puede cuadrarlos con cualquier par).

### A4. "Aprobar cartola" sin mirar confirma el mapa provisorio
- `revisar/actions.ts:879-884` llama a `confirmarMapaPorCheck`.
- `aprobarCartola` aprueba en bloque todas las `listo` (`:854-873`), y `checkConfirmaMapa` (`verificacion.ts:85-98`) exige solo ≥3 decididas, ≥1 aprobada y sumas sin editar.
- Si el mapa estaba invertido o botó filas (C2/A1), aprobar en bloque lo **confirma**. Desde ahí, `necesitaConfirmacion` (`verificacion.ts:30-31`) deja de pedir revisión para ese formato.
- Es solo el mapa propio (no cruza tenants, OK), pero apaga la alarma para siempre.
- **[L]**

**Arreglo:** que Check confirme solo si el sello era `sin_comprobar` **sin** alerta y **sin** descartes no legítimos; si no, que quede provisorio. Idealmente, contar como prueba solo la aprobación fila a fila, no el bloque.

### A5. Privacidad del paso IA: la "fila de títulos" puede ser un movimiento o metadata, y viaja en claro
- `estructura-ia.ts:78-88`: `filaTitulos = findTransactionBlockStart - 1`, y esa fila va con `titulo()` = texto real (28 caracteres por celda).
- **[V]** (`privacidad.test.ts`):
  - **P1:** sin fila de títulos y con metadata encima, sale `Titular: JUAN PEREZ SOTO | RUT 12.345.678-9 | Cta 00-123-45678-09` **en claro**.
  - **P2:** un 2° movimiento sin fecha (continuación de glosa) hace que el bloque parta más abajo, y sale `Transf de JUAN PEREZ 12.345. | 20.000 | 1.035.000` en claro.
- El flag está apagado por defecto de verdad (`estructuraIaActiva` solo con `"1"`) **[V]**, así que hoy no filtra.

**Arreglo:** mandar como texto solo las celdas de esa fila que calcen el vocabulario de encabezados (`encabezados.ts`); todo lo demás, enmascarado con `formaDeCelda`. Nunca una fila que tenga dígitos de RUT o de cuenta.

---

## MEDIO

### M1. Fórmula SUM de un rango parcial o vacío "prueba" la columna entera
- `juez-banco.ts:250-255`. **[V]** (`formulas.test.ts`):
  - `=SUM(C2:C4)` y `=SUM(D2:D3)` (solo las primeras filas) dan sello `total_banco` para las 12.
  - `=SUM` sobre un rango vacío con valor 0 da `total_banco` (`sellos.test.ts` ADV2-4).
- Los offsets de `!ref` y de las filas en blanco sí están bien **[V]**.

**Arreglo:** la unión de los rangos SUM de una columna tiene que cubrir todas las `excel_row` leídas de esa columna, y además ser distinta de 0.

### M2. Lectura laxa silenciosa en celdas de texto sucias
- `numeros.ts:150` y `:169` (`split(",")[0]`). **[V]** (`montos.test.ts`):

| Celda | Se lee |
|---|---|
| "USD 1,500.00" | 1 |
| "1,500 CR" | 1 |
| "1,5E+06" | 1 |
| "1.5E+06" | 1506 |

- Ninguna va al censo como dudosa. Es herencia de dev, pero ahora alimenta un sello (C1/ADV2-2).

**Arreglo:** si `leerCeldaMonto` da null y la celda tiene dígitos, marcarla `monto_ambiguo` en vez de usar la lectura laxa. Como mínimo, quitar prefijos o sufijos de letras antes de leer y rechazar la notación científica.

### M3. Los mapas globales viejos quedan muertos para siempre (el "se re-confirman solos" es falso)
- `adapter-store.ts:100` exige `estado === "confirmado"` para usar un global. Pasa antes de la migración (sin columna, todo provisorio) y después (el backfill deja provisorios todos los globales heurísticos/nombres).
- Un global nunca vuelve a llegar al camino de cache, así que nunca pasa por `incrementAdapterSuccess` y **nunca se re-confirma**.
- El comentario de la migración (`20260930140000_parser_adapters_estado.sql:41`) dice lo contrario.
- Efecto: cada empresa sin mapa propio re-deriva con la heurística; no es peor en general, pero sí más lento y crea N filas por huella. Si algún global venía de un caso que la heurística actual no re-deriva igual, esa clienta queda peor **[NV: requiere mirar los 77 de prod]**.

**Arreglo:**
- Corregir el comentario.
- Opcional: un backfill que re-confirme por `success_count>=N` con `confirmado_por='legacy'` (ojo: habría que agregar ese valor al CHECK), o simplemente dejarlos y documentarlo.
- Además, `adapter-store.ts:30` cita la migración `20260930120000`, pero el archivo es `…140000`.

### M4. Con el flag prendido, la IA se llama en CADA formato nuevo y por hoja, incluso cuando el lector ya tiene prueba
- `orchestrator.ts:240`: `mapaPorIA` corre aunque la lectura heurística tenga sello `saldo`/`total_banco`, y dentro del `for` de hojas (hasta 20 s por hoja).
- Es costo, latencia y exposición de datos innecesaria.
- **[L]**

**Arreglo:** llamar solo si el lector no tiene prueba, y una sola vez por libro.

### M5. Saldo inicial mal calculado si la cartola viene de lo más nuevo a lo más viejo y todas las fechas son iguales
- `juez-banco.ts:163` decide el orden comparando solo la fecha de la primera y la última fila.
- En una cartola de un día en orden descendente toma la fila equivocada como "primera". El cliente con el saldo correcto recibe "No cuadra" (y el dato de A3).
- **[L]**

**Arreglo:** decidir el orden con la ecuación del saldo (igual que `cuadreSaldo` prueba los dos órdenes).

---

## BAJO

- **B1.** `detectarResumenImpreso` toma la **primera** etiqueta "Saldo final" de la hoja, aunque sea de otra cuenta o sección (`sellos.test.ts` ADV2-5: `{saldoFinal: 999}`) **[V]**. Hoy eso termina en `contradice` (seguro), pero puede tapar la prueba real.
- **B2.** `detectarCuenta` (`juez-banco.ts:141-155`) toma el primer grupo de ≥6 dígitos de una celda con "cuenta/cta". Si antes aparece el RUT del titular, todas las cuentas de la empresa comparten huella y el encadenamiento de saldos mezcla cuentas **[L]**.
- **B3.** Redondeo inconsistente: un número tipado 1234.5 da 1235 (`Math.round`), pero el texto "1.234,56" da 1234 (trunca) **[V]**. Irrelevante en CLP, relevante si algún día entra USD.
- **B4.** `recordCuentaAudit` de la confirmación usa `recursoTipo: "documento"`; el resto usa `"documento_subido"` (`lectura-actions.ts:132`).
- **B5.** `.next/types` con un error de tipos viejo: conviene borrar `.next` antes de correr `tsc` en CI.

## Lo que ataqué y aguantó

- **Montos por columna** [V]:
  - "1,500" sola → generic 1500.
  - "1.500" → 1500.
  - "1,5" → 1.
  - "418.370-", "(1.500)", "$-1.500", "−1.500" y "- 1.500" → negativos bien.
  - "1.500,00 $" y "CLP 1.500" bien.
  - Una columna que mezcla "1,500" con "1.500" queda ambigua: no inventa, aunque ver C3 por el daño colateral.
- **Offsets de fórmulas** con `!ref` corrido y filas en blanco: bien [V].
- **Cross-tenant de confirmaciones:** `adapterDelDocumento` y `confirmarLecturaCartola` solo tocan el mapa **propio**; un cliente no puede volver global un mapa [L]. RLS de `parser_adapters`: 0 policies, solo service role [L].
- **Migración:**
  - Idempotente (`if not exists`, drop y add de constraints).
  - `add column not null default` es seguro.
  - El backfill solo baja la confianza y cambia el estado: **no borra** ninguno de los 77.
  - El DOWN restaura el esquema, pero no la `confianza` rebajada (lo dice el propio archivo): respaldar `parser_adapters` antes [L].
- **Fail-safe sin migración:**
  - Las escrituras reintentan sin las columnas nuevas.
  - `confirmarAdapter` falla en silencio.
  - Aprobar nunca se rompe (try/catch) [L].
- **Server action `confirmarLecturaCartola`:** auth, rol `ROLES_EMISION`, `vetado`, `validarAccesoCuenta`, documento filtrado por `empresa_id`, soporte bloqueado. React escapa glosas (sin inyección). El tema claro/oscuro usa variables definidas en `V5Root.tsx` para los dos temas [L].
- **Timeout IA:** `AbortController` de 20 s cubre `fetch` y `res.text()`, y el timer se limpia en `finally` [L]. URL fija de OpenCode Go; ningún camino nuevo de la rama llama a Fireworks (el riesgo Fireworks es la capa 4 heredada, ver C3).
- **Performance** [V] (`perf.test.ts`):

| Cartola | Tiempo orquestador completo |
|---|---|
| 5.000 filas × 5 columnas | 137 ms |
| 5.000 filas × 15 columnas | 257 ms |
| 500 filas × 15 columnas | 55 ms |

  `mejorTernaPorSaldo` con 13 columnas de plata tarda 2 ms, porque la muestra está capada en 30 filas (`heuristic.ts:41`): no explota combinatoriamente.

## Orden sugerido de arreglos antes de prod

1. **C1:** sello estricto separado de "orientar".
2. **C2:** no botar filas con fecha por una palabra.
3. **C3:** formato solo con filas con fecha y por mayoría; nunca vaciar la columna.
4. **A1:** descartes no legítimos → sin sello.
5. **A2–A4:** sin "Se ve bien" con alerta, sin revelar el esperado, Check no confirma con alerta.
6. **A5** antes de prender `LECTOR_ESTRUCTURA_IA`.

---

# Vuelta 2 (sobre `cf718e9`: commits 92e0398, 9f6f6e9, cf718e9)

Re-corrí todas mis reproducciones de la vuelta 1 y ataqué lo nuevo. Los tests nuevos están en `scratchpad/adversarial-2/tests-v2/` (`vuelta2.test.ts`, `diag-santander.test.ts` y las repros de la vuelta 1 con el mock ajustado). En el worktree no quedó nada mío aparte de este doc.

**Red e IA:** 0 llamadas de red (nada a OpenCode ni a Fireworks). Las cartolas reales solo pasaron por lectores determinísticos.

**Suite:**
- `npx vitest run`: **187 archivos, 2188 tests OK, 5 skipped, exit 0**.
- `npx tsc --noEmit`: solo el mismo error viejo de `.next/types` (fuera del diff); `src/` limpio.

## ¿Cerrados de verdad o tapados?

| # | Veredicto | Evidencia |
|---|---|---|
| C1 sello blando | **CERRADO** [V] | Mapa invertido con saldo $50 M: `sin_comprobar` y alerta "19 de 19 no cuadran". Por el orquestador (ADV2-1b) elige la orientación CORRECTA (15/15 entradas) y el mapa queda de la empresa, no global. ADV2-2 (montos texto sucios) → `monto_ambiguo` + alerta. |
| C1 en datos REALES | **CERRADO, y confirma que el sello viejo mentía** [V] | `santander.xlsx` (238 abonos, flag "A" en todas; es un export **filtrado solo abonos**) tenía sello `saldo` en la vuelta 1 con 32/237 filas sin cuadrar (13 % < 20 %). Ahora: `sin_comprobar`, "32 de 237 filas no cuadran (¿cartola filtrada?)". Es verdad: cada diferencia es un cargo que no está en el archivo. La Cartola N°02 sigue `saldo` (cierra al peso). |
| C2 palabra en otra columna | **CERRADO** [V] | "TOTAL CHILE SPA" y "TRASPASO SALDO DISPONIBLE" leídas (14/14) con sello `saldo`. |
| C3 una celda → capa 4 | **CERRADO** [V] | "107,000" → capa 3, 14 leídas + 1 `monto_ambiguo` con alerta. Pie "Tasa 1.50" → capa 3, 15 leídas (ver N6). |
| A1 pérdidas no bloquean sello | **CERRADO** [V] | Fecha imposible + cargo y abono → `sin_comprobar` alerta con el detalle por motivo. Las filas arriba del bloque (skip de más) → `sin_leer` (V2-6). |
| A2 "Se ve bien" con alerta | **CERRADO** [L] | `seVeBienPermitido` en la UI **y** en el server (`lectura-actions.ts:71-74`), con el cuadre leído de la DB; también bloquea con pérdidas u otras hojas. |
| A3 revelar el esperado | **CERRADO** [L] | `mensajeSaldoNoCuadra()` sin montos. Queda: si la cartola no trae saldo inicial ni anterior, el cliente tipea inicial y final a la vez (se puede cuadrar a mano con los totales de la mesa); es menor. |
| A4 aprobar en bloque confirma | **TAPADO a medias** [L] | Ver N3. |
| A5 enmascarado de títulos | **CERRADO** [V] | P1 (titular/RUT/cuenta) y P2 (continuación) salen enmascarados. Una fila real de títulos sigue en claro (`esEncabezadoClaro`, diccionario sin dígitos). |
| M1 SUM parcial o vacía | **CERRADO** [V] | Parcial y vacía → `sin_comprobar`; con cobertura completa → `total_banco`. |
| M2 lectura laxa | **CERRADO** [V] | Texto sucio con dígitos → `monto_ambiguo`; "1,500 CR" = 1500 y "1.500 DB" = −1500. |
| M3 comentario de globales | **CERRADO** (documentado) | — |
| M4 IA siempre | **CERRADO** [L] | Solo sin prueba y ≤2 consultas por libro. |
| M5 orden de un solo día | **CERRADO** [L] | Decide por la ecuación. |

## Hallazgos NUEVOS de la vuelta 2

### N1 — CRÍTICO: el "consenso" de 2 empresas se fabrica SIN prueba y envenena a otros tenants en silencio
- **Dónde:** `adapter-store.ts` → `hayConsensoParaGlobal` cuenta **cualquier** `estado = confirmado`, incluido `cliente` ("Se ve bien") y `check`. `promoverMapaGlobalSiHayConsenso` se dispara desde `confirmarLecturaCartola` y `confirmarMapaPorCheck`.
- **Guardas que faltan:** no exige prueba estricta (saldo o total del banco), ni dueños o usuarios distintos, ni cuentas bancarias distintas (`cuenta.huella`).
- **Parte 1 [V] (V2-5):** dos empresas del mismo usuario (algo normal en multiempresa) con el mismo mapa **invertido**, confirmado una por `cliente` y otra por `check`, dan `hayConsensoParaGlobal = true`. Una cartola sin columna saldo (23 de 29 en prod) no tiene alerta, así que "Se ve bien" está permitido en las dos.
- **Parte 2 [V] (V2-7), la víctima:** otra empresa, sin mapa propio y con la misma huella de encabezado, recibe el global invertido.
  - Resultado: capa 0, **3 entradas de 9 ventas**, sello `sin_comprobar` **sin alerta**.
  - `mapa = {estado: confirmado, nuevo: false}`, así que `necesitaConfirmacion` da **false**: nunca se le pide mirar.
  - Los títulos de su hoja dicen "Cargos | Abonos" al revés del mapa y nadie lo nota.
- **Arreglo:**
  1. El consenso solo cuenta confirmaciones con prueba **estricta** (`saldo` o `total_banco`), de ≥2 empresas con **distinto dueño** (cuenta o usuario) y **distinta** `cuenta.huella`.
  2. Al aplicar un global, si los títulos de la hoja contradicen su dirección (`direccionPorTitulos` al revés) → alerta y no usarlo.
  3. Un global aplicado **sin prueba en esta lectura** debe pedir confirmación (`nuevo: true` para esa empresa).

### N2 — ALTO: "subtotal por estructura" bota ventas reales como resumen LEGÍTIMO (escondidas)
- **Dónde:** `apply.ts` → `esSubtotalPorEstructura`.
- **Con saldo, pero el banco imprime el saldo de CIERRE DEL DÍA en cada fila [V] (V2-1):** la 2ª venta igual a la 1ª del día cumple "saldo quieto + monto = suma del día" y se marca `resumen, legitimo:true, subtotal`.
  - Se botaron 3 de 9 ventas.
  - Sale alerta ("4 de 5 no cuadran"), pero esas filas **no aparecen como faltantes** en el cuadre: el cliente no las puede agregar.
- **Sin saldo [V] (V2-1b):** una transferencia de $25.000 con "TOTAL CHILE SPA" en otra columna, el mismo día que dos compras de $10.000 + $15.000, se bota como resumen legítimo.
  - Es el camino "palabra + estructura": la palabra vuelve a entrar como desempate.
  - Sin columna saldo no hay alerta, así que queda escondida.
- **Arreglo:**
  - Un subtotal detectado por estructura debe quedar `legitimo:false` (visible, "¿esto es un subtotal?"), salvo que además esté fuera de la glosa y sin comercio, o que el banco lo marque con fórmula.
  - Nunca contar "TOTAL" en columnas que no son la glosa. Exigir saldo quieto **y** que la fila siguiente mueva el saldo desde ahí.

### N3 — MEDIO: "fila a fila" se esquiva con bloque + 1
- **Dónde:** `aprobarPropuesta` llama a `confirmarMapaPorCheck`, y este solo mira el estado final de todas las propuestas.
- **Cómo:** "Aprobar cartola" en bloque (no confirma) y después aprobar a mano la única fila que quedó pendiente → confirma el mapa. Sumado a N1, también alimenta el consenso. [L]
- **Arreglo:** contar como mirada solo las filas aprobadas individualmente (auditoría o un flag en la propuesta), por ejemplo ≥ 80 % o todas, o no usar Check para confirmar.

### N4 — MEDIO: cartola filtrada "solo abonos" (caso típico massDTE) queda en alerta PERPETUA
- **Caso:** santander real, arriba.
- **Por qué no sale de la alerta:**
  - El sello estricto es honesto, pero `alerta:true` bloquea "Se ve bien" y la confirmación por Check.
  - El saldo final que teclee el cliente nunca cuadra, porque faltan los cargos.
  - "Corregir columnas" no lo arregla.
- **Efecto:** cada subida de este formato muestra "Algo no nos calzó" sin salida. Advertir sí, bloquear no, pero es ruido permanente.
- **Arreglo:** reconocer el patrón "una sola dirección + todos los saltos de saldo explicables por movimientos ausentes del otro signo" → `sin_comprobar` **sin** alerta, con el detalle "cartola filtrada: solo abonos". Así se permite "Se ve bien", pero no el sello.

### N5 — MEDIO: CSV en UTF-16 (Excel "Texto Unicode") sigue con el bug viejo
- **Dónde:** `libro.ts` → `esTextoPlano` ve bytes 0x00 y lo trata como binario.
- **[V] (V2-3):** el archivo se lee con `cellDates`/no-raw: "05/09/2026" pasa a **9 de mayo** y "1.500" a **1,5** (se redondea a 2).
- **Mismo resultado que dev:** no es regresión, pero el arreglo de CSV no lo cubre.
- **Arreglo:** detectar el BOM FF FE / FE FF (o un patrón de 0x00 alternados), decodificar a string y leerlo con `type: "string", raw: true`.

### N6 — BAJO
- Una línea de pie de página (sin fecha, solo texto) tras el último movimiento se **pega a su glosa** (V2-2 [V]: "Transf de cliente 12 Este documento no constituye comprobante…"). Esa glosa viaja al clasificador y puede terminar en la boleta. Arreglo: solo pegar si la fila siguiente vuelve a ser un movimiento, o limitar a la glosa de filas intermedias.
- El pie "Tasa 1.50" en la columna de plata cuenta como "1 fila con plata y sin fecha" y la cartola queda en alerta para siempre (misma familia que N4).
- `formatoFechaDeColumna`: un dedazo "06/13/2026" en una cartola de días 1–12 pasa la columna a mm/dd y termina en capa 4. Dev hace lo mismo [V-dev], así que no es regresión. Sugerencia: pedir ≥2 celdas mm/dd o ≥20 %.
- `saldoComoMonto`: un depósito de apertura con glosa "SALDO INICIAL …" en una cuenta vacía (monto = saldo) se esconde como resumen. Rarísimo.

## Veredicto vuelta 2: **NO está listo para producción todavía**

Lo que cerraron está bien cerrado: el sello estricto no lo pude hacer mentir, y la prueba en datos reales muestra que el sello viejo sí mentía en santander.

Bloquean:
- **N1** (CRÍTICO): envenenamiento cross-tenant silencioso vía consenso sin prueba. Es un cambio chico: contar solo `saldo`/`total_banco`, exigir dueños y cuentas distintas, y alertar si los títulos contradicen al global.
- **N2** (ALTO): ventas reales escondidas como "subtotal legítimo".

Con N1 y N2 arreglados, y N3/N4 al menos atenuados (N4 es ruido, no plata), mi veredicto pasaría a "listo con el flag de IA apagado". N5 y N6 pueden ir después. **La migración sigue sin aplicar:** respaldar `parser_adapters` antes.

---

# Vuelta 3 (sobre `4294cce`: commits 3d0ec86, c0ea305, 4294cce)

Re-corrí las reproducciones de las vueltas 1 y 2 y ataqué lo nuevo. Tests en `scratchpad/adversarial-2/tests-v3/` (`vuelta3.test.ts` + repros anteriores); en el worktree no quedó nada mío aparte de este doc.

**Red e IA:** 0 llamadas de red, a OpenCode y a Fireworks. Las cartolas reales solo pasaron por lectores determinísticos.

**Suite:**
- `npx vitest run`: **188 archivos, 2212 tests OK, 5 skipped, exit 0**.
- `npx tsc --noEmit`: solo el mismo error viejo de `.next/types` (fuera del diff); `src/` limpio.

## Verificación de la vuelta 2

| # | Veredicto | Evidencia |
|---|---|---|
| N1 consenso global | **CERRADO** [V] | Dos empresas del mismo dueño con "cliente"/"check" → consenso **false**. Víctima con un global invertido: los títulos de su hoja contradicen el mapa, así que se descarta y re-deriva **9/9 ventas**; y un global sin prueba ahora es `nuevo: true`, o sea que se le pide mirar. |
| N2 subtotal esconde ventas | **CERRADO** [V] | Con saldo del día repetido: 9/9 leídas, sin descartes (sale alerta de saldo, que es verdad). "TOTAL CHILE SPA" sin saldo: 3/3. |
| N3 bloque + 1 | **CERRADO** [L] | Exige auditoría `propuesta_aprobada` de CADA aprobada. Esa auditoría solo la escribe `aprobarPropuesta` (service role; RLS de `cuenta_audit_events` solo deja SELECT). Borde: una fila aprobada a mano, devuelta a Check y después aprobada en bloque conserva su auditoría vieja. Menor. |
| N4 filtrada perpetua | **CERRADO**, pero abre V3-1 (abajo) | santander real → `filtrada: "abonos"` y el botón queda disponible. |
| N5 UTF-16 | **CERRADO** [V] | "05/09/2026" y "1.500" llegan como texto. |
| N6 pie pegado a la glosa | **CERRADO** [V] | La última glosa queda limpia. El dedazo mm/dd sigue yéndose a capa 4, igual que en dev. |
| Vuelta 1 (C1–C3, A1–A5, M1, M2) | **siguen cerrados** [V] | La Cartola N°02 real ahora sella "todas las filas, desde el saldo inicial". |

## Ataques nuevos

### V3-1 — ALTO: "Mi cartola es solo cargos" sella una cartola con cargo↔abono INVERTIDOS
- **Dónde:** `juez-banco.ts` → `sellarCartola`. La rama `filtrada` no mira `q.invertidaCuadra`: si la lectura al revés cierra al 100 %, no es una cartola filtrada, es un mapa invertido.
- **Reproducción [V]:**
  - Una cuenta que solo recibe ventas, leída con un mapa invertido (manual mal hecho por el cliente, o cacheado) → 14 salidas y 0 entradas.
  - Sale `filtrada: "cargos"` y `filtradaPermitida = true`, así que aparece el botón verde "Mi cartola es solo cargos".
  - Si se toca, queda sellada `cliente` y el mapa propio confirmado. **Ventas que no se emiten = ventas no declaradas.**
- **Mismo camino (V3-2) [V]:** `single_col` con banderas en inglés C=Crédito/D=Débito. `classifyTipoFlag` lee "c" como cargo, así que salen 0 de 11 abonos y también se ofrece "solo cargos".
- **Arreglo (chico):**
  - `filtrada` solo si `!q.invertidaCuadra` y si ningún salto es ±2×monto de su fila (eso delata inversión, no filtro). Si no → alerta "columnas o banderas al revés".
  - Además: ofrecer el botón solo en la dirección "abonos", que es el caso massDTE.

### V3-3 — ALTO: estado de cuenta de TARJETA DE CRÉDITO con layout nuevo `monto_con_signo` sale sellado `saldo` con las compras como ENTRADAS
- **Reproducción [V] (orquestador):** "Fecha | Descripción | Monto | Saldo" con compras positivas, pagos negativos y saldo = deuda.
  - Resultado: capa 2, `monto_con_signo`, **12 "entradas" = "COMPRA COMERCIO…"**, sello `saldo` "cuadra al peso en 13 de 14 filas".
  - La ecuación cierra igual en un pasivo (la deuda sube con la compra), así que el sello no distingue a qué lado va la plata.
  - Nadie le pide mirar (sello con prueba) y el mapa nace confirmado: sería candidato a consenso global.
- **Arreglo:**
  - En `monto_con_signo` el saldo prueba que no faltan filas, **no la convención de signo**. Sin un título que diga la dirección (Abono/Cargo, Ingreso/Egreso) → `sin_comprobar` y pedir "así la leímos".
  - Además: vetar la hoja si trae vocabulario de tarjeta (cupo, facturado, pago mínimo, tarjeta, estado de cuenta TC).

### V3-4 — MEDIO: el consenso global todavía se falsifica, pero caro y ya no en silencio
- **Qué hace falta:**
  1. 2 cuentas pagadoras (2 registros).
  2. Cartolas fabricadas con un N° de cuenta inventado en el encabezado. `detectarCuenta` lee lo que diga el archivo, así que la huella sale distinta.
  3. Datos que cierren al peso con el mapa malo.
  4. Títulos neutros; con títulos que contradicen, el global se descarta.
- **[V]:** con esos datos `hayConsensoParaGlobal = true`.
- **Por qué ya no es silencioso:** la víctima recibe `nuevo: true` y se le pide mirar.
- **Arreglo opcional:** exigir además ≥N días entre confirmaciones o una revisión manual (ops_event) antes de activar un global.

### V3-5 — BAJO: fechas con mes en texto
- **Bien [V]:** "05-SEP-2026", "5 dic 2025", "05/sept./2026" y "31-SEP-2026" (imposible).
- **Se cuela:** toma las 3 primeras letras de cualquier palabra, así que "5 MARCA 2026" pasa a 05-03 y "1 junta 2026" a 01-06. Solo importa en la columna fecha o en `cellEsFecha` (censo, resumen). Arreglo: lista cerrada de nombres de mes completos o abreviados.
- **No soportado:** "12-Ago-26", año de 2 dígitos. Queda `fecha_ilegible`, visible, sin error silencioso.

## Veredicto vuelta 3 — ¿listo para producción con el flag de IA apagado? **NO.**

Todo lo de las vueltas 1 y 2 quedó cerrado de verdad. Bloquean dos caminos nuevos por los que **ventas o compras quedan mal declaradas con sello verde o con un botón que invita a sellarlas**:
- **V3-1:** la rama "filtrada" no descarta el mapa invertido.
- **V3-3:** `monto_con_signo` sella por saldo sin saber la convención de signo (tarjeta de crédito).

Los dos arreglos son chicos y locales (`sellarCartola` y la rama `monto_con_signo`). Con esos dos arreglados y un test por cada uno, el veredicto pasa a **SÍ** (flag IA apagado, migración con respaldo previo de `parser_adapters`).
