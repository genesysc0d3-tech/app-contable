# Investigación: cómo aprenden de las correcciones los que lo hacen bien — 2026-09-30

> Pregunta (fundador): tenemos 44 mapas de columnas aprendidos por la heurística, reusados 200 veces, **ninguno
> confirmado por una persona** y solo 18 con saldo que los compruebe. "No inventemos el hilo negro, siempre hay algo
> que aprender": ¿cómo cierran el ciclo **proponer → confirmar/corregir → aprender → reusar → detectar que cambió →
> volver a preguntar** los sistemas que sí lo hacen bien, y cómo evitan aprender sus propios errores?
>
> Método: primero leí nuestro código (archivo:línea). Después cloné y leí código real en
> `scratchpad/repos-adaptativo/_correcciones/` (nada dentro del proyecto): paperless-ngx, invoice2data, smart_importer
> (beancount), GnuCash (import matcher), OCA bank-statement-import, Odoo `account`, Unstract, docling. Para los
> comerciales (Rossum, Nanonets, Azure Document Intelligence, Sensible, Klippa, Docparser) leí su documentación
> pública: eso va marcado **no verificado en código**.
>
> Base de las cifras: "44 mapas / 200 reusos / 0 confirmados / 18 con saldo" = **me lo dijiste**; intenté
> re-contarlo en Supabase y el MCP no tiene permiso sobre `xncnfrwarcrzgldalkzz`, así que **no lo verifiqué**.
> No repito lo ya cubierto en `investigacion-lector-cartolas-2026-09-30.md` (huella difusa, alias por nombre,
> continuidad hledger, etc.) salvo cuando aporta un ángulo nuevo sobre *aprender*.

---

## 0. Nuestro ciclo hoy (leído en el código, verificado)

| Paso del ciclo | Qué hacemos | Dónde |
|---|---|---|
| Proponer | Heurística/nombres derivan un mapa; si pasa el validador se usa **y se guarda** en el mismo acto | `orchestrator.ts:163-199`, `:203-240` |
| Confirmar | **No existe** como paso. El único humano es el mapeador manual (`FieldMapper`), que se abre cuando algo falla | `api/parser/save-mapping/route.ts:90-95` |
| Aprender | `saveAdapter` nace con `confianza: 1.0, usage_count: 1, success_count: 1` — **igual que un manual** | `adapter-store.ts:170-180` (manual: `:126`, `:142`) |
| Juez | El validador (filas>0, fechas creíbles, montos>0, saldo si hay). Si no hay saldo, un mapa con cargo/abono invertidos pasa | `validator.ts:34-137` |
| Reusar | Capa 0 por huella; cada reuso que pasa el validador **sube** la confianza +0.05 | `orchestrator.ts:125-129`, `adapter-store.ts:195-221` |
| Compartir | Derivado sin saldo queda privado de la empresa (bien); con saldo, global | `orchestrator.ts:371-397` |
| Detectar cambio | Huella por fila de títulos: cambia un título → huella nueva → se re-adivina en silencio. Si el caché falla el validador: −0.25 y a los <0.5 se apaga 60 min | `fingerprint.ts:20-31`, `adapter-store.ts:224-257` |
| Volver a preguntar | Solo si cae a capa 4 (alarma `parser_cayo_a_ia`) o evento `parser_formato_nuevo` a ops, **no al cliente** | `orchestrator.ts:380-396`, `:399-420` |

**El diagnóstico en una línea:** llamamos "éxito" a "el validador no protestó", y eso lo sumamos como si fuera
evidencia. Es exactamente lo que *todos* los sistemas de abajo evitan: **la predicción propia nunca se escribe de
vuelta como verdad**.

Detalle importante que ya tenemos y no estamos usando: la cadena
`parser_logs(documento_id, adapter_id) → movimientos_raw(documento_id) → propuestas_ia(movimiento_id, estado)`
existe (tipos en `database.types.ts`). O sea, **ya sabemos qué mapa produjo qué movimiento y si el cliente lo
aprobó o lo editó**. Es el juez implícito que nos falta (ver §3, idea 1).

---

## 1. Open source leído en código

### 1.1 paperless-ngx — "matching automático" (verificado)

- **Qué hace:** clasificador (MLP de sklearn) que propone corresponsal, tipo, etiquetas y ruta de guardado para cada
  documento nuevo.
- **Verdad = lo que la persona dejó de tocar.** Todo documento nuevo nace con la etiqueta *inbox*
  (`signals/handlers.py:83-93`, `models.py:108-114`: "All newly consumed documents will be tagged with inbox tags").
  El entrenamiento **excluye todo lo que sigue en el inbox**: `Document.objects.exclude(tags__is_inbox_tag=True)`
  (`classifier.py:338-340`). Sacar un documento del inbox = "lo revisé". Nada que el sistema propuso cuenta hasta
  que una persona lo "suelta".
- **Solo aprende de lo marcado AUTO:** la etiqueta de entrenamiento es el pk solo si
  `matching_algorithm == MATCH_AUTO`; si no, `-1` (`classifier.py:380-404`). Lo que el usuario fijó con regla
  explícita no contamina el modelo y viceversa.
- **Cómo guarda:** reentrena **desde cero** sobre toda la base (no incremental); detecta si hace falta con un hash de
  las etiquetas + la última fecha de modificación (`classifier.py:360-427`). Consecuencia: si corriges un documento,
  el error viejo **desaparece** en el próximo entrenamiento; no queda "sumado".
- **Anti-error:** umbral de probabilidad: bajo `CLASSIFIER_MATCH_THRESHOLD` (0.3 por defecto,
  `paperless/settings/__init__.py:98-103`) **no asigna nada** (`classifier.py:47-63`). Balancea clases con
  `compute_sample_weight` para que el corresponsal frecuente no se coma a los demás (`classifier.py:448-455`).
- **Drift:** no hay detector explícito; lo resuelve el reentreno completo desde la verdad vigente.
- **¿Qué nos llevamos?** ★ El concepto de **bandeja**: un mapa derivado queda "en bandeja" hasta que un humano suelta
  el documento. Solo lo soltado es evidencia. Y la idea de **recalcular la confianza desde la evidencia** (conteo de
  confirmaciones) en vez de acumular deltas.

### 1.2 GnuCash — import matcher bayesiano (verificado)

- **Qué hace:** al importar un extracto, propone la cuenta contraparte con Bayes sobre tokens de la glosa.
- **Verdad = selección MANUAL.** `gnc_import_TransInfo_set_destacc(info, acc, selected_manually)` solo escribe en el
  MatchMap `if (selected_manually)` (`import-backend.cpp:217-230`). La propuesta automática se asigna con
  `selected_manually = false` (`import-backend.cpp:1141-1144`) y **nunca se guarda**. La otra vía que guarda es cuando
  el usuario acepta un *match* con una transacción existente (`:872-873`).
- **La UI distingue** "(manual)" de lo propuesto (`import-main-matcher.cpp:2040-2045`): el usuario ve qué es opinión
  de la máquina.
- **Tres bandas, no dos:** `probability >= clear_threshold` → conciliar solo; `<= add_threshold` → nuevo; entre
  medio → *skip/update*, o sea **no decide** (`import-backend.cpp:1170-1195`).
- **Presets de CSV:** el mapeo de columnas del importador CSV es un **preset con nombre que la persona guarda
  explícitamente** desde la vista previa, con las filas con error marcadas en la tabla
  (`csv-imp/assistant-csv-trans-import.cpp:901-935`, `:1419-1430`).
- **¿Qué nos llevamos?** ★ La regla de oro en una línea de código: **`if (selected_manually) store()`**. Y la banda
  del medio: entre "seguro" y "no sé" hay un "pregunta".

### 1.3 smart_importer (beancount) — aprende del libro (verificado)

- **Qué hace:** predice cuenta/contraparte de transacciones importadas.
- **Verdad = el libro ya confirmado.** No tiene base de modelo propia: en cada importación entrena con
  `existing_entries` (el ledger que la persona revisó y commiteó) (`predictor.py:87-122`). README:268: las
  predicciones se deben revisar "before committing them to the ledger".
- **Anti-error:** `training_data_filter` descarta transacciones con cuentas cerradas o en `denylist_accounts`
  (`predictor.py:165-179`) — típicamente cuentas "por clasificar". Lo *no decidido* no es ejemplo.
- **Drift:** reentrena cada vez desde la verdad actual; lo corregido en el libro corrige el modelo.
- **¿Qué nos llevamos?** La **memoria es un derivado de los datos confirmados**, no un registro aparte que se
  alimenta de sí mismo. Para nosotros: la confianza de un mapa debería poder **recalcularse** desde los movimientos
  aprobados que produjo.

### 1.4 invoice2data — plantillas por emisor (verificado)

- **Qué hace:** plantilla YAML por emisor (keywords + regex por campo).
- **Proponer ≠ guardar:** el borrador heurístico (`extract/suggestions.py`: "suggestions … never authoritative
  extraction") o con IA se muestra con una **vista previa de los VALORES capturados** y solo se escribe tras
  `click.confirm("Write template to …?")` (`__main__.py:216-268`).
- **Plantilla que calza pero no extrae lo requerido = falla:** `_check_required_fields`
  (`extract/invoice_template.py:651-675`). También `exclude_keywords` (`:174-190`): la plantilla dice **cuándo NO
  aplica**.
- **Chequeo aritmético advisory:** suma de impuestos por tasa vs `amount_tax` (`:587-611`).
- **¿Qué nos llevamos?** ★ Confirmar mostrando **valores, no columnas**: "¿Estos 3 movimientos están bien? 12-09
  Transf. Juan +$150.000 …" es algo que un cliente puede juzgar; "Columna F = abono" no.

### 1.5 OCA `account_statement_import_sheet_file` + Odoo `account` (verificado)

- **Mapa por NOMBRE y ligado a la cuenta bancaria:** `default_sheet_mapping_id` en el diario
  (`models/account_journal.py:11-13`); columnas por título, `header.index(nombre)` (`wizard/…_parser.py:122-148`).
  Si el banco renombra la columna, **revienta** (ValueError) en vez de adivinar: drift ruidoso.
- **Saldos inicial/final del extracto:** si hay columna saldo, arma `balance_start`/`balance_end_real`
  (`…_parser.py:104-112`).
- **Dos integridades en Odoo** (`account_bank_statement.py:80-95`, `:217-220`): `is_complete` = interna (suma de
  líneas = final − inicial); `is_valid` = **externa** (inicial = final del extracto anterior). Y una vez completo y
  válido, **no se pueden borrar líneas** (`account_bank_statement_line.py:494-498`).
- **Reglas de conciliación** con `trigger` manual/automático (`account_reconcile_model.py:109-116`): una regla
  empieza sugiriendo y el usuario la pasa a automática (`action_set_auto_reconcile`, `:213-214`).
- **¿Qué nos llevamos?** El **ascenso explícito sugerir → automático**. Y el juez externo de continuidad para las
  cartolas sin columna saldo (ya propuesto en el doc anterior §3.3; acá el aporte es que en Odoo es un *estado del
  extracto*, visible y que bloquea).

### 1.6 Unstract (verificado parcialmente) y docling (doc oficial)

- **Unstract:** la revisión manual es un plugin cerrado; en OSS hay un servicio nulo con la forma de la config:
  `review_percentage`, `rule_logic`, `q_file_no_list` (`workers/shared/utils/manual_review_factory.py:60-80`). O sea:
  **muestreo aleatorio de un % de archivos a revisión + reglas**. También "LLM challenge": un segundo modelo desafía
  la extracción antes de evaluarla (`workers/tests/test_table_lineitem_challenge_eval.py:1-15`). La lógica real está
  en el plugin: **no verificado**.
- **docling:** no aprende de correcciones, pero da **notas de confianza** por página y documento con `low_grade` =
  percentil 5 ("highlights worst-performing areas") (`docs/concepts/confidence_scores.md`). Idea: juzgar por el
  peor pedazo, no por el promedio.
- **¿Qué nos llevamos?** ★ **Muestreo de auditoría**: aunque el mapa esté "seguro", pedir confirmación a una fracción
  pequeña de los reusos. Es la única forma de descubrir errores que el validador no ve.

---

## 2. Comerciales (documentación pública — **no verificado en código**)

| Sistema | Mecanismo según su doc | Señal de verdad | Anti-error / drift |
|---|---|---|---|
| **Nanonets** (Instant Learning) | Aprende de correcciones al instante | **Solo archivos aprobados**; con reentreno selectivo, solo los *verificados* | Lo dicen explícito: "not every approved file is necessarily reviewed, which can introduce incorrect data into training" → elegir a mano qué entra. "Lesser but 100% correct training data". Plantilla nueva → marcada a revisión (umbral 85). ([doc](https://docs.nanonets.com/docs/model-re-training), [doc](https://docs.nanonets.com/docs/instant-learning-model-training-and-best-practices)) |
| **Rossum** (Aurora) | Aprende de cada documento **confirmado o exportado** en la cola; conocimiento acotado a la cola | Confirmación humana en la pantalla de validación | Umbral de confianza por campo o por cola; **automation blockers** (reglas matemáticas, campo requerido vacío, score bajo); niveles *Never / Confident / Always*; chequeos contra el **historial confirmado del mismo proveedor**. ([doc](https://knowledge-base.rossum.ai/docs/data-capture-automation-with-rossum), [glosario](https://knowledge-base.rossum.ai/docs/glossary)) |
| **Azure Document Intelligence** (incremental classifier) | Reentreno incremental con `baseClassifierId` | Muestras etiquetadas nuevas | **Crea un modelo NUEVO y deja el anterior intacto**; se recomienda reentrenar cuando "classifier confidence is low" o llega plantilla nueva. ([doc](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/incremental-classifier?view=doc-intel-4.0.0)) |
| **Sensible** | Config por tipo; "fingerprint" = tests de texto que eligen la config | Autor de la config | Por defecto basta 50% de los matches en archivo suelto, 100% en portafolio. ([doc](https://docs.sensible.so/docs/fingerprint)) |
| **Klippa** | HITL por confianza baja o campo faltante; "cada corrección entrena" | Corrección humana | Revisión extra por riesgo (p. ej. país). Un comparativo dice que la corrección **no reentrena al tiro**. (marketing, poca doc técnica) |
| **Docparser** | "Layout models" + reglas de ruteo para elegir layout | Autor de reglas | Doc 403 al fetch: **no pude leerla**. |

Patrón común de los comerciales: **(1)** solo aprende lo *aprobado por humano*; **(2)** confianza por **campo**, no
por documento; **(3)** automatizar es un **nivel que se sube**, no el default; **(4)** los modelos se **versionan**
en vez de sobrescribirse.

---

## 3. Tabla comparativa

| | Señal de verdad | ¿Guarda su propia predicción? | Cómo guarda | Drift / cambio | Anti-refuerzo | Nosotros hoy |
|---|---|---|---|---|---|---|
| paperless-ngx | Documento fuera del inbox | No | Reentreno completo | Reentreno | Umbral 0.3, excluye inbox | Guardamos al tiro |
| GnuCash | `selected_manually` | **No (explícito)** | MatchMap bayesiano | — | Tres bandas | Confianza 1.0 al nacer |
| smart_importer | Libro commiteado | No | Nada: re-entrena cada vez | Implícito | denylist "por clasificar" | Registro aparte que se auto-alimenta |
| invoice2data | `confirm()` tras preview de valores | No | YAML | Required fields fallan | exclude_keywords | Mapeador por índices |
| OCA/Odoo | Usuario asigna mapeo al diario | No | Mapping por nombre | Revienta si falta columna | is_complete / is_valid, bloqueo | Huella nueva → re-adivina callado |
| Unstract | Revisor (plugin) | ? | ? | ? | **% aleatorio a revisión** | 0% auditado |
| Nanonets | Aprobado → verificado | No | Modelo | Plantilla nueva a revisión | Selección manual del set | — |
| Rossum | Confirmado/exportado | No | Modelo por cola | — | Blockers + historial | Validador sí, historial no |
| Azure DI | Muestras etiquetadas | No | **Modelo nuevo, viejo intacto** | Reentrenar si confianza baja | Versionado | UPDATE en sitio |

La columna "¿guarda su propia predicción?" es la que duele: **todos dicen que no; nosotros sí**.

---

## 4. Lista priorizada de ideas (valor / costo)

Costo: S = horas, M = 1-2 días, L = semana+. Ninguna requiere IA ni gasto (regla "gratis hasta que haya cliente").

1. **★ Separar "derivado" de "confirmado" y dejar de premiar reusos sin juez** — valor ALTO, costo S.
   (GnuCash `if (selected_manually)`, paperless inbox.) Un mapa derivado nace con `confianza` < 1.0 (p. ej. 0.7) y
   estado `provisorio`; `incrementAdapterSuccess` solo suma si el reuso además **cuadró por saldo**; sin saldo cuenta
   el uso pero no sube la confianza. Cambio chico en `adapter-store.ts:170-221` + `orchestrator.ts:125-129`.
   Migración: una columna `estado` (`provisorio | confirmado_saldo | confirmado_humano`) — respaldo antes.

2. **★ Juez implícito: el cliente aprobando lo que el mapa produjo** — valor ALTO, costo M.
   (paperless "salió del inbox", Rossum "confirmado/exportado", smart_importer "libro commiteado".) Ya existe la
   cadena `parser_logs → movimientos_raw → propuestas_ia.estado`. Regla: si ≥N movimientos de un documento leído con
   el mapa X quedaron `aprobado` **sin editar monto/fecha/tipo**, el mapa X pasa a `confirmado_humano`. Si el cliente
   edita el **signo o el monto** en varios movimientos del mismo documento → el mapa baja y se marca sospechoso.
   *No verificado:* si `editado` distingue qué campo cambió; hay que mirarlo antes.

3. **★ Confirmación de un toque mostrando valores, la primera vez** — valor ALTO, costo M.
   (invoice2data preview + confirm; Nanonets "plantilla nueva → revisión".) Cuando una huella es nueva y **no** la
   confirma el saldo, en vez de solo un evento a ops, la card del documento muestra 3 movimientos de muestra (uno de
   entrada, uno de salida, el de mayor monto) con "¿Se ve bien? Sí / Corregir". "Sí" = `confirmado_humano`;
   "Corregir" abre el `FieldMapper`. Donde el cliente está mirando, no en ops (regla "imaginarse ser el cliente").

4. **Tres bandas en vez de dos** — valor MEDIO, costo S. (GnuCash clear/add threshold; Rossum Never/Confident/Always.)
   Confirmado → se aplica callado. Provisorio → se aplica **y** se muestra la franja "formato nuevo, revisa 3
   movimientos". Sin mapa ni heurística → mapeador. Hoy solo existen "callado" y "falló".

5. **★ Muestreo de auditoría de mapas confirmados** — valor MEDIO, costo S. (Unstract `review_percentage`.) 1 de cada
   ~20 reusos de un mapa sin saldo pide la confirmación de un toque de la idea 3. Es la única forma de pillar un
   error que el validador no ve (cargo/abono invertidos sin saldo). Barato si la idea 3 existe.

6. **Versionar el mapa en vez de sobrescribirlo** — valor MEDIO, costo S-M. (Azure: modelo nuevo, viejo intacto.)
   `upsertManualAdapter` hace UPDATE en sitio (`adapter-store.ts:117-133`): se pierde qué mapa leyó qué documento
   antes. Guardar versión nueva + `reemplaza_a`; `parser_logs.adapter_id` apunta a la versión exacta. Permite decir
   "estos 4 documentos se leyeron con la versión mala, ¿los re-leemos?".

7. **Confianza recalculada desde la evidencia, no acumulada** — valor MEDIO, costo M. (paperless reentreno desde cero,
   smart_importer.) Una vista/función `confianza = f(confirmaciones humanas, cuadres por saldo, correcciones)` sobre
   `parser_logs` + propuestas, en vez de ±0.05/−0.25 que dependen del orden de llegada. Un error inicial deja de
   "repetirse con más fuerza".

8. **Que el drift pregunte, no adivine callado** — valor MEDIO, costo S-M. (OCA revienta si falta una columna.)
   Cuando la huella de una empresa **cambia** pero se parece a un mapa confirmado de esa misma empresa (misma
   cantidad de columnas y la mayoría de títulos igual), no re-derivar en silencio: aplicar el confirmado mapeado por
   nombre y pedir el "¿se ve bien?" de la idea 3. (Complementa la huella difusa del doc anterior §3.2.)

9. **Historial del mismo emisor como chequeo** — valor BAJO-MEDIO, costo M. (Rossum history-based checks.) Para una
   empresa, la proporción de entradas/salidas y el monto mediano de sus cartolas pasadas confirmadas; si la nueva
   se sale mucho (p. ej. 95% entradas cuando siempre fue 50/50) → banda del medio. Hoy `warn_extreme_ratio` es
   absoluto, no relativo a la historia (`validator.ts:131-137`).

10. **Juzgar por el peor pedazo** — valor BAJO, costo S. (docling `low_grade` percentil 5.) En el cuadre por saldo,
    además del % global, mirar el peor tramo contiguo: 20% de falla concentrado al final = cambio de formato a mitad
    del archivo, no ruido.

**Orden sugerido:** 1 → 3 → 2 → 5. Con 1 dejamos de reforzar errores hoy mismo; 3 crea el juez explícito; 2 lo
cosecha gratis de lo que el cliente ya hace; 5 mantiene honesto lo confirmado.

---

## 5. Lo que ellos hacen mejor que nosotros (humildad)

- **Todos** separan "lo que la máquina propuso" de "lo que una persona validó". Nosotros los mezclamos en
  `confianza`.
- Nanonets lo admite por escrito: aprobar no es revisar. Nuestro "pasó el validador" es todavía menos que aprobar.
- GnuCash y Rossum tienen una zona "no decido". Nosotros decidimos siempre.
- Azure y paperless pueden **reconstruir** lo aprendido desde la verdad; nosotros solo podemos acumular.
- Lo que sí hacemos bien y ellos no: el saldo corrido como juez matemático (ninguno de los OSS lo usa para decidir si
  confía en un mapa) y el aislamiento cross-tenant de lo no verificado (`orchestrator.ts:371-397`).

## 6. Fuentes

Código (clonado en `scratchpad/repos-adaptativo/_correcciones/`):
paperless-ngx `src/documents/classifier.py`, `signals/handlers.py`, `models.py`, `src/paperless/settings/__init__.py` ·
GnuCash `gnucash/import-export/import-backend.cpp`, `import-main-matcher.cpp`, `csv-imp/assistant-csv-trans-import.cpp` ·
smart_importer `smart_importer/predictor.py`, `README.rst` ·
invoice2data `src/invoice2data/__main__.py`, `extract/invoice_template.py`, `extract/suggestions.py`, `extract/template_builder.py` ·
OCA bank-statement-import `account_statement_import_sheet_file/wizard/account_statement_import_sheet_parser.py`, `models/account_journal.py` ·
Odoo `addons/account/models/account_bank_statement.py`, `account_bank_statement_line.py`, `account_reconcile_model.py` ·
Unstract `workers/shared/utils/manual_review_factory.py`, `workers/tests/test_table_lineitem_challenge_eval.py` ·
docling `docs/concepts/confidence_scores.md`.

Documentación (no verificado en código):
[Nanonets retraining](https://docs.nanonets.com/docs/model-re-training) ·
[Nanonets instant learning](https://docs.nanonets.com/docs/instant-learning-model-training-and-best-practices) ·
[Rossum automation](https://knowledge-base.rossum.ai/docs/data-capture-automation-with-rossum) ·
[Rossum glosario](https://knowledge-base.rossum.ai/docs/glossary) ·
[Azure incremental classifier](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/incremental-classifier?view=doc-intel-4.0.0) ·
[Sensible fingerprint](https://docs.sensible.so/docs/fingerprint) ·
[Klippa HITL](https://www.klippa.com/en/dochorizon/human-in-the-loop/) ·
Docparser: la página de soporte devolvió 403, no leída.
