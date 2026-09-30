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
