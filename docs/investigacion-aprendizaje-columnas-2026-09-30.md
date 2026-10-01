# Investigación: aprender el ROL de las columnas de una cartola (adaptive-classifier y compañía)

Fecha: 2026-09-30 · Estado: experimento, **no se tocó código del producto** · Datos 100 % sintéticos.

**La pregunta.** Cuando el banco cambia el formato (títulos renombrados, en inglés o genéricos, columnas insertadas o movidas, sin títulos), el lector determinístico a veces asigna mal un rol **sin avisar**. ¿Nos sirve un clasificador que aprende de pocos ejemplos y de las correcciones del cliente, como `codelion/adaptive-classifier`? La idea era evaluarlo en serio, sin descartarlo de entrada.

**Respuesta corta.** Como *clasificador de rol completo*, no: por texto no logra distinguir cargo, abono y saldo, y su confianza no alcanza para decidir cuándo preguntar. Pero el experimento dejó **tres aprendizajes concretos** (sección 5), y el que más pesa es este: **el texto solo tiene que decidir el rol "grueso" (fecha / glosa / plata / flag / otro), y la aritmética del saldo reparte los roles dentro de "plata"**. Así resuelve el 95 % de las columnas, pregunta en el 3 % y queda un 1,5 % de errores silenciosos, sin ningún modelo de 470 MB.

Leyenda: **[V]** = verificado (lo leí en el código o lo medí) · **[NV]** = no verificado (inferencia o dicho del README).

---

## 1. Qué es adaptive-classifier

Repo: https://github.com/codelion/adaptive-classifier (Apache-2.0, 572 ★, último push 2026-09-17, commit `b21c2ba`). Lo cloné en el scratchpad, fuera del proyecto.

Es un clasificador de texto que combina tres piezas: un encoder de HuggingFace **congelado**, una **memoria de prototipos** (el promedio de los embeddings de cada clase, indexado con FAISS) y una **cabeza neuronal chica** (un MLP) que se reentrena cada vez que llegan ejemplos nuevos. Se pueden agregar clases y ejemplos en caliente.

### Evidencia en el código (rutas relativas a `src/adaptive_classifier/`)

| Mecanismo | Dónde | Qué hace de verdad | |
|---|---|---|---|
| Agregar ejemplos o clases | `classifier.py:134-202` | Calcula los embeddings, guarda cada `Example` en la memoria, actualiza `training_history` y reentrena la cabeza. Si hay clases nuevas **y** ya existían otras, entra por `_train_new_classes` (`:168`); en cualquier otro caso usa `_train_adaptive_head()` (`:195`). Siempre reconstruye el índice FAISS al final (`:202`). | [V] |
| Aprender de un ejemplo corregido | mismo `add_examples` | No existe una API de "corrección": un ejemplo corregido es simplemente un ejemplo más con la etiqueta buena. El efecto llega por dos lados: (1) mueve el prototipo, que es la media de *todos* los ejemplos de la clase (`memory.py:150`), y (2) dispara un reentreno completo de la cabeza sobre toda la memoria. | [V] |
| Memoria de prototipos | `memory.py:34, 85-136, 138-159` | `IndexFlatL2` de FAISS con un prototipo por clase. Similitud = `exp(-distancia)` (`:117`) seguida de **softmax** entre las clases (`:130`). | [V] |
| Evitar olvidar | `classifier.py:283-305` y `:1490-1584` | EWC (Elastic Weight Consolidation) **solo** se usa cuando llega una clase nueva a un clasificador que ya tenía clases, y con `ewc_lambda=5.0` fijo en el código (`:304`): ignora el `ewc_lambda=100` de la configuración (`models.py:133`). En el camino normal, lo que evita el olvido es el **replay**: se reentrena la cabeza con *todos* los ejemplos guardados (hasta 1000 por clase, `models.py:128`, podados por cercanía a la media, `memory.py:196-217`). | [V] |
| Confianza | `classifier.py:417-470`, `:1248-1260` | Mezcla el puntaje de los prototipos con el softmax de la cabeza. Para clases con menos de 10 ejemplos pesa 0,3 prototipo + 0,7 cabeza (`models.py:150-153`); después, 0,7 + 0,3 (`models.py:146`). El resultado se normaliza para que sume 1 (`:466`). | [V] |
| Embeddings | `classifier.py:1262-1345` | Cualquier modelo de HuggingFace. El pooling (`mean` o `cls`) se lee de la configuración de sentence-transformers del propio modelo. Los vectores se normalizan con L2. | [V] |
| Corre local en Mac | `classifier.py:55` | `device = "cuda" if disponible else "cpu"`: **no usa MPS**, así que en el Mac mini M corre en CPU. ONNX opcional con `optimum` (`:116`). Yo lo corrí en un M1 con Python 3.14 y torch 2.14 sin problemas. | [V] |

**Un defecto de diseño que se nota en las mediciones [V, por cálculo y medido].** Con embeddings normalizados, la distancia L2² queda entre 0 y 4, así que `exp(-d)` queda entre 0,018 y 1, y un softmax sobre números tan juntos sale casi plano. Con 8 clases, el prototipo **nunca** puede dar más de ~0,28 a la mejor clase. Por eso las confianzas medidas viven entre 0,15 y 0,75, aunque la clase sea obvia.

Detalle menor [NV sobre su impacto]: `memory.py:158` hace `remove_ids` sobre un `IndexFlatL2`, que corre los ids. Queda desalineado hasta el rebuild, pero `add_examples` siempre reconstruye al final, así que en la práctica no debería morder.

---

## 2. Cómo lo probé

- **Generador**: el mismo de `scripts/experimento-estructura-deepseek.ts` (5 bancos × 10 sabotajes). Exporté las grillas con `npx tsx` para respetar al pie de la letra su RNG (que en JS pierde precisión sobre 2^53, así que reimplementarlo en Python habría dado otros datos).
- **Documento por columna**: `título | v1 | … | v8`, con los primeros 8 valores y `·` para las celdas vacías. Sin títulos se usa `(sin título)`.
- **Entrenamiento**: solo la variante `base` de **chile, santander y bci** (21 columnas; cubre los 8 roles).
- **Prueba**: los 9 sabotajes de esos 3 bancos (192 columnas, "vistos") y los 10 casos de **estado e itau**, bancos que no vio nunca (132 columnas, "nuevos").
- **Modelos**: `paraphrase-multilingual-MiniLM-L12-v2` (118 M de parámetros, 471 MB) y `all-MiniLM-L6-v2` (23 M, 91 MB).
- **Aritmética**: entre las columnas "de plata" busca S tal que `S[i]−S[i−1] = abono_i − cargo_i`, en ambos sentidos (cubre las cartolas ordenadas de más nueva a más vieja), o `= ±monto` según el flag C/A. Si la aritmética asigna roles, cualquier otra columna que el modelo haya llamado "plata" pasa a `otro` (roles únicos).
- Los scripts quedaron en el scratchpad (`repos-adaptativo/exp*.py`), **no en el repo**.

---

## 3. Resultados medidos [V]

### 3a. Acierto de rol (8 clases)

| Configuración | Vistos (192) | Nuevos (132) | + aritmética, vistos | + aritmética, nuevos |
|---|---|---|---|---|
| adaptive-classifier, multilingüe, **tal cual** (1 `add_examples`) | 67,7 % | 62,9 % | 95,3 % | 92,4 % |
| ídem, `all-MiniLM-L6` | 71,9 % | 54,5 % | 92,7 % | 87,1 % |
| adaptive, multilingüe, **2 reentrenos extra sin información nueva** | 88,0 % | 87,1 % | **100 %** | **100 %** |
| ídem, `all-MiniLM-L6` | 85,4 % | 81,1 % | 99,5 % | 99,2 % |
| Vecino más cercano (coseno) con **los mismos embeddings**, sin la librería | 91,7 % | 80,3 % | — | — |
| Solo prototipos (sin cabeza) | — | 81,1 % | — | — |
| Variante "forma" (dígitos→9, al estilo Sherlock) dentro del embedding | 53,6 % | 40,9 % | 79,2 % | 75,0 % |
| **Sin red neuronal**: TF-IDF de caracteres + regresión logística (70 ms de entrenamiento) | 86,5 % | 83,3 % | — | — |
| **Sin red neuronal**: 10 rasgos de forma + RandomForest, rol **grueso** (fecha/glosa/plata/flag/otro) | 98,4 % | **98,5 %** | — | — |

Por rol, con el multilingüe tal cual en nuevos: fecha 100 %, otro 97 %, glosa 85 %, saldo 67 %, **abono 5 %, cargo 0 %**. Y en vistos: **flag 0 %, monto 0 %**.

**Lectura honesta:**
1. Tal como viene, la cabeza queda **sub-entrenada** con 21 ejemplos: 10 épocas con early stopping (`classifier.py:1490, :1545`). Dos reentrenos extra, sin agregar nada, la suben de 63 % a 87 %.
2. Por texto, **cargo, abono y saldo son casi indistinguibles**. "Cargos (CLP)" en el *mismo* banco del entrenamiento sale como `saldo` apenas cambian los números (`chile/columna_insertada`). "Debit/Credit/Balance" y "Columna 4/5/6" terminan casi siempre en `otro`.
3. **La aritmética arregla prácticamente todo lo que es plata**. Lo que queda son los casos `sin_saldo`, donde no hay ecuación posible, y los errores de glosa vs otro.
4. La maquinaria de la librería (prototipos + cabeza + EWC) **no le gana a un kNN simple** sobre los mismos embeddings, y un TF-IDF de caracteres de 70 ms la empata.

### 3b. Correcciones del cliente (1 a 3 columnas mal leídas de una cartola del banco nuevo)

Se mide contra el resto de las cartolas de ese banco. Punto de partida: el clasificador "saturado" (con los 2 reentrenos extra). **Control** = el mismo reentreno pero sin el ejemplo corregido, para separar el efecto de la información nueva del efecto de entrenar más épocas.

| Corrección (multilingüe) | Antes | 1 corr. | Control | 2 corr. | Control | 3 corr. | Control |
|---|---|---|---|---|---|---|---|
| estado ← títulos en inglés | 89,1 | 90,9 | 87,3 | **72,7** | 89,1 | **74,5** | 89,1 |
| estado ← sin títulos | 85,5 | **67,3** | 85,5 | 80,0 | 87,3 | — | — |
| itau ← títulos en inglés | 92,2 | 90,6 | 92,2 | 93,8 | 92,2 | — | — |
| itau ← sin títulos | 92,2 | 90,6 | 89,1 | 93,8 | 92,2 | — | — |

| Corrección (`all-MiniLM-L6`) | Antes | 1 corr. | Control | 2 corr. | Control | 3 corr. | Control |
|---|---|---|---|---|---|---|---|
| estado ← base | 72,7 | 85,5 | 70,9 | — | — | — | — |
| estado ← sin títulos | 76,4 | 80,0 | 78,2 | **92,7** | 76,4 | 90,9 | 78,2 |
| itau ← sin títulos | 90,6 | 92,2 | 90,6 | 93,8 | 92,2 | 95,3 | 89,1 |

- Una corrección puede **empeorar** el resultado: hasta −18 puntos con el multilingüe. Una columna "Debit" corregida a `cargo` arrastra el prototipo y el resto de las columnas genéricas se van para ese lado. El efecto no es monótono.
- Con el modelo chico, las correcciones sí ayudan con más consistencia (+2 a +16 puntos sobre el control).
- **Olvido**: después de corregir, el acierto en los bancos vistos se mantiene (85-91 % frente al 85-88 % de antes). El replay funciona. [V]
- Latencia de `add_examples`: 0,1 a 0,3 s (incluye el reentreno de la cabeza).

### 3c. ¿La confianza sirve para decidir cuándo preguntar?

| | AUROC (confianza separa acierto de error) | Preguntas necesarias para dejar **0** errores silenciosos en nuevos |
|---|---|---|
| Multilingüe tal cual | 0,94 | 91 de 132 (69 %) |
| Multilingüe saturado | 0,96 | 52 de 132 (39 %) |
| `all-MiniLM-L6` saturado | 0,92 | 44 de 132 (33 %) |
| Saturado + aritmética (multilingüe) | — | **0 de 132** (no quedan errores) |

- **Ordena bien pero no calibra.** Los errores tienen menos confianza, pero los rangos se traslapan: aciertos p5/p50/p95 = 0,27/0,59/0,75 y errores = 0,18/0,20/0,35. Además los valores absolutos dependen de cuántas veces se reentrenó. Un umbral fijo no sirve: para no dejar errores silenciosos habría que preguntarle al cliente por un tercio o más de las columnas. **No sirve como semáforo de "preguntar"**; el semáforo bueno es la aritmética (cuadra o no cuadra).

### 3d. Latencia y peso (M1, CPU) [V]

| | Multilingüe L12 | all-MiniLM-L6 |
|---|---|---|
| Peso en disco | 471 MB | 91 MB |
| Carga + entrenamiento inicial (21 columnas) | ~4 s en caliente (29 s con la descarga) | ~2-9 s |
| Predicción por columna | ~18 ms | similar |
| Una cartola (7 columnas en lote) | 52-58 ms | 28-32 ms |
| Dependencias | torch + transformers + faiss (~1 GB instalado) | ídem |

No corre en Vercel (Node, límites de tamaño). Tendría que vivir en la mini como servicio Python. [NV: no probé desplegarlo]

---

## 4. Alternativas del mismo tipo (verificadas que existen)

| Proyecto | Estado verificado | Qué hace | ¿Nos sirve? |
|---|---|---|---|
| **Sherlock** (`mitmedialab/sherlock-project`, MIT, push 2024-07) | [V] clonado | Tipo semántico de columna con ~1 588 rasgos: bolsa de caracteres con estadísticas por carácter (`sherlock/features/bag_of_characters.py:10-40`), fracciones de celdas numéricas, de texto y únicas (`bag_of_words.py:50-83`), embeddings de palabras y un párrafo-vector. 78 tipos de VizNet, en inglés. | El modelo no (sus tipos no son los nuestros). **La idea sí**: los rasgos de *forma* de la columna. Mi versión "Sherlock-lite" de 10 rasgos + RandomForest da 98,5 % en rol grueso. |
| **Sato** (`megagonlabs/sato`, Apache-2.0, push 2024-02) | [V] existe (no clonado) | Sherlock + contexto de tabla (temas LDA) + CRF para que los tipos de columnas vecinas sean coherentes. | La idea del **CRF / roles únicos por tabla** ya la aplicamos con "la aritmética reparte y el resto va a otro". |
| **DODUO** (`megagonlabs/doduo`, Apache-2.0, push 2022-06) | [V] clonado | BERT que lee la **tabla entera** serializada y anota todas las columnas a la vez (`doduo/doduo.py:144-222`, `bert-base-uncased`). Tipos de TURL/VizNet. | Habría que reentrenarlo con cartolas etiquetadas. No tiene aprendizaje incremental. Pesado para lo que ganamos. |
| **Valentine** (`delftdata/valentine`, Apache-2.0, push **2026-07**, activo) | [V] clonado | *Schema matching* entre DOS tablas: COMA, Cupid, Similarity Flooding, Jaccard y **DistributionBased** (histogramas de cuantiles + distancia EMD, `algorithms/distribution_based/distribution_based.py:20-40`). | **Idea útil**: cuando un banco cambia el formato, no clasificar desde cero, sino *emparejar* las columnas nuevas con las de la última cartola **confirmada** de ese mismo cliente, por distribución de valores. Encaja con el `adapter-store` / `fingerprint` que ya existen. |
| ptype (`alan-turing-institute/ptype-dmkd`) | [V] existe, **archivado** | Inferencia probabilística de tipo (fecha, número, etc.) con detección de valores faltantes o anómalos. | No: archivado, y nuestro problema no es el tipo primitivo. |

Ninguna trae "aprender del feedback del cliente" como pieza lista para usar. En la literatura eso vive en el *active learning* de schema matching. [NV: no encontré un repo usable]

---

## 5. Qué aprendemos (aunque no lo adoptemos)

1. **Separar el problema en dos pisos.** El texto y la forma deciden el rol **grueso** (fecha / glosa / plata / flag / otro), y ahí casi no se equivocan (98,5 % sin red neuronal). Dentro de "plata", el que decide es la **aritmética**, nunca el texto. El producto ya tiene la mitad: `orientarPorSaldo` (`src/lib/parsers/heuristic.ts:555-568`) y `formatoVerificadoPorSaldo` (`src/lib/parsers/validator.ts:213-223`). Lo leí [V]: en `single_col` el saldo **ya se elige por ecuación**, probando todos los pares monto/saldo (`heuristic.ts:465-485`). En `two_cols`, en cambio, el par cargo/abono se elige por **exclusividad** (`heuristic.ts:282-310`), el saldo por la forma "parece saldo corrido" (`isLikelyRunningBalance`, `:240, :358`) y la ecuación solo se usa para **orientar** el par ya elegido (`:324`). La lección es extender a `two_cols` lo que `single_col` ya hace: probar ternas (saldo, cargo, abono) y quedarse con la que cuadra.
2. **El semáforo de "preguntar" es la aritmética, no la confianza.** Con el modelo: 33-39 % de preguntas para llegar a 0 silenciosos. Con forma + aritmética: 3 % de preguntas (solo en `sin_saldo`) y 1,5 % de silenciosos. Coincide con la regla del proyecto: **Check ≠ Emitir; lo que no cuadra no pasa**.
3. **Los errores silenciosos que quedan son de glosa vs otro** (una columna "Nombre contraparte" con nombres tomada por glosa). Ninguna ecuación los atrapa. Van al cliente solo si hay **dos** columnas de texto largo candidatas, o se desempata con reglas de unicidad (la glosa más variada).
4. **La memoria de aprendizaje correcta es chica y exacta.** Guardar "en esta empresa, el título normalizado X = rol Y" (lo que ya hacen `adapter-store` y `fingerprint`) le gana a un prototipo de embeddings: una corrección mal generalizada movió 18 puntos para abajo. Generalizar entre clientes solo cuando el saldo lo confirma (la regla que ya existe desde la revisión del 2026-09-26).
5. **Del diseño de adaptive-classifier rescato el replay** (reentrenar con todos los ejemplos guardados en vez de solo el nuevo) y el **peso según antigüedad** (desconfiar de una clase con menos de 10 ejemplos). Ambos son buenos principios si algún día entrenamos algo. El EWC y la memoria FAISS no aportan con 8 clases y decenas de ejemplos.
6. **Mide contra un control.** La "mejora tras la corrección" que vi al principio (63 → 91 %) era casi toda de *entrenar más épocas*, no de la corrección. Sin el control la habría reportado como un éxito del aprendizaje.

---

## 6. Recomendación concreta

- **No adoptar adaptive-classifier** para mapear columnas. Pesa ~1 GB con dependencias, obliga a tener Python en la mini, no le gana a un kNN o a un TF-IDF de 70 ms, su confianza no sirve como umbral y una corrección puede empeorarlo. [V]
- **Sí, en este orden** (cada paso es determinístico y barato):
  1. **En `two_cols`, elegir la terna por ecuación** (como ya hace `single_col` en `heuristic.ts:465-485`) entre *todas* las columnas numéricas, probando ambos sentidos de orden, antes de mirar los títulos y antes de la exclusividad. Si una terna (saldo, cargo, abono) o (saldo, monto, flag) cuadra en ≥ 90 % de las filas, se acepta sin mirar títulos.
  2. **Rasgos de forma por columna** (≈10: fracción vacía, numérica, fecha, con espacios, largo medio, únicos, magnitud, etc.) para el rol grueso, con reglas explícitas en TS. No hace falta un RandomForest: los rasgos son legibles a mano.
  3. **Si no cuadra ningún saldo** (`sin_saldo`), orientar por el vocabulario de títulos que ya existe (`orientarPorEncabezado`, `heuristic.ts:570`). Si tampoco alcanza, **preguntarle al cliente una sola cosa**: "¿cuál de estas dos columnas son tus salidas?", mostrando 3 filas.
  4. Guardar esa respuesta en el adapter de la empresa (ya existe). Compartirla entre empresas solo si después se verifica por saldo.
  5. A futuro, con cartolas reales: probar el **emparejamiento por distribución** a la Valentine contra la última cartola confirmada del mismo cliente, cuando el fingerprint cambia.
- **Próximo paso sugerido** (no lo hice, porque no tocaba código del producto): correr `scripts/experimento-estructura-deepseek.ts --sin-ia` y mirar cuántos de los `SILENCIOSO` actuales atraparía el paso 1 (saldo por ecuación sobre todas las numéricas).

**Límites de esta investigación**: los datos son sintéticos y de un solo generador (glosas repetitivas, montos redondos, 30 filas), así que los números reales van a ser peores. No probé el caso `sin_saldo` + `sin_títulos` juntos, donde cargo vs abono es **indecidible** sin semántica de glosas o una fila de totales. No probé ONNX ni otros encoders (e5, bge).
