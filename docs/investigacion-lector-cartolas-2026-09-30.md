# Investigación: cómo leen cartolas los que no se rompen — 2026-09-30

> Pregunta de fondo (Matías): "el problema no es la cartola, somos nosotros". Si el banco cambia una letra del
> encabezado o mueve una columna, ¿el lector se rompe o, peor, pierde filas en silencio?
>
> Método: primero leí nuestro lector (código, no memoria), después clonamos y leímos código real de 17 repos en
> `scratchpad/repos-lector` (nada dentro del proyecto). Todo lo marcado **verificado** lo corrí o lo leí con
> archivo:línea; lo demás dice **no verificado**. No repito lo de `investigacion-extraccion-ia-2026-09-29.md`
> (statement-tieout, monopoly, docket, etc.) salvo cuando aporta algo nuevo.

---

## 0. Base: qué hace nuestro lector hoy (leído en el código)

| Pieza | Qué hace | Dónde |
|---|---|---|
| Orquestador | Plantilla massDTE → caché por huella (capa 0) → heurística estructural (2) → por nombres (3) → IA con alarma (4). Cada capa pasa por el validador | `src/lib/parsers/orchestrator.ts:49-284` |
| Huella | sha256 de la **fila de títulos normalizada** (la fila justo antes del primer bloque de ≥3 filas con fecha+monto); si no hay títulos, huella legacy por tipo de celda de las 20 primeras filas | `fingerprint.ts:20-58`, `heuristic.ts:119-159` |
| Heurística | Columnas por **contenido**: fecha = mayor % de fechas; glosa por encabezado o texto más largo que no sea código; par cargo/abono = columnas numéricas **mutuamente excluyentes**; saldo = serie "sin saltos"; orientación por **ecuación del saldo** → nombre → posición | `heuristic.ts:172-351`, `saldo-cuadre.ts` |
| Mapeo recordado | `parser_adapters` por huella + empresa; derivado queda **privado** si el saldo no lo confirma; manual propio gana; confianza baja con fallas | `adapter-store.ts`, `orchestrator.ts:371-397` |
| Mapeador manual | El cliente asigna roles a **índices de columna** | `components/upload/FieldMapper.tsx:200-215`, `api/parser/save-mapping` |
| Censo | Toda fila con plata **en las columnas mapeadas** que no se convierte en movimiento queda anotada con motivo; totales = legítimos | `apply.ts:289-313, 427-445` |
| Cuadre final | leídas vs guardadas vs duplicadas vs DB | `lib/cartola/cuadre.ts` |

Honestamente: el lector ya está **más adelante** que casi todo lo open source que revisé en detección de columnas
por contenido (Actual, Firefly, bank2ynab, HisaabFlow y open-banking-chile adivinan por nombre o dependen de un
archivo de configuración escrito a mano). Lo que nos falta está en otra parte: en **cómo sabemos que no perdimos
nada sin depender del propio mapeo**, y en cómo reaccionamos cuando el formato cambia.

### 0.1 Tres hallazgos verificados corriendo nuestro código (no son teoría)

Scripts en el scratchpad, con filas sintéticas:

1. **Una glosa con la palabra "TOTAL" apaga el censo del resto del archivo.** `esFilaResumen` mira cualquier celda
   de texto con `\btotal\b` (`apply.ts:238-243`) y en cuanto una fila calza, `bloqueResumen = true` para **todo lo que
   sigue** (`apply.ts:294`). Prueba: fila 3 = "PAGO TOTAL TARJETA" (movimiento normal); después un abono con fecha
   "31/09/2026" ($250.000) y otro sin fecha ($80.000). Resultado: los dos quedan como
   `motivo: "resumen", legitimo: true` → **no aparecen como pérdida en el cuadre**. Es exactamente la pérdida
   silenciosa que el cuadre nació para impedir (glosas reales con "TOTAL": "PAGO TOTAL TC", "TOTALPACK" no, pero
   "ABONO TOTAL", "PAGO TOTAL" sí).
2. **`"250,000"` en texto se lee como $250.** `parseChileanNumber` corta en la primera coma (`apply.ts:19`) porque
   asume coma decimal. Prueba: `"80,000"→80`, `"1,234,567"→1`. El comentario de la función dice lo contrario
   (`"80,000" → integer`). Basta un Excel exportado con configuración regional en inglés o un monto pegado como texto.
   Ningún check lo ataja: el monto es >0 y, sin saldo, no hay ecuación que falle.
3. **El censo es ciego a lo que el mapeo no mira.** `montoEnFila` solo suma las columnas del mapeo
   (`apply.ts:246-261`) y la fila sin plata ahí se salta **sin anotarse** (`apply.ts:379`, también `362`, `372`).
   Prueba: mapeo guardado cargo=2/abono=3; el banco inserta la columna "Nombre" en la 2 → de 3 filas se lee 1, el
   cargo de $5.000 entra como ENTRADA, y el censo dice `filas_con_monto=1, leidas=1, descartes=0` → **cuadre OK**.
   Matiz honesto: hoy la huella por encabezado cambia al insertarse una columna y ese mapeo viejo no se aplicaría;
   pero la heurística también puede elegir mal (pasó con BCI Detallado) y en ese caso el censo tampoco lo ve,
   porque cuenta con los mismos ojos con que leyó.

Otros puntos leídos (sin prueba corrida):
- `single_col` sin cuadre por saldo: el check 6 solo corre en `two_cols` (`validator.ts:136-140`) y, si la ecuación
  no logra elegir monto/saldo, la heurística **adivina** "primera numérica = monto" (`heuristic.ts:488-492`).
- Banderas de una letra globales: `a/h` = entrada, `c/d` = salida (`apply.ts:223-224`). Firefly III documenta que
  en Rabobank **"A" = Af = SALE** (`firefly-iii/data-importer app/Services/CSV/Converter/BankDebitCredit.php:42-55`).
  En Chile "C" puede ser Crédito o Cargo según el banco. Sin saldo en single_col, nadie lo verificaría.
- Dedup contra la base es **muchos-a-uno**: `existenteByLoose` es un `Map` clave→1 existente
  (`processor.ts:1131-1143`) y cada fila nueva con la misma clave choca con ese mismo existente (`processor.ts:1237`).
  Tres P2P idénticos en la cartola nueva y uno ya guardado → los tres se declaran duplicados. Se ven en el visor
  (no es silencioso), pero es el error de diseño que Actual y YNAB evitan (ver 3.2).

---

## 1. Detectar columnas sin depender del nombre ni de la posición

### 1.1 Firma de símbolos por columna (Pytheas, VLDB 2020)
- **Qué es:** cada celda se reduce a su secuencia de símbolos (`D`=dígito, `A`=letra, `.`,`/`…); una columna de datos
  tiene un patrón **coherente** ("DD/DD/DDDD", "D.DDD.DDD"). Las líneas se clasifican por cuántas celdas **coinciden
  con el patrón de su columna** (reglas "Data_Column" y "Not_Data_Column": `CONSISTENT_NUMERIC_WIDTH`,
  `SymbolChain`, `First_FW_Symbol_disagrees`, `CHAR_COUNT_OVER_POINT5_MAX`…), con pesos entrenados y una
  confianza por tabla.
- **Dónde:** `cchristodoulaki/Pytheas pytheas/rules/*.csv` (reglas en texto), `src/pytheas/table_classifier_utilities.py:1411 assess_data_line`, pesos en `src/pytheas/trained_rules.json`.
- **¿massDTE?** Parcial. `isTransactionRow` mira la fila **sola** (tiene fecha y número >0, `heuristic.ts:143-159`);
  no compara cada celda contra el patrón de su columna. Pytheas diría "esta fila es de datos aunque le falte la
  glosa" (coincide en fecha y monto) y "esta fila NO es de datos aunque tenga un número" (el número rompe el patrón
  de su columna: un total de 9 dígitos en una columna de 5-6).
- **Valor/costo:** medio / medio. La idea útil y barata no es el modelo entrenado, es la **firma de símbolos por
  columna** como (a) segunda opinión para detectar filas basura y (b) huella de formato sin texto (ver 2.2).

### 1.2 Tipado por formato de celda de Excel, no por valor (TableSense + SheetJS)
- **Qué es:** el Excel del banco ya dice el tipo: `cell.t` (n/s/d) y `cell.z` (formato "#,##0", "dd/mm/yyyy"). TableSense
  (Microsoft) usa además estilo (negrita, bordes, relleno) para detectar tablas y encabezados.
- **Dónde:** `microsoft/TableSense` publica solo el dataset y la descripción de features (README; **código del modelo
  no publicado**). Verificado en nuestras cartolas reales (solo estructura, sin valores): Santander trae la columna
  de montos con formato `#,##0` en 239 celdas y el resto `General`; la "Cartola N°02" trae 635 números `#,##0` en K.
- **¿massDTE?** No. Leemos con `cellDates:true` y después tipamos por valor (`cellEsFecha` acepta cualquier número
  36526-73050 como fecha, `heuristic.ts:28`) — el origen del incidente M&E ($46.242 leído como fecha).
- **Valor/costo:** medio / bajo. Un número con formato `#,##0` **no es una fecha**; con `dd/mm/yyyy` sí. Es una
  señal gratis que ya viene en el archivo.

### 1.3 Formato de número por columna, decidido mirando TODAS las celdas (Maybe, HisaabFlow)
- **Qué es:** Maybe obliga a elegir entre 4 formatos (`"1,234.56"`, `"1.234,56"`, `"1 234,56"`, `"1,234"`) por import
  (`maybe-finance/maybe app/models/import.rb:8-13`); HisaabFlow lo **detecta** con puntaje sobre muestras
  (`backend/shared/amount_formats/amount_format_detector.py:36-121`, `_score_format_against_samples`).
- **¿massDTE?** No: un solo parser que asume coma decimal para todo (hallazgo 0.1-2).
- **Valor/costo:** alto / bajo. Regla determinista por columna: si alguna celda tiene `\d{1,3}(,\d{3})+$` y ninguna
  `,\d{1,2}$`, la coma es de miles. Si la columna es ambigua, **no adivinar**: al censo como `monto_ambiguo`.

### 1.4 Búsqueda de asignaciones con verificador, en vez de decisiones codiciosas (Evaporate, "program synthesis")
- **Qué es:** Evaporate (Stanford/Hazy) le pide al LLM **muchas funciones candidatas** de extracción, las ejecuta sobre
  una muestra, las puntúa y se queda con las mejores (`HazyResearch/evaporate evaporate/profiler.py:354-411
  get_functions`; pasos PREDICT/SCORE/APPLY en `run_profiler`, `profiler.py:599+`).
- **Para nosotros (idea nueva):** no necesitamos al LLM para generar candidatos. Una cartola tiene ≤15 columnas;
  las asignaciones plausibles (fecha, glosa, cargo, abono, saldo) son unos pocos miles. Hoy la heurística decide
  **columna por columna** (fecha = la de más fechas, luego glosa, luego el mejor par; `heuristic.ts:244-330`) y el
  saldo solo se usa para orientar. La alternativa: **enumerar asignaciones y puntuar cada una con una función
  objetivo global** = % de filas que cierran la ecuación del saldo exacta + % de filas-con-plata (censo
  independiente, 2.1) que la asignación convierte en movimiento. Si hay un ganador único → aceptar; si hay empate
  → preguntarle al cliente mostrando **solo las columnas en disputa**.
- **¿massDTE?** No (tenemos las piezas: `cuadreSaldo`, censo; falta el buscador).
- **Valor/costo:** alto con saldo / medio. Sin saldo no hay verificador fuerte y vuelve a ser adivinanza (ahí sí
  cabe pedirle al usuario, ver 4).

### 1.5 Detección semántica aprendida (Sherlock, MIT)
- `mitmedialab/sherlock-project sherlock/features/` (bolsa de caracteres, embeddings, estadísticas; 78 tipos). Para
  nuestros 5 roles es **sobredimensionado**: nuestras reglas por contenido ya hacen eso. No recomiendo.

---

## 2. Fila de encabezado, filas basura y "no perder nada"

### 2.1 Censo independiente del mapeo (idea nueva, derivada de hledger/beangulp)
- **Qué hacen ellos:** hledger y beangulp **no descartan nada que no se haya dicho explícitamente**. En hledger toda
  fila después de `skip N` es transacción salvo que una regla `if … skip`/`end` la saque; si no se puede leer la
  fecha o el monto, **el import entero falla** mostrando la fila y la regla culpable
  (`simonmichael/hledger hledger-lib/Hledger/Read/RulesReader.hs:1760-1780` fecha, `:2005-2020` monto). beangulp
  levanta `RuntimeError("Error processing {filepath} line {lineno} with values {row}")`
  (`beancount/beangulp beangulp/importers/csvbase.py:419-425`); la única forma de rechazar una fila es que
  `finalize()` devuelva `None` a propósito (`:427-429`). Actual también aborta el import completo ante una fecha o
  monto ilegible (`ImportTransactionsModal.tsx:655-681`).
- **Nuestro hueco:** el censo existe (bien), pero cuenta con **las mismas columnas del mapeo** (hallazgo 0.1-3).
- **La idea:** un segundo censo que **no mire el mapeo**: en la región de datos, toda fila que tenga *alguna* celda
  fecha y *alguna* celda con plata ≠ 0 (en cualquier columna) es una "fila con plata". Invariante:
  `filas_con_plata_independiente == leídas + descartes`. Si no calza, el mapeo dejó plata afuera → formato
  sospechoso, no se comparte, y el cuadre lo muestra con el número de fila.
- **Valor/costo:** muy alto / bajo (función pura, ~40 líneas, `otrasHojasConDatos` ya hace casi lo mismo por hoja,
  `orchestrator.ts:310-327`).

### 2.2 La fórmula SUMA del banco como censo gratis (idea nueva, verificada en una cartola real)
- **Qué es:** algunos bancos exportan el total como **fórmula**, y la fórmula declara el rango de datos. SheetJS la
  entrega en `cell.f` (lo leemos con las opciones por defecto; `sheet_to_json` la bota).
- **Verificado:** en `santander.xlsx` (raíz del repo, ignorado por git) la celda `A251` es `=SUM(A13:A250)` → el banco
  dice "los movimientos son las filas 13 a 250" = **238 filas**; nuestro lector leyó exactamente **238** (single_col,
  la fila 251 como resumen legítimo). La otra cartola real ("Cartola N°02") no trae fórmulas.
- **Uso:** si hay una fórmula `SUM/SUMA` sobre la columna de montos: (a) la fila de la fórmula es de totales **por
  definición** (no por regex), (b) el rango es un censo independiente escrito por el banco, (c) el valor calculado
  de la fórmula es un total impreso para el chequeo tipo monopoly/tieout. Es la versión Excel del "total impreso" del
  informe anterior, pero más fuerte: no hay que leer etiquetas.
- **¿massDTE?** No. `marcarFilasDeTotales` adivina el total comparando sumas (`apply.ts:427-445`).
- **Valor/costo:** alto cuando está / muy bajo. No verificado cuántos bancos lo traen (solo vi 2 archivos).

### 2.3 Filas de resumen por estructura, no por palabra
- **Qué hacen:** Pytheas trata "total" solo en contexto: `AGGREGATION_ON_ROW_WO_NUMERIC`,
  `AGGREGATION_ON_ROW_W_ARITH_SEQUENCE`, `AGGREGATION_TOKEN_IN_FIRST_VALUE_OF_ROW` (regla de línea de DATOS, ojo), y
  `STARTS_WITH_NULL`, `FOOTNOTE` (`pytheas/rules/Pytheas Rules - Not_Data_Line_Rules.csv`,
  `…Data_Line_Rules.csv`). HisaabFlow lo resuelve con una lista **por banco**
  (`skip_rows_containing = Opening Balance,Closing Balance`, `configs/Meezan.conf`).
- **Para nosotros:** arreglar el hallazgo 0.1-1: la palabra "total" solo cuenta si la fila **no tiene fecha válida** y
  la palabra está en una celda que **no es la glosa** del mapeo; y nunca "bloque resumen" pegajoso sin exigir que las
  filas siguientes también rompan el patrón de datos (fecha en la columna fecha). Mejor aún: fórmula (2.2) o
  "monto = suma de lo leído" (ya existe) como prueba, la palabra solo como pista.
- **Valor/costo:** alto / bajo. Es un bug real.

### 2.4 Encabezado con basura arriba
- messytables usa "la primera fila con ≥ moda−1 celdas llenas" (`okfn/messytables messytables/headers.py:20-37`) y
  deja un TODO de "usar tipos para confirmar que es texto". Frictionless detecta la fila por tipos
  (`frictionless/detector/detector.py:275-298`). **Nosotros ya estamos mejor**: encabezado = fila antes del primer
  bloque de ≥3 filas con fecha+monto, y se exige que sea texto (`fingerprint.ts:40-58`). No hay nada que copiar.
- Caso que ninguno cubre y nosotros tampoco: **glosa partida en dos filas** (la segunda sin fecha ni monto). Hoy se
  pierde el pedazo de glosa sin aviso (no tiene plata, no entra al censo). Auto-Tables (VLDB 2023/2025,
  `LiPengCS/Auto-Tables-Benchmark`) sintetiza estas transformaciones, pero es investigación; la versión barata es
  "fila sin fecha ni plata pegada debajo de una fila leída → concatenar a la glosa y anotarlo". **No verificado**
  que algún banco chileno de nuestros clientes lo haga.

### 2.5 Validar TODAS las filas contra el esquema inferido (Frictionless)
- **Qué es:** se infiere el esquema con una muestra y un umbral (`field_confidence`, `detector.py:376-400`) y después
  **cada fila** se valida con errores tipados: `missing-cell`, `extra-cell`, `type-error`, `blank-row`
  (`frictionless/errors/cell.py:83-133`, `errors/row.py`).
- **¿massDTE?** Parcial: inferimos con 30 filas (`heuristic.ts:58-62`) y después solo validamos fecha y monto por fila.
  Una fila "corrida" (celdas desplazadas por una celda combinada, un `;` de más) pasa si por casualidad tiene
  número en la columna de monto. La "Cartola N°02" real trae **2.739 celdas combinadas** y 39 filas con otra forma
  (los cargos vienen en texto en otra columna) — nuestro lector las leyó bien (675/675, verificado), pero es el tipo
  de archivo donde un desplazamiento pasaría.
- **Valor/costo:** medio / bajo: "forma de la fila" (patrón de tipos por celda) vs la forma dominante; las que se
  desvían van al censo como `forma_rara` para mirar, no se descartan.

---

## 3. Recordar el mapeo y detectar que el formato CAMBIÓ

### 3.1 Mapear por NOMBRE de columna con alias, no por índice (Actual, beangulp, Maybe)
- **Actual Budget:** el mapeo se guarda **por cuenta** y por **nombre de campo del CSV**:
  `prefs["csv-mappings-${accountId}"]` (`ImportTransactionsModal.tsx:430, 740`), más `csv-skip-start-lines`,
  `csv-in-out-mode`, `flip-amount` por cuenta (`:250-262, 745-755`). Si la columna se mueve, sigue funcionando.
- **beangulp:** `Column("Fecha", "Date")` acepta **varios nombres**; si no encuentra ninguno, falla diciendo cuáles
  había: `Cannot find column 'X' in column names: …` (`csvbase.py:40-57`). Falla ruidosa ante una letra cambiada.
- **Maybe:** "plantilla" = el último import completo de la misma cuenta, copiando **etiquetas** de columna
  (`date_col_label`, `amount_col_label`…) (`app/models/import.rb:205-226`).
- **¿massDTE?** No: el adaptador guarda índices (`types.ts:32-41`, `FieldMapper.tsx:200-215`).
- **Valor/costo:** alto / bajo-medio. Guardar en el adaptador **índice + título normalizado + firma de símbolos** de
  cada rol. Al aplicar: si el título está en otra posición → usar la nueva; si no está → buscar el más parecido
  (distancia de edición ≤2 tras normalizar: "Descripcion"/"Descripción"/"Descripcion "); si nada calza → no aplicar.

### 3.2 Huella difusa: "parecido a un formato conocido" en vez de "igual" (HisaabFlow)
- **Qué es:** HisaabFlow identifica el banco con un **puntaje ponderado**: nombre de archivo 20%, firmas de contenido
  40%, encabezados requeridos encontrados 40% (`backend/core/bank_detection/bank_detector.py:54-78, 164-188`).
- **¿massDTE?** No: hash exacto (`fingerprint.ts:28-31`). Una letra cambiada = formato desconocido → la heurística
  re-deriva desde cero y el **mapeo manual del cliente se pierde** (solo existe el rescate por huella legacy,
  `orchestrator.ts:292-301`).
- **La idea combinada (nueva):** cuando la huella exacta falla, buscar adaptadores **de la misma empresa** con
  similitud de títulos alta (Jaccard de tokens ≥0,7), re-mapear por nombre (3.1), **re-verificar** con saldo + censo
  independiente, y si pasa: usarlo **y avisar el cambio** ("tu banco cambió 'Descripción' por 'Detalle' y agregó
  'Nombre'; seguimos leyendo igual"). Eso responde directo a la frase de Matías: el cambio de una letra deja de ser un
  formato nuevo y pasa a ser un **diff** visible.
- **Valor/costo:** alto / medio.

### 3.3 Continuidad entre cartolas de la misma cuenta (hledger, beancount, bankstatementparser)
- **Qué es:** el saldo de la cartola se convierte en una **aserción contra el libro acumulado**, no solo contra el
  mismo archivo. hledger: columna `balance` → aserción por posting (`RulesReader.hs:1847`, `:1990-1995`); beangulp
  emite una directiva `Balance` con el último saldo (`csvbase.py:434-460`) que beancount comprueba contra todo lo
  importado antes; bankstatementparser: `verify_continuity` = "saldo final de N == saldo inicial de N+1"
  (`bankstatementparser/hybrid/verification.py:285-345`).
- **¿massDTE?** No. No encontré `saldo_inicial/final` ni identidad de **cuenta bancaria** en `src/` ni en migraciones
  (grep vacío). Hoy no sabemos si dos cartolas son de la misma cuenta.
- **Valor/costo:** alto / medio. Detecta el mes que falta, la cartola repetida y el solape, sin mirar filas. Requiere
  guardar por documento: cuenta (sale del encabezado o del nombre de archivo, p. ej. "Cuenta_7280" en BCI),
  primer y último saldo, rango de fechas.

### 3.4 Dedup que respeta la multiplicidad (Actual, YNAB/bank2ynab, open-banking-chile)
- **Actual:** cada fila importada se empareja **una a una**; un existente ya usado entra a `hasMatched` y no se vuelve
  a usar (`loot-core/src/server/accounts/sync.ts:818`, pasadas en `:840-1000`: id exacto → mismo monto ±7 días y
  mismo pagador → mismo monto ±7 días).
- **YNAB (bank2ynab):** `import_id = YNAB:monto:fecha:N`, donde N es **la ocurrencia** de ese par en el archivo
  (`bank2ynab/dataframe_handler.py:555-560`). Tres P2P iguales el mismo día son `…:1`, `…:2`, `…:3`; reimportar el
  mismo archivo no duplica y no se come a los repetidos reales.
- **open-banking-chile:** la clave de dedup **incluye el saldo después del movimiento**: dos cargos idénticos tienen
  saldos distintos, así que son distintos (`kaihv/open-banking-chile src/utils.ts:200-217`).
- **¿massDTE?** No: muchos-a-uno contra la base (0.1). El saldo solo se usa en positivo para sugerir "son reales".
- **Valor/costo:** alto / bajo. Clave = (fecha, monto, tipo, **ocurrencia dentro del archivo**) y, si hay saldo,
  saldo. Resuelve de raíz la excepción "cartola solo abonos" (`processor.ts:1186-1194`).

---

## 4. Pedir ayuda al usuario solo cuando hace falta (UX de mapeo mínima)

- **Actual:** el import muestra la vista previa ya parseada; los interruptores son pocos y **concretos**: "invertir
  montos", "columna entrada/salida con valor X", "multiplicador", "usar memo si falta el pagador"
  (`utils.ts:206-278 parseAmountFields`; `fallbackMissingPayeeToMemo` en
  `loot-core/src/server/transactions/import/parse-file.ts:96, 259`). Este último es literalmente nuestro caso de los
  2 abonos de $250.000 "sin Nombre", resuelto como opción explícita y no como filtro escondido.
- **Maybe:** pasos separados: subir → configurar → **limpiar** (cada fila inválida se edita en línea; no se puede
  publicar hasta que `rows.all?(&:valid?)`) → confirmar con `dry_run` (conteos antes de escribir) → publicar, y el
  import completo se puede **revertir** (`app/models/import.rb:56-96, 110-122, 186-191`).
- **hledger:** el error dice qué fila, qué regla y qué cambiar (`RulesReader.hs:1760-1780`).
- **¿massDTE?** Tenemos el mapeador de zonas completo (`FieldMapper.tsx`), pero es "todo o nada": o la heurística
  acierta o el cliente mapea todo.
- **La idea:** preguntar **solo la duda**, con los datos del cliente a la vista. Ej.: "Encontramos dos columnas con
  plata que nunca se llenan juntas. ¿Cuál es la que entra?" (dos botones con 3 montos de ejemplo cada uno); o
  "Esta columna trae montos como '250,000' ¿son doscientos cincuenta mil?". Encaja con 1.4 (empate entre
  candidatos) y con la tesis del fundador (facilidad). Y el `dry_run` de Maybe ya existe en espíritu en el cuadre:
  mostrar "500 filas con plata · 500 leídas" **antes** de mandar a la mesa.
- **Valor/costo:** alto / medio (UI).

---

## 5. Movimiento canónico independiente de la fuente

- **open-banking-chile:** `BankMovement { date, description, amount (con signo: + abono, − cargo), balance (saldo
  después), source, owner?, card?, installments?, totalAmount? }` (`src/types.ts:19-38`). Además, para BCI **no lee
  la tabla**: intercepta el JSON del propio backend del banco (`src/intercept.ts`, `src/banks/bci.ts:16, 399-432`) —
  la fuente más estable que existe, porque es la API interna y no el diseño de la pantalla.
- **beangulp:** cada transacción lleva `filename` + `lineno` en metadata (`csvbase.py:464`); Frictionless igual por
  celda.
- **¿massDTE?** Casi: `PreExtractedMovimiento` (`types.ts:142-156`) tiene fecha, glosa, monto, tipo, `excel_row`,
  `saldo`. Falta: **cuenta**, **ocurrencia** (3.4), **hoja**, y el **texto crudo** de las celdas de monto/fecha
  (para auditar un "250,000").
- **Scraping/extensión al banco:** lo anoto como dirección, no como recomendación: tenemos una extensión de Chrome
  para el SII; una para el banco leería el JSON como open-banking-chile. Implica credenciales bancarias, términos de
  uso de cada banco y la Ley 21.719 — **no verificado** su encaje legal; hoy no lo haría.

---

## 6. LLM que GENERA el lector (una vez por formato) y el código lo valida

- **Lo que hay:** Evaporate (1.4) genera funciones y las puntúa; bankstatementparser usa LLM/visión solo como
  respaldo cuando ningún parser determinista calza (`hybrid/orchestrator.py:333-348`); Inscribe (blog) usa el LLM
  para extraer campos directo, sin generar parsers (no aporta técnica). statement-tieout (ya visto) pide al modelo
  un **perfil de layout**, no filas.
- **Para nosotros:** la memoria dice que la "IA revisora de formato" se cortó porque "saldo + perfil bastan". Estoy de
  acuerdo para cartolas con saldo: el buscador de 1.4 **es** síntesis de programas sin LLM, y el saldo es mejor juez.
  Donde sí tendría sentido: formato nuevo **sin saldo** y sin encabezado reconocible (hoy cae a capa 4 = IA leyendo
  el Excel como texto). Ahí el modelo recibiría **solo títulos + firma de símbolos por columna + 3 filas con la glosa
  tokenizada** (sin RUT/nombres, regla PII vigente) y devolvería un `AdapterConfig` en JSON estricto; el código lo
  aplica y lo acepta solo si el **censo independiente** (2.1) cuadra al 100% y el cliente confirma con la pregunta
  mínima (4). Nunca compartido entre empresas sin saldo. **Valor/costo:** medio / medio. Primero 2.1 y 1.4, que son
  su verificador.

---

## 7. Probar que el lector aguanta cambios de formato (idea nueva)

- **Sanitizar cartolas reales en vez de reconstruirlas (beancount-import):** `jbms/beancount-import` trae un
  `*_sanitize.py` por fuente que reemplaza lo identificatorio de un extracto real para convertirlo en fixture público
  (`beancount_import/source/ofx_sanitize.py:1-80`). Nuestros fixtures de bancos son **sintéticos reconstruidos** con
  `aoa_to_sheet` (`bancos-reales.test.ts:28-34`): pierden celdas combinadas (la Cartola N°02 real tiene 2.739), la
  fórmula SUMA, los formatos `#,##0` y los montos-texto. Un sanitizador que conserve **todo menos el texto** (glosas y
  nombres → tokens, RUT → RUT válido falso, montos y saldos **intactos** para que la ecuación siga cerrando) daría
  fixtures fieles de cada banco. *Valor alto · costo bajo.*
- **Mutaciones de FORMATO (metamórficas):** el informe anterior propuso mutar **datos** (fila perdida, duplicada).
  Esto es lo otro, y es exactamente la frase de Matías: sobre cada fixture sanitizado, generar variantes —
  cambiar una letra de cada título, quitar tildes, mover una columna, insertar una columna vacía o "Nombre",
  borrar la columna de glosa, agregar 3 filas de basura arriba, invertir el orden, pasar montos a texto con
  `"250,000"`, agregar una fila "TOTAL" en medio, combinar celdas — y exigir para **cada** variante: mismas N filas y
  mismo Σabonos/Σcargos, **o** alarma explícita (nunca menos filas en silencio). Los hallazgos 0.1-1 y 0.1-2 los
  habría cazado esta batería el primer día. *Valor muy alto · costo bajo.*

---

## 8. Tabla cruzada

| Técnica | Quién (evidencia) | massDTE hoy |
|---|---|---|
| Columnas por contenido (fecha/monto/saldo) | Pytheas, Frictionless | **Sí**, y mejor que las apps de finanzas |
| Orientación cargo/abono por ecuación del saldo | tieout, docket | **Sí** (`saldo-cuadre.ts`) |
| Firma de símbolos por columna | Pytheas rules | No |
| Tipo por formato de celda Excel (`cell.z`) | TableSense (features) | No |
| Formato de número decidido por columna | Maybe `import.rb:8`, HisaabFlow detector | **No — bug "250,000"→250** |
| Búsqueda global de asignaciones + verificador | Evaporate (con LLM) | No (decisiones codiciosas) |
| Nada se descarta sin regla explícita / falla ruidosa | hledger, beangulp, Actual | Parcial: censo, pero **atado al mapeo** |
| Censo independiente del mapeo | (derivado) | No |
| Fórmula SUMA del banco como rango y total | (verificado en Santander) | No |
| "Total" por estructura, no por palabra | Pytheas | **No — bug del bloque resumen pegajoso** |
| Validar cada fila contra el esquema | Frictionless errors | Parcial |
| Mapeo por nombre + alias, falla con lista de nombres | beangulp, Actual, Maybe | No (índices) |
| Huella difusa + diff de formato | HisaabFlow (puntaje) | No (hash exacto) |
| Mapeo recordado por cuenta | Actual, Maybe | Por huella + empresa (bien), sin cuenta |
| Continuidad saldo entre cartolas | hledger, beancount, bankstatementparser | No |
| Dedup con ocurrencia / uno-a-uno / saldo en la clave | YNAB, Actual, open-banking-chile | **No (muchos-a-uno)** |
| Pregunta mínima al usuario / dry run / revertir | Actual, Maybe | Mapeador completo; cuadre después |
| Movimiento canónico con cuenta y origen | open-banking-chile, beangulp | Casi (falta cuenta/ocurrencia) |
| Fixtures sanitizados de archivos reales | beancount-import | No (sintéticos reconstruidos) |
| Mutaciones de formato | — (nadie lo hace; derivado) | No |

---

## 9. Las 5 ideas más valiosas (★ = no se nos había ocurrido)

1. **★ Batería de mutaciones de formato sobre cartolas reales sanitizadas** (§7). Es la respuesta literal a "si el banco
   cambia una letra o mueve una columna": convertirlo en un test que corre en cada cambio. Primero sanitizar las
   cartolas reales que ya tenemos (conservando celdas combinadas, fórmulas, formatos y montos), después generar
   ~15 variantes por archivo y exigir "mismas filas y sumas, o alarma". Habría cazado los dos bugs de §0.1. *Valor
   muy alto · costo bajo.*
2. **★ Censo independiente del mapeo + la fórmula SUMA del banco** (§2.1, §2.2). Contar las filas con plata **sin mirar
   el mapeo** (cualquier columna) y, cuando exista, usar el rango de `=SUM(A13:A250)` como censo escrito por el
   propio banco (verificado: 238 = 238 en Santander). Cierra el hueco de fondo: hoy el censo cuenta con los mismos
   ojos con que leyó. *Valor muy alto · costo bajo.*
3. **Arreglar los dos bugs verificados** (§0.1): "TOTAL" en una glosa apaga el censo del resto del archivo, y
   `"250,000"` se lee como $250. El segundo con formato de número decidido **por columna** mirando todas sus celdas;
   si es ambiguo, a revisión, nunca adivinar. *Valor alto · costo muy bajo.*
4. **★ Mapeo por nombre + huella difusa + aviso de diff** (§3.1, §3.2). Guardar título normalizado junto al índice;
   si la huella exacta no calza, buscar el formato propio más parecido, re-mapear por nombre, **re-verificar** con
   saldo y censo, y avisar "tu banco cambió X por Y, seguimos leyendo igual". Conserva el mapeo manual del cliente
   ante una letra cambiada. *Valor alto · costo medio.*
5. **★ Dedup con ocurrencia (YNAB) y continuidad de saldo entre cartolas (hledger/beancount)** (§3.3, §3.4). La clave
   `fecha|monto|tipo|N-ésima ocurrencia` (+ saldo si existe) empareja uno a uno y no se come los P2P repetidos reales;
   y guardar cuenta + saldo inicial/final por cartola permite detectar el mes que falta, la cartola repetida y el
   solape sin leer filas. *Valor alto · costo bajo (dedup) / medio (continuidad).*

Menciones que no entran al top pero valen: búsqueda global de asignaciones con el saldo como juez (§1.4, es la
"síntesis de programas" sin LLM), tipar por formato de celda Excel (§1.2), pregunta mínima en vez de mapeador completo
(§4), verificar `single_col` con saldo y no tener banderas de una letra globales (§0.1).

**Lo que NO recomiendo:** Sherlock/TableSense como dependencias (pesados, y nuestras reglas por contenido ya cubren
5 roles); archivos de configuración por banco escritos a mano (bank2ynab trae 125 secciones, HisaabFlow igual: es
justo el modelo que se rompe con una letra); fallar el import completo ante una fila mala como hledger/Actual (para
un contador es peor que nuestro censo con motivo); LLM generando código ejecutable del parser (el `AdapterConfig` JSON
ya es un "programa" chico y verificable; código libre abre un riesgo sin ganancia).

---

## 10. Fuentes (código leído)
- https://github.com/actualbudget/actual — `packages/desktop-client/src/components/modals/ImportTransactionsModal/{ImportTransactionsModal.tsx,utils.ts}`, `packages/loot-core/src/server/accounts/sync.ts`, `…/transactions/import/parse-file.ts`
- https://github.com/firefly-iii/data-importer — `app/Services/CSV/Converter/BankDebitCredit.php`, `app/Services/Shared/Configuration/Configuration.php`, `app/Services/Shared/Import/Routine/ApiSubmitter.php`
- https://github.com/maybe-finance/maybe — `app/models/import.rb`, `app/models/import/row.rb`
- https://github.com/simonmichael/hledger — `hledger-lib/Hledger/Read/RulesReader.hs`, `LatestDates.hs`
- https://github.com/beancount/beangulp — `beangulp/importers/csvbase.py`, `beangulp/similar.py`
- https://github.com/jbms/beancount-import — `beancount_import/source/ofx_sanitize.py`, `ofx.py`
- https://github.com/bank2ynab/bank2ynab — `bank2ynab/dataframe_handler.py`, `bank2ynab/data/bank2ynab.conf`
- https://github.com/reubano/csv2ofx — `csv2ofx/__init__.py` (id = hash del contenido; no aporta)
- https://github.com/egh/ledger-autosync — dedup por FITID de OFX (no aporta para Excel)
- https://github.com/kaihv/open-banking-chile — `src/types.ts`, `src/utils.ts`, `src/intercept.ts`, `src/banks/bci.ts`, `src/actions/extraction.ts`
- https://github.com/ammar-qazi/HisaabFlow — `backend/core/bank_detection/bank_detector.py`, `backend/shared/amount_formats/amount_format_detector.py`, `configs/Meezan.conf`
- https://github.com/sebastienrousseau/bankstatementparser — `bankstatementparser/hybrid/{verification,orchestrator}.py`, `additional_parsers.py`
- https://github.com/benjamin-awd/StatementSensei — interfaz sobre monopoly (ya investigado)
- https://github.com/cchristodoulaki/Pytheas — `pytheas/rules/*.csv`, `src/pytheas/table_classifier_utilities.py`; paper http://www.vldb.org/pvldb/vol13/p2075-christodoulakis.pdf
- https://github.com/frictionlessdata/frictionless-py — `frictionless/detector/detector.py`, `frictionless/errors/{row,cell}.py`
- https://github.com/okfn/messytables — `messytables/headers.py`, `messytables/types.py`
- https://github.com/HazyResearch/evaporate — `evaporate/profiler.py`
- https://github.com/mitmedialab/sherlock-project — `sherlock/features/`
- https://github.com/microsoft/TableSense — solo dataset/README (sin código del modelo)
- Auto-Tables: https://arxiv.org/abs/2307.14565, https://github.com/LiPengCS/Auto-Tables-Benchmark (no clonado)
- Inscribe: https://www.inscribe.ai/blog/how-llms-boosted-our-bank-statement-parsing-coverage-by-up-to-5x (sin técnica útil)
