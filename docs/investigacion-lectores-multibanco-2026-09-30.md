# Investigación: cómo verifican y se adaptan los lectores MULTI-BANCO — 2026-09-30

> Pregunta: ¿cómo resuelven los lectores de extractos multi-banco que están en producción (muchos formatos, que
> cambian sin aviso) dos cosas: (1) **verificar la lectura cuando no hay saldo** y (2) **adaptarse a formatos
> nuevos**? Contexto: el experimento de hoy (`docs/experimento-estructura-deepseek-2026-09-30.md`) bajó los
> silenciosos de 5 a 1 con "dos opiniones", pero en producción **23 de 29 cartolas de banco no traen saldo**, así
> que el juez que decide el desempate (la ecuación del saldo) no existe en la mayoría de los casos reales.
>
> Método: código real clonado en `scratchpad/repos-adaptativo/` (nada dentro del proyecto) + docs públicas.
> **Verificado** = lo leí con archivo:línea o lo corrí. **No verificado** = viene de docs/marketing o lo inferí.
> No repito lo de `investigacion-lector-cartolas-2026-09-30.md` ni `investigacion-extraccion-ia-2026-09-29.md`
> (Actual, Firefly, bank2ynab, HisaabFlow, hledger, beangulp, Maybe, Pytheas, etc.) salvo con un detalle nuevo.

---

## 0. Respuesta corta (humildad incluida)

Nadie tiene un truco mágico. Cuando no hay saldo por fila, **todos los que están en producción sacan el juez de
afuera del mapeo**, de una de estas cinco fuentes (de más barata a más cara):

1. **El total que imprime el propio banco** (resumen del período, totales al pie, fórmula SUMA). ← lo tenemos
   delante y lo **botamos** (ver §1, verificado con una cartola real: cuadra al peso).
2. **Un número tecleado por la persona**: el saldo final que aparece en su portal o PDF. Odoo, Actual y Skrooge
   hacen exactamente eso: la conciliación bancaria "de toda la vida" es **un número por mes**.
3. **Continuidad entre extractos de la misma cuenta** (Odoo: `saldo_inicial(N) == saldo_final(N-1)`; Ocrolus: "falta
   un mes"). Ya estaba en el informe anterior; aquí hay un detalle nuevo de implementación.
4. **Invariantes duras por fila que fallan fuerte** (plugins de ofxstatement: conjunto cerrado de banderas, una sola
   cuenta en todo el archivo, cargo XOR abono, fecha ≤ fin del período, largo de fila fijo).
5. **Humano en el loop solo cuando la máquina no puede comprobar** (Ocrolus; camelot entrega una "confianza").

Y para **formatos nuevos**, el patrón de la industria open source es poco glamoroso: **un lector por banco,
mantenido por quien usa ese banco, con archivos reales anonimizados como fixtures (incluidos los que DEBEN
fallar)** y, cuando el banco cambia algo, **fallar fuerte mostrando "esperaba X, llegó Y"** en vez de adivinar.
Nosotros adivinamos mejor que todos ellos (heurística por contenido), pero **fallamos más callado**.

---

## 1. Hallazgo verificado: la cartola trae su propio verificador y no lo leemos

`Cartola N°02 - 11 2025.xlsx` (raíz del repo, ignorada por git) tiene, **arriba de los movimientos**, un bloque
"Resumen del Periodo" con cuatro números: *Saldo Anterior · Total Cargos y Cheques · Total Abonos y Depósitos ·
Saldo Contable Final del Periodo* (fila 9, montos en texto `"9.999.999"`).

Corrí nuestro lector (`detectHeuristic` + `applyAdapter`, sin nube, script en `scratchpad/verif-resumen/`) y lo
comparé contra ese bloque:

| Chequeo | Resultado |
|---|---|
| Σ SALIDA leída vs "Total Cargos y Cheques" impreso | **cuadra al peso** (dif 0) |
| Σ ENTRADA leída vs "Total Abonos y Depósitos" impreso | **cuadra al peso** (dif 0) |
| Saldo anterior − cargos + abonos = saldo final (del propio resumen) | **cuadra** |
| Movimientos leídos | 675, descartes 0 |

Qué hacemos hoy con ese bloque (leído en el código):
- Las filas antes de `skip_rows_before_data` **ni se miran** (`apply.ts:291`, el bucle parte en `start`).
- Si el resumen viene **debajo** de los datos, `esFilaResumen` activa `bloqueResumen` y lo que sigue se anota como
  descarte legítimo (`apply.ts:287-294`). Es decir, lo usamos para **botar filas**, no para **comprobar**.
- `marcarFilasDeTotales` (`apply.ts:427-445`) compara la fila sin fecha contra nuestras sumas… y si calza la marca
  "resumen" legítima. **La coincidencia es exactamente la prueba de que leímos bien, y la tiramos a la basura en
  vez de guardarla como "verificado por el total del banco".**
- `grep -i "saldo anterior|total abonos|total cargos"` en `src/lib/parsers` y `src/lib/cartola`: solo el comentario
  de `apply.ts:288` y tests de censo. No existe un estado "verificado por totales".

**No verificado:** cuántas de las 23 cartolas sin saldo traen un resumen así. BICE está nombrado en el comentario
de `apply.ts:288`; esta Cartola N°02 lo trae (y además trae saldo diario, o sea no es de las 23). Hay que medirlo
**localmente** sobre los archivos reales antes de construir (ver idea 1).

---

## 2. Proyectos revisados

### 2.1 ofxstatement (kedder/ofxstatement, 365★) + plugins por banco
- **Qué hace:** convierte extractos propietarios a OFX. El núcleo no sabe leer ningún banco: cada banco es un
  **paquete aparte** (`ofxstatement-<país/banco>`), ~74 listados en el README (`README.rst:85-…`), mantenidos por
  quien usa ese banco. Hay un proyecto plantilla (`ofxstatement-sample`, `README.rst:336-340`).
- **Detección de formato:** **ninguna automática.** El usuario elige el plugin en la config (`tool.py:176-185`).
- **Si no reconoce:** el plugin lanza `ParseError` con número de línea; el tool sale con código 2
  (`tool.py:190-194`).
- **Verificación:** `Statement.assert_valid()` exige `saldo_inicial + Σ montos == saldo_final`
  (`statement.py:122-135`) **pero solo si ambos saldos existen**. Si el extracto no trae saldos, la librería ofrece
  `recalculate_balance()` que **inventa** saldo_inicial = 0 y saldo_final = 0 + Σ (`statement.py:496-510`) → la
  aserción pasa por construcción. **Anti-lección verificada:** los 5 plugins austriacos que cloné llaman
  `recalculate_balance` (`ofxstatement-austrian …/oberbank.py:28, raiffeisen.py:28, easybank.py:38, ingdiba.py:27,
  livebank.py:29`). Es nuestro mismo riesgo: un "validador" que con datos faltantes aprueba solo.
- **Lo que hacen MEJOR que nosotros (plugins holandeses, `gpaulissen/ofxstatement-dutch`):**
  - **Encabezados versionados:** ING guarda una **lista** de encabezados conocidos, con el link al issue que agregó
    la versión nueva (`MutatieSoort → Mutatiesoort`, `nl/ing.py:98-125`). Un cambio del banco = una línea más en la
    lista + un sample nuevo, no un parser nuevo.
  - **Invariantes cerradas que revientan fuerte:** bandera ∈ {"Af","Bij"} (`ing.py:270`); **una sola cuenta en todo
    el archivo** (`ing.py:264-266`); en ICS Cards largo de fila ∈ {5,7,8} (`icscards.py:241`), fecha ≤ fin del
    período (`icscards.py:237`) y el bloque resumen se reconoce por su fila de títulos exacta
    ("Vorig openstaand saldo | Totaal ontvangen betalingen | Totaal nieuwe uitgaven | Nieuw openstaand saldo",
    `icscards.py:101-167`) y **se usa como saldo inicial/final** → vuelve a activar la ecuación.
  - **Fixtures reales anonimizados, incluidos los que deben fallar:** `tests/samples/` trae `ing_fail.csv`,
    `Knab_…_no_header2.csv`, `…_no_lines.csv`, `icscards_no_balance.txt`, `icscards_error.txt`, `empty.csv`,
    `blank.pdf`; los tests marcan `xfail(raises=ParseError)` (`tests/test_ing.py:91-102`, `test_knab.py:83-101`).
  - **Fineco (`ofxstatement-fineco/plugin.py:168-197`):** si el encabezado no calza con la plantilla, el error dice
    literalmente `expected: [...]` / `current: [...]`. Y `assert (income > 0) ^ (outcome > 0)` (`:208`).
- **¿Qué nos llevamos?** (a) fixtures negativos obligatorios; (b) historial de encabezados por banco con el diff
  "esperaba/llegó"; (c) **jamás** un validador que apruebe cuando le falta el dato: "sin saldo" tiene que ser un
  estado visible (`sin comprobar`), no un OK.

### 2.2 Odoo (núcleo `account`) + OCA/bank-statement-import (módulos de extracto en producción en miles de empresas)
- **Qué hace:** `account_statement_import_sheet_file` lee CSV/XLSX con un **mapeo por banco** guardado
  (`…_sheet_mapping.py:13-190`): separador de miles/decimal **explícitos** (`:16-33`), columnas **por nombre**
  (`_get_column_indexes` → `header.index(nombre)`, `…_sheet_parser.py:103-128`; si el título no está, `ValueError`
  → import falla), valores de bandera **por mapeo** (`debit_value`/`credit_value`, `mapping.py:147-154`), filas a
  saltar arriba/abajo (`:168-180`).
- **Si no reconoce:** `UserError("Failed to parse file")` (`parser.py:218`) o el wizard rechaza "ya importaste este
  archivo" (`account_statement_import.py:36-39`).
- **Verificación sin saldo — lo mejor que encontré, verificado en `addons/account/models/account_bank_statement.py`:**
  - Dos conceptos separados, con comentario explícito (`:78-90`): **`is_complete`** = integridad *interna*
    (`saldo_inicial + Σ líneas == balance_end_real`, `:218-220`) e **`is_valid`** = integridad *externa*
    (`saldo_inicial == saldo_final del extracto anterior` de la misma cuenta, SQL con `LAG(...) OVER (PARTITION BY
    journal)`, `:325-356`).
  - **Cuando el archivo no trae saldo, `balance_end_real` lo escribe la persona** (el saldo que ve en el banco). El
    extracto queda marcado con `problem_description` = *"Incorrect ending balance, expected X"* hasta que cuadre
    (`:236-249`). El saldo inicial **no se pide**: se deriva del extracto anterior (`_compute_balance_start`,
    `:168-194`).
  - Detalle fino (OCA, `account_statement_import.py:327-338`): cuando se salta una línea por duplicada, **se le suma
    su monto al saldo inicial** para que la ecuación siga cerrando. Nuestra dedup hoy no ajusta nada.
- **¿Qué nos llevamos?** El modelo mental completo: *interna* (¿la cartola cuadra consigo misma?) vs *externa* (¿empalma
  con la anterior?), y el **saldo final como único dato humano** cuando el archivo no lo trae.

### 2.3 Actual Budget — detalle nuevo (conciliación)
- Ya revisado como importador. Lo nuevo: el botón *Reconcile* pide **"Enter the current balance of your bank account
  that you want to reconcile with"** (`components/accounts/Reconcile.tsx:176-177`) y muestra *"Your cleared balance X
  needs +Y to match your bank's balance of Z"* o *"All reconciled!"* + **"Lock transactions"** (`:48-110`).
- **¿Qué nos llevamos?** La frase y el gesto: un número, una diferencia en pesos, un candado. Cabe en nuestra UX
  "Apple": no es un mapeador, es una pregunta.

### 2.4 GnuCash (importador CSV + QIF)
- **CSV:** asistente con vista previa; `verify()` exige columnas mínimas y lista **errores por línea**; el usuario
  puede "saltar líneas con error" explícitamente (`csv-imp/gnc-import-tx.cpp:503-619`, `:280-298`). Ajustes
  guardables como preset (`gnc-imp-settings-csv*.cpp`).
- **Lo que hacen MEJOR (QIF, verificado):** el formato de número/fecha de un campo se decide **intersectando las
  posibilidades de TODAS las celdas** (`qif-imp/qif-file.scm:982-1047`). Si no queda ninguna → *"Unrecognized or
  inconsistent format"*. Si quedan varias, revisa si **todas dan el mismo valor** (`all-formats-equivalent?`,
  `:1088`: "1000 2000 3000" sirve como punto o coma decimal, da igual) y solo si difieren es ambigüedad real.
- **¿Qué nos llevamos?** Es la solución exacta al bug `"250,000" → 250` (`apply.ts:19`): por columna, candidatos
  {miles-con-punto, miles-con-coma, decimal-coma, decimal-punto}, intersectar sobre todas las celdas, y si quedan
  dos con valores distintos → **no adivinar**, pedir desempate (al total impreso, al saldo o a la persona).

### 2.5 KMyMoney (importador CSV con perfiles)
- **Formato decimal por columna** (`csvimportercore.cpp:599-671`): recorre toda la columna; si ve `1.234,56` y
  `1,234.56` en la misma columna devuelve `Auto` (= no sabe, pregunta). **Pero** un `"250,000"` solo, sin otra pista,
  lo toma como **coma decimal** (`:641-643`): tiene **nuestro mismo bug**. GnuCash lo hace mejor.
- **Detecta la cuenta desde el encabezado** (`detectAccount`, `:789-830`): junta el texto de las filas **antes** de
  los datos, le quita `-., ` y busca números/nombres de cuentas existentes; si calza **exactamente una**, el extracto
  queda asignado. Es el prerrequisito barato para la continuidad (idea 3).
- **Saldo:** si hay columna saldo, deduce el orden (asc/desc) por fechas y toma el saldo de cierre (`:964-1000`).
- **¿Qué nos llevamos?** `detectAccount` casi tal cual (en Chile el N° de cuenta está arriba en casi todas las cartolas
  — **no verificado** para todas).

### 2.6 Money Manager Ex y Skrooge
- **MMEX** (`univcsvdialog.cpp:238-330`): presets con nombre y **"Load this Preset when Account is X"**: el formato se
  recuerda **por cuenta**, no por huella. La columna *Balance* solo se usa al **exportar** (`:1851`, `:2241`); al
  importar no verifica nada.
- **Skrooge** (`skgimportplugincsv.cpp:41-79`): cada rol es una **regex traducible** (`^date`, `^comment|^libell?`,
  `^value|^amount|^montant|^credit|^debit`) + búsqueda automática de la fila de títulos. Parámetro `balance`: si la
  cuenta está vacía, fija el saldo inicial = saldo dado − Σ (`:781-798`). Es "tecleo un número", pero lo usa para
  **cuadrar a la fuerza**, no para **comprobar** (anti-lección menor).
- **¿Qué nos llevamos?** Poco nuevo: confirma "mapeo recordado por cuenta" y "un número humano".

### 2.7 camelot (tablas en PDF)
- `parsing_report` con `accuracy` (texto que no cayó limpio en una celda) y `whitespace` (% de celdas vacías);
  `confidence = accuracy × (1 − whitespace)` (`camelot/core.py:686-705`, `parsers/base.py:326-329`). Plantillas =
  `table_areas`/`columns` que da el usuario.
- **¿Qué nos llevamos?** La idea de medir **lo que quedó fuera** de la tabla (nuestro "censo independiente" del
  informe anterior) y exponer un número de confianza, no un sí/no. Útil para el lector de PDF/OCR, no para Excel.

### 2.8 Agregadores y lectores comerciales (Plaid, Belvo, Fintoc, Ocrolus) — **no verificado en código**
- **Plaid/Belvo/Fintoc** evitan el problema: no leen archivos, leen la API o el portal del banco. Belvo entrega junto a
  las transacciones `account.balance.current/available` ([docs](https://developers.belvo.com/apis/belvoopenapispec/transactions/retrievetransactions)):
  el ancla es el **saldo actual del portal**. Plaid *Statements* baja el **PDF oficial** del banco para verificación
  ([docs](https://plaid.com/docs/statements/)). Fintoc: no revisé docs.
- **Ocrolus** (lectura de extractos para créditos): humanos revisan **solo** los campos que la máquina no pudo
  confirmar ("human-in-the-loop"), marca **meses faltantes** y resume por período saldo y total de depósitos
  ([docs](https://docs.ocrolus.com/docs/getting-started-bank-statements), [capture](https://docs.ocrolus.com/docs/capture)).
- **¿Qué nos llevamos?** Refuerza 2 y 3: saldo del portal como ancla; "mes faltante" como alarma; humano solo en lo
  no comprobable.

### 2.9 Chile / LatAm ("cartola" en GitHub) — casi todo es ruido de *Cartola FC* (fútbol)
Lo relevante que encontré y leí:

| Repo | Qué hace | Detección | Verificación | Nota |
|---|---|---|---|---|
| `Hernancyg/cyg-cartolas-f29` (Flask+Supabase, actualizado ayer) | Lector **genérico** de PDF por coordenadas + Excel; BCI calibrado, BancoEstado/Santander/Chile "no probados con PDF real" (`app/parsers/bank_parsers.py:15-40`) | `detect_bank` por texto, **solo informativo** (`:211`) | El saldo es "informativo, no se usa" (`:201`). La cadena de saldos solo se revisa **en un test** con una cartola real (`tests/run_verification.py:132-146`) | Competidor cercano; verifica en test, no en producción |
| `maxvaldes33/finanzas-cli` | Parsers por banco con `can_parse` + genérico de respaldo | `can_parse` por nombres de columnas (`parsers/banco_estado.py:13-17`) | Ninguna; en PDF deduce cargo/abono **por variación del saldo** (`parsers/pdf_parser.py:137-170`) | Si no reconoce: error con la lista de columnas encontradas (`parsers/__init__.py:26`) |
| `Buronn/firefly-iii_chile-cartolas-importer` | Configs Firefly por banco (Estado, Santander, Chile, Mach) | Elección manual | Ninguna | **Anti-ejemplo:** `header=16` fijo y renombrado posicional de columnas (`bancos/estado.py:9-13`): una fila más arriba y lee mal en silencio |
| `diegocaro/parser-cartola-bancaria` | Banco de Chile **TXT de ancho fijo** (cuenta corriente) y XLS de TC, definidos en JSON | Por archivo de definición | Ninguna | El TXT trae **campo de signo** propio (`field_definitions/banco_de_chile_cuenta_corriente_txt.json`): algunos bancos ofrecen un formato "de máquina" que evita adivinar |
| `EduardoFerrerC/cartola-bancaria-parser` | PDF → Excel con "aprendizaje" de patrones de glosa | — | Ninguna | Aprende categorías, no formato |
| `kaihv/open-banking-chile` | (ya revisado) | | | |

Conclusión Chile: **nadie verifica en producción**. Estamos adelante; no hay nada que copiar salvo la pista del
formato TXT de Banco de Chile.

### 2.10 Proyectos con LLM (2025-2026)
- `wongyithongdev/Bank-Statement-AI`: agente generador + **evaluador independiente** ("You did NOT generate this
  Excel file… Never write to, modify, or patch", `internal/evaluator.py:105-171`) que puntúa contra **los totales
  impresos del PDF** como verdad (`AC5 ground_truth_match`, tolerancia 1 unidad) y exige subtotales por grupo que
  cuadren. Es nuestras "dos opiniones", con una diferencia clave: **el juez es el número del banco, no otro modelo**.
- `Lanting687/bank_statement_ai`: OCR + DeepSeek + **dos puntos de revisión humana** (página OCR vs PDF lado a lado;
  marcar/desmarcar transacciones) (`docs/ARCHITECTURE.md:51-60`). Todo manual, nada automático.
- `psousa50/bank-statements-ai`: **misma arquitectura que la nuestra** (heurística de columnas, huella = hash de la fila
  de títulos detectada con respaldo legacy, config guardada por huella + cuenta, `ARCHITECTURE.md:61-84`). Sin
  verificación. Buena señal de que no estamos inventando nada raro; mala señal de que nadie resolvió el "sin saldo".
- `trakanom/Bank-Statement-Parser-PDF-to-CSV`: declara `checksum_cols` por banco (`CONFIG.py:5`) pero
  `validate_data` **devuelve `valid: True` siempre** (`models.py:193-195`). Anti-lección.

---

## 3. Tabla comparativa

| Proyecto | Detecta formato | Si no reconoce | Verifica SIN saldo | Biblioteca de formatos | Mejor que nosotros en… |
|---|---|---|---|---|---|
| **massDTE** | Heurística por contenido + huella + nombres + IA | Capa 4 IA; mapeador manual | Censo (atado al mapeo); total del banco solo para **descartar** | Adaptadores en DB por huella+empresa; fixtures sintéticos | — (mejor detección que todos) |
| ofxstatement + plugins | Manual (config) | `ParseError` con línea | **No** (y `recalculate_balance` inventa saldo) | 1 paquete por banco, comunidad, samples reales | Fixtures negativos, encabezados versionados, invariantes cerradas |
| Odoo / OCA | Mapeo por banco, columnas **por nombre** | `UserError`, import no entra | **Saldo final tecleado** + continuidad `LAG()` | Mapeos por diario/banco | *Interna vs externa*; ajuste de saldo al saltar duplicados |
| Actual (conciliar) | (ya visto) | (ya visto) | **Saldo del banco tecleado**, diferencia en pesos, candado | Por cuenta | UX de "un número" |
| GnuCash | Asistente + presets | Errores por línea, saltar explícito | No | Presets locales | **Formato por intersección + equivalencia** |
| KMyMoney | Perfiles | Pregunta decimal si hay conflicto | No | Perfiles locales | **Cuenta detectada del encabezado** |
| MMEX / Skrooge | Preset por cuenta / regex por rol | Manual | No / "balance" que fuerza | Local | Preset por cuenta |
| camelot | Plantillas de área | Tabla con baja confianza | Métrica `accuracy`/`whitespace` | — | Confianza numérica |
| Ocrolus / Plaid / Belvo | Propio / no aplica (API) | Humano | Totales por período, mes faltante, saldo del portal | Propietaria | Humano solo en lo no comprobable |
| cyg-cartolas-f29 (CL) | Genérico por coordenadas | Mensaje "no se detectaron movimientos" | Solo en test | 1 genérico + Mercado Pago | Nada |
| LLM 2025-26 | LLM | Reintenta | Totales impresos del PDF (1 de 4) | — | Juez = número del banco |

---

## 4. Ideas priorizadas (valor / costo) — ★ = no estaba en los informes anteriores

1. **★ Leer el resumen/total del banco como VERIFICADOR, no como basura.** Buscar el bloque "Saldo anterior / Total
   cargos / Total abonos / Saldo final" **arriba o abajo** de los datos (títulos + número debajo o al lado) y la fila de
   totales sin fecha; comparar contra Σ leído. Tres estados: *verificado por total del banco* · *no calza por $X →
   alarma con la diferencia* · *no hay total → sin comprobar*. Además, invertir `marcarFilasDeTotales`: cuando calza,
   hoy solo marca "resumen"; debería **además** guardar `verificado_por_totales = true`. Verificado que funciona en
   una cartola real (675 filas, dif $0). **Primero medir** cuántas de las 23 lo traen (script local sobre los archivos;
   nada sale del Mac). *Valor muy alto · costo bajo.* También es el **juez** que le falta al "dos opiniones" cuando no
   hay saldo.
2. **★ "Un número por mes": el saldo final lo pone la persona solo cuando la cartola no se puede comprobar sola**
   (Odoo `balance_end_real`, Actual *Reconcile*). Si no hay saldo ni total impreso: una sola pregunta, en el lugar
   donde la clienta mira el resultado — "¿Cuánto dice tu banco que tenías al 31/10?" — y la respuesta cierra la
   ecuación con el saldo final del mes anterior (Odoo lo deriva, no lo pide). Muestra la diferencia en pesos, como
   Actual. *Valor muy alto · costo medio (UI + guardar saldo por cuenta/mes).* Recorrerlo como cliente antes de
   construir (¿la contadora tiene ese número a mano? — no verificado).
3. **Continuidad entre cartolas con cuenta detectada del encabezado** (KMyMoney `detectAccount` + Odoo `is_valid`
   con `LAG()`). Ya propuesto antes; lo nuevo es el cómo: el N° de cuenta sale del texto **sobre** los datos, y la
   validez externa es un SQL de una ventana. Una vez que existe, idea 2 pide el saldo **una sola vez** y los meses
   siguientes se encadenan. *Valor alto · costo medio.*
4. **★ Formato de número por intersección (GnuCash QIF), no por primera coma.** Candidatos por columna, intersectar en
   todas las celdas, colapsar si todos dan el mismo valor, y si quedan dos distintos → desempatar con el total impreso
   (idea 1) o preguntar. Arregla el único silencioso que sobrevivió al experimento. Ojo: KMyMoney tiene nuestro mismo
   bug, no copiarlo. *Valor alto · costo bajo.*
5. **★ Fixtures negativos obligatorios** (ofxstatement-dutch): por banco, además del sample bueno, `*_fail`,
   `*_sin_titulos`, `*_sin_filas`, `*_sin_saldo`, `vacio` — y el test exige **alarma**, no "0 movimientos OK". Se
   combina con el sanitizador y las mutaciones del informe anterior. *Valor alto · costo bajo.*
6. **★ Historial de encabezados por banco + mensaje "esperaba / llegó"** (ING `header` como lista con link al issue;
   Fineco `expected/current`). Cuando la huella no calza pero el banco sí se reconoce, en vez de caer callado a la
   heurística: registrar el diff y avisarlo (a nosotros en el log y, si cambia el resultado, a la clienta). *Valor medio
   · costo bajo.*
7. **★ Estado "sin comprobar" visible, nunca un OK por omisión** (anti-lección `recalculate_balance`, `valid: True`).
   Hoy una cartola sin saldo que pasa el validador se ve igual que una comprobada. Tres sellos: *comprobada por
   saldo* · *comprobada por total del banco* · *leída, sin comprobar (confírmala con un número)*. *Valor alto · costo
   bajo.* Es la versión honesta de las 23 de 29.
8. **Al saltar un duplicado, ajustar el saldo inicial** (OCA `account_statement_import.py:337-338`) para que la ecuación
   siga cerrando. *Valor medio · costo muy bajo.*
9. **Invariantes duras por fila** que hoy no tenemos: una sola cuenta por archivo si hay columna cuenta; largo de fila
   de datos estable; montos CLP sin decimales (un decimal en CLP es síntoma de formato mal leído). Las de bandera
   cerrada y cargo XOR abono **ya las tenemos** (`classifyTipoFlag` devuelve null → `tipo_desconocido`,
   `apply.ts:218-228`; motivo `cargo_y_abono`). *Valor medio · costo bajo.*
10. **Pedirle al banco el formato "de máquina" cuando exista** (Banco de Chile TXT de ancho fijo con signo). Solo una
    pista; **no verificado** qué bancos lo ofrecen a pymes. *Valor ? · costo bajo de averiguar.*

**Lo que NO recomiendo:** un paquete escrito a mano por banco (modelo ofxstatement/OCA): funciona porque cada usuario
mantiene *su* banco; nosotros tenemos una sola persona para todos. Copiar la decisión decimal de KMyMoney. Fallar el
import entero ante una fila (Odoo/hledger): para un contador es peor que nuestro censo con motivo. Forzar el saldo
como Skrooge (fija el saldo inicial para que cuadre): eso es esconder, no comprobar.

---

## 5. Cómo encaja con el experimento de hoy

El "dos opiniones + desempate por saldo" queda cojo en 23 de 29 cartolas porque falta el juez. Con 1 + 2 el juez
existe casi siempre: **total impreso del banco** cuando está, y si no, **un número de la persona**. El LLM sigue siendo
segunda opinión del **mapa**, nunca juez (igual que el evaluador de `wongyithongdev`, que puntúa contra el total del
PDF y no contra su propia opinión). Orden sugerido: 4 (bug de formato) → 1 (medir y leer totales) → 7 (sellos) →
2 + 3 (un número por mes con continuidad) → 5 y 6 (tests y diffs).

---

## 6. Base de cada afirmación

- **Verificado leyendo código:** todo lo con archivo:línea de §2.1–2.7, §2.9, §2.10 y nuestro código en §1/§4.
- **Verificado corriendo:** §1 (cartola real, local, script en `scratchpad/verif-resumen/resumen.test.ts`).
- **No verificado:** §2.8 (docs/marketing de Ocrolus, Plaid, Belvo; Fintoc no revisado); cuántas de las 23 cartolas
  traen resumen; si las clientas tienen el saldo del portal a mano; qué bancos chilenos ofrecen TXT; conteo exacto
  de plugins de ofxstatement (~74 por conteo de enlaces del README).

## 7. Fuentes (clonadas en `scratchpad/repos-adaptativo/`)
- https://github.com/kedder/ofxstatement — `src/ofxstatement/statement.py`, `tool.py`, `README.rst`
- https://github.com/gpaulissen/ofxstatement-dutch — `src/ofxstatement/plugins/nl/{ing,icscards,knab,asn}.py`, `tests/`
- https://github.com/nblock/ofxstatement-austrian — `src/ofxstatement/plugins/*.py`
- https://github.com/frankIT/ofxstatement-fineco — `src/ofxstatement_fineco/plugin.py`
- https://github.com/gerasiov/ofxstatement-russian, https://github.com/mlaitinen/ofxstatement-revolut (samples)
- https://github.com/OCA/bank-statement-import (18.0) — `account_statement_import_sheet_file/models/*`, `account_statement_import_file/wizard/account_statement_import.py`
- https://github.com/odoo/odoo — `addons/account/models/account_bank_statement.py`
- https://github.com/actualbudget/actual — `packages/desktop-client/src/components/accounts/Reconcile.tsx`
- https://github.com/Gnucash/gnucash — `gnucash/import-export/csv-imp/gnc-import-tx.cpp`, `qif-imp/qif-file.scm`, `import-parse.cpp`
- https://invent.kde.org/office/kmymoney — `kmymoney/plugins/csv/import/core/csvimportercore.cpp`
- https://github.com/moneymanagerex/moneymanagerex — `src/import_export/univcsvdialog.cpp`
- https://invent.kde.org/office/skrooge — `plugins/import/skrooge_import_csv/skgimportplugincsv.cpp`
- https://github.com/camelot-dev/camelot — `camelot/core.py`, `camelot/parsers/base.py`
- Chile: https://github.com/Hernancyg/cyg-cartolas-f29, https://github.com/maxvaldes33/finanzas-cli, https://github.com/Buronn/firefly-iii_chile-cartolas-importer, https://github.com/diegocaro/parser-cartola-bancaria, https://github.com/EduardoFerrerC/cartola-bancaria-parser
- LLM: https://github.com/wongyithongdev/Bank-Statement-AI, https://github.com/Lanting687/bank_statement_ai, https://github.com/psousa50/bank-statements-ai, https://github.com/trakanom/Bank-Statement-Parser-PDF-to-CSV
- Docs: https://docs.ocrolus.com/docs/getting-started-bank-statements, https://docs.ocrolus.com/docs/capture, https://plaid.com/docs/statements/, https://developers.belvo.com/apis/belvoopenapispec/transactions/retrievetransactions
