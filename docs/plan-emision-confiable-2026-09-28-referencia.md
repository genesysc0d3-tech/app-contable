# Plan — referencia propia de massDTE en cada boleta (2026-09-28)

> PLAN, no construcción. Complementa `plan-emision-confiable-2026-09-28-extension.md` (su §5 "opción B" pasa
> a ser ESTE plan) y `plan-emision-confiable-2026-09-28-app.md`.
> **Decisión del fundador (2026-09-28):** la referencia entra. El cliente final la ve impresa: aceptado.
> Principio: identificador de punta a punta (el end-to-end id de una transferencia) + llave de idempotencia
> (Stripe): la misma operación lógica lleva siempre la misma llave, y el resultado dudoso se CONSULTA por la llave.
> Convención: **[V]** = leído hoy en la rama `fix/costo-vercel` (archivo:línea). **[NV]** = no verificado
> (se sabe solo en el portal real → ensayo MV; o en la base de prod → query de solo lectura).

---

## 0. Lo que encontré leyendo el código (cambia el diseño)

1. **La glosa la arma la APP, no la extensión.** `EmitirLoteModal.tsx:99` pone `detalle` (o el genérico
   "Venta exenta"/"Servicio prestado"); `buildBoletaJob` la recorta a 80 (`boleta-job-payload.ts:95`) y la manda
   como `job.glosa` y `detalles[0].nombre` (`:110-112`). El worker la escribe tal cual, recortada a 80
   (`sii-worker.js:1774`). **[V]** → **la ref se imprime desde la app, con cualquier extensión ≥ la que ya
   escribe glosa (toda la flota).** Imprimir NO depende de la 0.2.9; leerla sí.
2. **La glosa es best-effort.** Si no logra escribirla, apaga el toggle y EMITE igual, marcando
   `glosa_omitida` (`sii-worker.js:1796-1800`, `:1540`); el server solo deja un `ops_event` warn `GLOSA_OMITIDA`
   (`result/route.ts:1299-1302`). **[V]** → una boleta puede salir SIN ref. El diseño tiene que convivir con eso.
3. **El campo "Detalle" tiene límite 80** y su ancla es el contador "/ 80" (`sii-worker.js:918-926`,
   `sii-libreto.ts:306`). El chequeo de escritura compara en MAYÚSCULAS (`normalizeText`, `sii-worker.js:335-337`,
   usado en `:1792`). **[V]** Que la afecta 39 muestre el mismo "/ 80" que la exenta 41: **[NV]** (un solo camino
   de código para ambos, `:1774`; confirmar en MV).
4. **El PDF de la boleta ya se captura** (hook de `navigator.share`, `sii-worker.js:17-27`, `:1948-1951`; o fetch
   con sesión, `background.js:240-262`) y **el server ya sabe leer texto de PDFs del SII**
   (`src/lib/pdf/datos-oficiales-dte.ts:220`, `leerDatosOficialesDte`, pdfjs). **[V]** → la ref se puede
   comprobar en el server sin tocar la extensión. Que el PDF de e-Boleta imprima el Detalle: **[NV]** (MV).
5. **/reportes no muestra el detalle.** Columnas conocidas: Folio, Fecha ("09/07/2026 14:38:24"), Total, Estado,
   Acciones = botón "receipt" sin `<a>` (memoria `project_cierre_ciclo_folio_2026_09_26`); el parser solo busca
   folio/fecha/hora/monto/tipo (`sii-worker.js:1357-1363`). **[V el parser; NV que el DOM no traiga el detalle
   oculto]** → en /reportes la ref sirve para CONFIRMAR candidatas abriéndolas, no para encontrarlas.
6. **El `job_id` nace en el server** (`locks.ts:28`, `server:<provider>:<uuid>`) y la propuesta se valida en
   `jobs/route.ts:346-360`. **[V]** Ahí mismo se asigna la ref.
7. **Ya existe la rama "doble folio de una propuesta"**: si la propuesta ya tiene boleta viva con otro folio, el
   segundo se registra desacoplado + `ops_event` crítico (`result/route.ts:1186-1216`). **[V]** La ref extiende
   esa detección a la boleta única y a la conciliación.

---

## 1. Formato del código

**Forma:** `MD-` + 6 caracteres. Ej.: `MD-7F3KQX`.
- **Alfabeto de 30:** `23456789ABCDEFGHJKMNPQRSTVWXYZ` (sin `0 O 1 I L U`; la U fuera evita palabrotas en
  inglés, como Crockford). Solo mayúsculas ASCII: sobrevive al `toUpperCase` del chequeo (`sii-worker.js:336`) y
  a cualquier normalización del SII.
- **5 al azar + 1 de control** (mod 30 ponderado, tipo Damm/Luhn-mod-N): detecta una letra mal leída o dos
  cambiadas de lugar cuando alguien la dicta por teléfono o la tipea en soporte. 30⁵ = 24 M por empresa.
- **Al azar, NO derivada** de propuesta_id/monto/RUT: sin PII y sin nada que un tercero pueda inferir. "Derivable"
  = se busca en la base, no se calcula.
- **Unicidad garantizada, no probabilística:** registro nuevo `emision_refs` con `PRIMARY KEY (empresa_id, ref)`;
  se genera e inserta con reintento ante choque (a 5.000 boletas/empresa/año la probabilidad de choque por
  sorteo es ~0,05 % por boleta → el reintento la vuelve 0).

**¿Por INTENTO o por PROPUESTA? → por PROPUESTA** (la operación lógica), como la llave de idempotencia de Stripe:
- Un reintento de la misma propuesta lleva **la misma ref**. Antes de re-emitir tras un resultado dudoso, se
  consulta por esa ref (plan app 1.2): si el SII ya tiene un documento con ella, salió; no se reintenta.
- Si igual aparecen **dos documentos del SII con la misma ref**, eso ES el doble folio, probado sin adivinar
  (con ref por intento serían dos refs distintas y habría que unir job→propuesta para verlo).
- El intento queda trazado igual: `emision_jobs.ref_massdte` (copia) + `emision_jobs.job_id` de siempre.
- **Boleta única** (sin propuesta): ref por job. Un reintento de la única es otro job = otra ref (igual que hoy,
  su reja es el candado; `locks.ts:84-99`).
- **Anulación:** si la boleta de una propuesta se anula (NC) y la propuesta vuelve a emitirse, la ref se
  **quema** (`emision_refs.quemada_at`) y se genera otra. Así cada ref viva corresponde a UN documento vivo.

**"Que no pase sin que lo notemos":** en `boletas_emitidas` el índice por ref es **NO único**
(`(empresa_id, ref_massdte)`): un índice único dejaría INVISIBLE el segundo folio real (viola "un folio real
nunca se pierde", `background.js:266-270`). En cambio, al insertar se consulta "¿hay otra boleta viva con esta
ref?" → sí = rama doble folio (`result/route.ts:1186-1216`, ampliada a boleta única) con `ops_event` crítico
`doble_folio_ref`.

**Migración** `supabase/migrations/2026MMDD_ref_massdte.sql` + `_DOWN.sql` (backup antes, regla del proyecto):
- `create table emision_refs (empresa_id uuid not null references empresas on delete cascade, ref text not null
  check (ref ~ '^MD-[2-9A-HJKMNP-TV-Z]{6}$'), propuesta_id uuid null references propuestas_ia on delete set null,
  created_at timestamptz default now(), quemada_at timestamptz null, primary key (empresa_id, ref));`
  + índice único parcial `(propuesta_id) where propuesta_id is not null and quemada_at is null` (una ref viva por
  propuesta) + RLS por cuenta como `emision_jobs`.
- `alter table emision_jobs add column ref_massdte text;` `alter table boletas_emitidas add column ref_massdte text;`
  + índice `(empresa_id, ref_massdte) where ref_massdte is not null`.
- `_DOWN`: drop de columnas, índices y tabla (trae lo que destruye: las refs asignadas; respaldar antes).

---

## 2. Dónde va en la boleta

**Campo:** el mismo "Detalle" (glosa) del modal e-Boleta, **al final**, dentro de los 80. No se toca el camino
de escritura del worker (`sii-worker.js:1774-1800`).

**Copy (lo ve el cliente final):** `<texto de siempre> - Ref. MD-7F3KQX`
- Ej. exenta: `Venta exenta - Ref. MD-7F3KQX` (29 caracteres). Afecta: `Servicio prestado - Ref. MD-7F3KQX`.
- "Ref." y no "N°"/"Código": no se confunde con el folio. Separador ` - ` ASCII (el `·` puede no sobrevivir al
  portal/impresora térmica; **[NV]**, si el MV muestra que el `·` pasa limpio, se puede usar).
- El sufijo mide 17 (` - Ref. MD-XXXXXX`) → **el texto de la clienta se recorta a 63** (hoy 80). Puro
  `componerGlosa(texto, ref)`: recorta el texto (nunca la ref), `trimEnd`, concatena; si el texto ya termina en
  una ref `MD-…` (reintento), la reemplaza, no la duplica. **[NV] cuántas glosas actuales pasan de 63** — query
  de solo lectura antes del PR:
  `select count(*) filter (where length(detalles->0->>'nombre') > 63), count(*) from boletas_emitidas where created_at > now() - interval '60 days';`
- Dónde se arma: `buildBoletaJob` recibe `refMassdte` y compone la glosa (`boleta-job-payload.ts:95`); además
  viaja suelto `job.ref_massdte` para que el worker 0.2.9 lo verifique y lo anote en la bitácora. Los 3 llamadores
  (`useEmisionLote.ts:313`, `:410`, `EmitirDirectaView.tsx:1247`) pasan la ref que devolvió `POST /api/emision/jobs`.
- **Política de glosa intacta:** la ref no es dato de un tercero (`armar-boleta.ts:15-20`); no cambia la
  precedencia `notas › glosa común › genérico` (`armar-boleta.ts:44-49`).
- **Guard `glosa_omitida`:** no cambia su semántica (glosa pedida y no escrita). Se agrega `ref_omitida` =
  la glosa escrita no contiene la ref (glosa omitida, o el SII la truncó). Libreto nuevo
  `glosa.ref_obligatoria` (dato del server, `sii-libreto.ts`, lo ignora ≤0.2.8):
  - **Fase 1 (`false`):** sin ref se emite igual (como hoy), `ref_omitida:true`, el calce cae a monto+hora y
    queda `ops_event` warn `REF_OMITIDA`.
  - **Fase 2 (`true`, tras 14 días con `REF_OMITIDA = 0`):** sin ref escrita y verificada → `siiError` PRE-emit
    `REF_NO_ESCRITA`, no se clickea EMITIR (reintentable, sin folio). Recién ahí la ref es una llave dura.
- **Vistas de la app:** la mesa muestra `detalles[0].nombre` (`mesa-data.ts:211`) → se verá con la ref (bien:
  es lo impreso). El PDF personalizado usa "lo impreso en el original" (`datos-oficiales-dte.ts:1-9`) → la
  lleva sola si lee el detalle del PDF oficial **[NV]**.
- **Facturas 33/34 (fase 2, fuera de este paquete):** Nombre Producto ~40 + descripción larga
  (`factura-job-payload.ts:164-165`) → la ref iría al final de la descripción. Menos urgente: su calce ya es por
  RUT receptor + monto en `mipeAdminDocsEmi` (memoria).

---

## 3. Cómo se LEE para verificar

| Fuente | ¿Muestra la ref? | Uso | Cuándo |
|---|---|---|---|
| Valor del campo antes del EMITIR (worker) | Sí, lo escribimos | `ref_omitida` si no quedó entera | 0.2.9 |
| Recibo post-emit (`textoDialogos`, `sii-worker.js:1508-1509`) | **[NV]** | `ref_en_recibo:true` = folio del recibo es de ESTA propuesta | 0.2.9 |
| PDF capturado (share/fetch) | **[NV]** (probable) | server: texto con pdfjs → `ref_pdf` | PR app R2 |
| /reportes listado | **No** (no hay columna; **[NV]** DOM oculto) | solo encontrar candidatas (monto+tipo+hora) | — |
| Abrir el documento (botón "receipt") | **[NV]** | confirmar la ref de CADA candidata | 0.3.x, tras ensayo MV, solo lectura |
| Conciliación diaria | vía "receipt" o PDF | clasificar documentos del día | fase posterior |

**Calce EXACTO por referencia** (puro nuevo `src/lib/emission/ref-massdte.ts` → `juzgarRef`):
- Entrada: `{ refEsperada, refLeida, montoEsperado, montoLeido, tipoEsperado, tipoLeido, emisorOk }`.
- `refLeida` válida (formato + dígito de control) **y** igual a la esperada **y** mismo monto, tipo y emisor
  → **cierra** (`evidence.source = "ref_exacta"`), sin ventana horaria ni correlatividad.
- Misma ref, monto o tipo distinto → **alarma** + a medias (no debería existir).
- `refLeida` válida pero DISTINTA → ese documento **no** es de esta propuesta (`FOLIO_DE_OTRO_DOCUMENTO`, igual
  que hoy `result/route.ts:514`). Si además esa ref existe en `emision_refs` de otra propuesta → es el folio de
  ESA otra (se le ofrece a su a medias).
- Sin ref en el documento → si el job tiene `ref_omitida` o es anterior a la activación → calce viejo
  (monto+tipo+hora+correlatividad); si no → **no es de massDTE**.
- Dos documentos del SII con la misma ref → doble folio probado (§1).

**Cuándo reemplaza al calce por monto+hora:** siempre que la fuente muestre el detalle (recibo, PDF, documento
abierto). El listado de /reportes nunca lo muestra: ahí monto+hora sigue siendo el **buscador** de candidatas y
la ref el **confirmador** (abrir 1-3 candidatas). Hasta la 0.3.x, `varias_en_ventana`
(`sii-worker.js:1449`) sigue yendo a medias, pero A medias muestra la ref → la clienta o Matías abren en el SII
las boletas de ese monto y eligen la que dice `Ref. MD-XXXXXX` (confirmación humana exacta, no a ojo).

**En el server (PR R2, sin extensión nueva):** en `sii-local/result` con PDF capturado, leer texto y
`juzgarRef`. **No bloquea el registro** del folio fuerte (principio de `background.js:266-270`) y va después de
responder (`after()`, costo de CPU: plan-costo-vercel). Si da `ref distinta` → `ops_event` crítico
`REF_NO_CALZA` + marca `boletas_emitidas.proveedor_respuesta.ref_check`. **[NV]** costo de pdfjs por boleta en
Vercel: medir en preview con 10 PDFs antes de activarlo en todas; si pesa, solo para `reportes_calce_unico` y
verificaciones.

---

## 4. Integración con los otros planes

- **Bitácora "voy a emitir"** (ext §1, app §3): cada entrada suma `ref_massdte` (no es PII). Tras una caída, la
  verificación lleva la ref además de la ventana `clic_at`.
- **Verificar-y-seguir** (app 1.2): la adopción reusa la ref de la propuesta (nunca genera otra: la llave se
  mantiene). `interpretarVerificacion` acepta `ref_exacta` como `emitida` sin mirar la fecha del intento.
- **Lápidas / A medias** (app 1.1): cada ítem muestra `Ref. MD-XXXXXX · $50.000 · 27-sep 23:37`. El "folio a
  mano" (`registrar_folio_manual`, `result/route.ts:671`) sigue igual; el copy dice "busca en el SII la boleta
  con esta Ref.".
- **Correlatividad** (app 1.3): se exige solo al calce por monto+hora. Con `ref_exacta` no se exige; los
  `foliosAjenos` se siguen informando.
- **Conciliación** (app §4): 4 listas + una nueva: documento del SII con ref válida que massDTE registró en
  `emision_refs` pero sin boleta = **huérfano propio** (el caso del folio 24531) → cierre propuesto con `ref_exacta`.
  Documento sin ref = "no es de massDTE" (o anterior a la activación / con `ref_omitida`, lista conocida).
- **Folio propio por API** (app §5): la ref sigue igual como id de punta a punta entre proveedores.

**Orden de PRs** (sobre el "Orden final recomendado" de la revisión adversarial al final del plan de app, que
hoy deja la referencia en "Diferido"; esta decisión del fundador la saca de ahí):
| Paso | PR | Contenido | ¿Extensión nueva? |
|---|---|---|---|
| 1-3 | App PR 1-3 | igual que el orden final del plan de app | No |
| **3b** | `feat/ref-massdte` | migración + `ref-massdte.ts` (generar, control, `componerGlosa`, `juzgarRef`) + asignación en `jobs/route.ts` (tras `revisarPropuestaEmitible`, `:366`) + `buildBoletaJob` + copia a `boletas_emitidas` (`result/route.ts:1124-1155`) + detección doble ref + A medias muestra la ref. **Apagado por flag** `REF_EN_BOLETA` (env) hasta el ensayo MV | **No**: imprime con la flota actual |
| 4 | Extensión 0.2.9 | + los 4 puntos de ref de abajo (aditivos) | Sí |
| 5-7 | App PR 4-6 | + `interpretarVerificacion` acepta `ref_exacta`; correlatividad no se exige con `ref_exacta` | No |
| **R2** | `feat/ref-en-pdf` | lectura del PDF en el server (§3) | No |
| después | bitácora app (§3 app), conciliación, "receipt" 0.3.x | + ref en cada uno | Sí |

Va **temprano (3b)**, antes de la 0.2.9, porque la ref solo protege boletas emitidas DESPUÉS de activarla: cada
día sin ella son boletas sin llave, y no depende de la extensión.

**0.2.9 de la extensión** (se suma a ext §7, todo aditivo): `job.ref_massdte` en la bitácora; verificar que el
valor escrito contenga la ref → `ref_omitida`; buscar la ref en el texto del recibo → `ref_en_recibo`; libreto
`glosa.ref_obligatoria` (default `false`); en el ensayo MV, leer con JS si el DOM de /reportes trae el detalle.
**Fuera de la 0.2.9:** abrir "receipt" (0.3.x, un clic nuevo en el portal real con su propio ensayo).

---

## 5. Riesgos

1. **El SII rechaza o trunca la glosa con la ref.** Límite 80 (§0.3); caracteres ASCII simples. Se detecta pre-emit
   (`ref_omitida`, compara el valor re-leído, `sii-worker.js:1791-1792`). Fase 1 no frena la emisión. **[NV]**
   si la impresora térmica/PDF corta la línea → MV.
2. **Glosas largas pierden 17 caracteres.** Medir con la query de §2 antes; si muchas pasan de 63, avisar en
   Revisar ("se imprime hasta aquí").
3. **Clientes finales que reclaman el código** ("¿qué es MD-…?"). Copy neutro "Ref."; línea en la ayuda: "Es el
   código de seguimiento de tu boleta; no tienes que hacer nada". Soporte lo busca en `emision_refs` (el dígito
   de control ataja el dictado mal). El prefijo `MD-` delata que la clienta usa massDTE: aceptado por el
   fundador; alternativa sin marca = `R-` (mismo largo, decidir antes del PR 1b).
4. **Boletas emitidas fuera de massDTE** (a mano en el portal): no tienen ref → "no son de massDTE". Nunca se
   asignan a una propuesta por ref; por monto+hora solo con correlatividad (app 1.3).
5. **Boletas antiguas y con `ref_omitida`** no tienen ref: el calce viejo sigue vivo para ellas; la conciliación
   usa `created_at < activación` para no alarmar.
6. **Falsa confianza con ref_obligatoria=false:** una boleta sin ref vuelve a depender de monto+hora. Por eso la
   fase 2 tiene fecha y métrica (14 días con `REF_OMITIDA = 0`).
7. **Costo Vercel** de leer PDFs (§3): en `after()` y medido antes.
8. **Choque o reuso de ref:** PK `(empresa_id, ref)` + quema al anular + detección de doble ref en el insert.

---

## 6. Tests que fallan sin el cambio y ensayo MV

**App (vitest):**
- `src/lib/emission/ref-massdte.test.ts` (nuevo, falla porque no existe): alfabeto sin `0 O 1 I L U`; 6+prefijo;
  el control detecta 1 sustitución y 1 transposición en 1.000 casos; `componerGlosa("x".repeat(120), ref)` mide
  80 y termina en la ref entera; reintento no duplica la ref; `juzgarRef` tabla de verdad (igual → cierra;
  distinta → otro documento; misma ref/otro monto → alarma; sin ref + `ref_omitida` → calce viejo).
- `boleta-job-payload.test.ts` (junto al de `:42-48`): con `refMassdte`, `glosa` termina en `- Ref. MD-…`, mide
  ≤ 80 y `job.ref_massdte` existe → hoy falla (el campo se ignora).
- Asignación (puro `asignarRef({ propuestaId, refVivaPrevia })`): dos jobs de la misma propuesta → misma ref;
  propuesta con boleta anulada → ref nueva; boleta única → ref por job.
- `result/route`: estático al estilo `folio-ajeno.test.ts` → el insert lleva `ref_massdte` del job y la rama doble
  folio se dispara por ref también sin `propuesta_id`.
- R2: fixture de texto de un PDF e-Boleta real de MV (**se obtiene en el ensayo**) → `juzgarRef` da `ref_exacta`.

**Extensión** (`boletas-sintetico.test.js`, correr contra 0.2.8 con `MASSDTE_WORKER_SRC` para verlos fallar):
- "campo glosa con `maxlength=60` simulado → `ref_omitida:true` en el resultado" (0.2.8 no lo informa).
- "con `glosa.ref_obligatoria=true` y la ref no escrita → PRE-emit `REF_NO_ESCRITA`, sin clic en EMITIR".
- "recibo con la ref en el texto → `ref_en_recibo:true`; recibo con OTRA ref → `folio_confidence` no es high".
- `libreto-compat-flota.test.ts`: la clave `glosa.ref_obligatoria` no rompe a 0.2.1-0.2.8.

**Ensayo MV** (runbook §3, emisor MV 77.155.156-4, $1.000, jamás el emisor de una clienta; regla "jamás clic a
ciegas"):
1. Perilla `massdte:boleta-ensayo=1` (no emite): llenar `Venta exenta - Ref. MD-XXXXXX`; con JS leer el valor
   del campo y el contador; screenshot. Repetir con 63+17 = 80 exactos y con `·`.
2. Emisión real exenta 41 de $1.000: ¿el recibo muestra el Detalle? (JS sobre el diálogo, sin clics) ¿El PDF
   capturado lo trae? (guardar el texto como fixture de R2) ¿El DOM de /reportes lo trae? (JS de lectura).
3. Si MV puede emitir afecta 39: lo mismo (confirmar el "/ 80" en 39). **[NV]** si MV está habilitada para 39.
4. Botón "receipt" en /reportes: **solo en MV**, con screenshot + `find` del ícono exacto antes del clic, y
   verificando con JS que no haya `.v-dialog--active` de emisión; anotar qué abre (modal, PDF, pestaña) y si
   muestra el Detalle. Es el insumo de la 0.3.x; no entra a la 0.2.9.
5. Mirar la boleta impresa/PDF como la verá el cliente final (salto de línea, que "Ref." se lea).

**Compuerta para prender `REF_EN_BOLETA` en prod:** ensayo 1-2 OK + tests verdes + «sí» explícito del fundador.
Se prende primero para MV, después LC/MH avisando a Matías (afirmación, no pregunta).

---

## Revisión adversarial del formato B (2026-09-28)

> Revisor adversarial, SOLO LECTURA. Formato bajo revisión: `R-MMDD-XXXX` (MMDD = fecha del movimiento,
> 4 al azar de un alfabeto de 30, único por empresa en `emision_refs`, por PROPUESTA), impreso como
> `Venta exenta - Ref. R-0920-7F3K`, + buscador en la app. Base de cada punto: **[V]** leído hoy (archivo:línea),
> **[C]** calculado, **[I]** inferido, **[NV]** no verificado.

### Números (lo que se pidió calcular) [C]

- Espacio por (empresa, MMDD): 30⁴ = **810.000**. El MMDD SÍ entra en la unicidad si la PK es sobre el string
  completo (`PRIMARY KEY (empresa_id, ref)`), pero **sin año**: el 20-09 de 2026, 2027, 2028… comparten el mismo
  espacio. Eso es BUENO (la ref es única para siempre y el buscador nunca devuelve dos) siempre que nadie
  "optimice" la unicidad a `(empresa, fecha_con_año, azar)`.
- Sin reintento (sorteo a ciegas), probabilidad de que dos boletas del MISMO día choquen: 100/día → 0,6 %;
  300 → 5,4 %; **500 → 14 %**; 1.000 → 46 %. O sea: la PK + reintento es obligatoria, no un adorno.
- Con PK + reintento el costo es nulo: tras 5 años con 500 movimientos por fecha, cada sorteo choca con
  prob. 0,3 % → un `INSERT … ON CONFLICT DO NOTHING` extra cada ~300 boletas.
- Error de tipeo en el buscador sin dígito de control: cae en OTRA ref existente con prob. ≈ refs_de_ese_día/810k
  (~0,06 % con 500/día). Bajo, pero sin control el buscador no puede distinguir "tipeaste mal" de "no es nuestra".

### BLOQUEANTE

**K1. La fecha del movimiento impresa en la boleta es evidencia de emisión tardía. [I, lo decide Matías]**
La boleta lleva fecha de emisión = HOY (`EmitirLoteModal.tsx:74,100`, `fechaEmision: hoy` [V]); la ref llevaría
la fecha del movimiento (el caso LC: movimiento 20-09, emisión 27-09 [V memoria]). Las clientas P2P emiten días
después de la transferencia, desde la cartola. Imprimir `R-0920` en una boleta fechada 28-09 deja en el documento
tributario, para siempre y a la vista del SII y del cliente final, que la operación ocurrió 8 días antes. No
afirmo que sea infracción (no verificado; es terreno del art. 55 DL 825 / art. 97 N°10 CT y de la práctica de
fiscalización): **es pregunta para Matías ANTES de construir.** Si Matías dice "no importa", la fecha se puede
quedar (ver variante B' abajo); si duda, la fecha va solo al buscador, no al papel.

**K2. MMDD se lee al revés en Chile. [I]** Un contador chileno lee `0506` como "5 de junio" (DD-MM). Con MMDD es
el 6 de mayo. Ambiguo en todas las fechas con día ≤ 12 (~40 % del año) y la ref es justamente para que un humano
la lea. DDMM tampoco sirve limpio: `2009`, `2010`… `2012` (el 20 de cada mes) parecen AÑOS. Si hay fecha, que
sea inequívoca: `20SEP` (día + mes en 3 letras en español, como las cartolas). Cuesta 1 carácter.

### IMPORTANTE

**I1. Sin dígito de control se rompe `juzgarRef` tal como está escrito.** §3 define "`refLeida` válida (formato +
dígito de control)"; la migración trae `check (ref ~ '^MD-…{6}$')` (§1) y `componerGlosa` busca "una ref `MD-…`"
al final (§2). El formato B no tiene control → hay que redefinir "válida" = regex **y** existe en `emision_refs`
de ESTA empresa, y reescribir regex/tests (`ref-massdte.test.ts` de §6 prueba "el control detecta 1 sustitución y
1 transposición": con B ese test no tiene sujeto). Recomiendo VOLVER a poner el control: 1 carácter, detecta toda
sustitución simple y toda transposición adyacente (Luhn mod N), y permite el mensaje "revisa el código, un
carácter no calza" en vez de "no existe".

**I2. B y V se dictan igual en Chile** ("be larga / ve corta"), y por teléfono M/N (eme/ene) y F/S (efe/ese) se
confunden. El alfabeto de 30 conserva B y V. Además conserva A y E → caben palabras en español con consonantes
del alfabeto: `PENE`, `CACA`, `PAJA`, `MAMA`, `PETA` son refs válidas que un cliente final vería impresas. Sacar
las vocales A/E (quedan sin vocales → no forma palabras) y la V (queda B) mata ambos problemas.

**I3. Detectar la ref en texto de PDF / recibo / glosa de la clienta.** pdfjs entrega el texto en trozos y la
línea puede partirse justo en un guion (`R-0920-` | `7F3K`); la impresora térmica/PDF corta líneas de ~32-48
caracteres [NV]. El lector debe: tomar el texto tras el ancla `REF.`, quitar espacios/saltos, y recién ahí
aplicar la regex. Anclar SIEMPRE a `" - Ref. "` + fin del texto para no confundir con códigos de la propia
clienta (órdenes P2P tipo "R-1234…" en `notas`/`glosa común`, `armar-boleta.ts:44-49` [V que la glosa viene de
la clienta]). Menos guiones internos = menos puntos de corte.

**I4. No todas las propuestas tienen movimiento BANCARIO.** `movimiento_id` es NOT NULL
(`20260410_schema_base.sql:147` [V]), pero hay movimientos sintéticos: factura única crea un documento
`boleta_unica` + `movimientos_raw` con `fecha: hoy`, `origen: "factura_unica"` (`factura-unica/route.ts:100-125`
[V]); la boleta única no tiene propuesta (§1). Ahí "fecha del movimiento" = fecha de emisión y el buscador NO
debe decir "fila exacta de la cartola": debe decir "emitida sin cartola". Igual para OCR/Telegram si crean
movimientos propios [NV cuáles].

**I5. El buscador debe sobrevivir a que la fila de la cartola desaparezca.** Borrar/deshacer la cartola está
bloqueado si hay boletas (`eliminar-documento/route.ts:119`, `deshacer-documento/route.ts:88-102` [V]), pero no a
nivel base: `movimientos_raw → documentos_subidos ON DELETE CASCADE` y `propuestas_ia → movimientos_raw ON DELETE
CASCADE` [V schema], y existe `api/derechos/borrar` (supresión 21.719) [V que existe, NV qué borra]. Con
`emision_refs.propuesta_id ON DELETE SET NULL` la ref queda huérfana y el buscador en blanco. → Guardar en
`emision_refs` un snapshot sin PII: `movimiento_id`, `fecha_mov`, `monto`, `tipo_dte` al asignar; el buscador
cae a eso si la fila ya no está ("la fila de la cartola fue eliminada el …").

**I6. Aislamiento del buscador.** La ref es única POR EMPRESA → la misma `R-…` puede existir en dos empresas.
(a) La ruta filtra por la empresa ACTIVA del usuario sacada de la sesión (como `usuario.empresa_id` en
`factura-unica/route.ts:103` [V patrón]), nunca por un `empresa_id` que mande el cliente; si usa service-role,
el filtro es explícito, no confiar en RLS. (b) Multiempresa: buscar solo en la activa y, si no hay, ofrecer "buscar
en tus otras empresas" (solo las de la cuenta). (c) El resultado muestra `descripcion` de la cartola = nombre/RUT
de la contraparte P2P (PII de terceros): solo usuarios autorizados de la empresa; no loguear la descripción en
`ops_events`. (d) NUNCA una página pública "verifica tu boleta" para el cliente final: con la fecha conocida
quedan 810k combinaciones (enumerable) y devolvería la cartola. Soporte (Matías) busca cross-empresa solo por
ruta de admin, mostrando la empresa.

### MENOR

**M1. Buscador: qué más debe encontrar.** Normalizar la entrada (mayúsculas, sin espacios ni guiones, con o sin
`R-`/`REF`, `O→0`/`I,L→1` solo en posiciones de dígitos). Además de la ref: **folio + tipo** (39 y 41 tienen
secuencias de folio distintas → el mismo número puede existir en ambas: mostrar las dos), **monto + rango de
fechas** (el caso 24531: monto $50.000 alrededor del 27-09), **n_documento del banco** (cuando exista), y las
"a medias" con su ref (copy: "busca en el SII la boleta con esta Ref."). Resultado: boleta (folio, tipo, fecha
emisión, estado), la fila de la cartola, y si la ref tiene 0 o 2+ boletas vivas decirlo en rojo (= no salió /
doble folio).

**M2. Checksum del monto o tipo 39/41 en la ref: NO.** (a) Cuando la fuente trae la ref (recibo, PDF, documento
abierto) también trae monto y tipo → `juzgarRef` ya los compara (§3); el checksum no agrega nada. (b) La ref es
por PROPUESTA y la clienta puede corregir monto o carril (Boletas→Exento, caso de la memoria RUT inmutable) entre
un intento dudoso y el reintento → una ref derivada del monto/tipo cambiaría y rompería "misma operación = misma
llave". Con la ref al azar, si el intento viejo SÍ salió con otro monto, aparecen dos documentos con la misma ref
→ la alarma correcta (doble emisión del mismo movimiento). (c) El tipo ya viene impreso ("BOLETA EXENTA
ELECTRÓNICA"). (d) Un carácter del monto filtra un poquito del monto: gratis evitarlo.

**M3. Caracteres y largo en el SII.** ASCII mayúscula + `-` + `.` es lo más seguro; el chequeo del worker
compara con `normalizeText` (colapsa espacios y pasa a MAYÚSCULAS, `sii-worker.js:335-337` [V]) → sobrevive si el
SII cambia mayúsculas. Riesgo [NV]: que el SII/XML cuente BYTES y no caracteres: una glosa de 80 con `ñ`/`á`
empujaría la ref fuera. En el ensayo MV: glosa exacta de 80 con tildes + ref; leer el PDF. Y el `slice(0, 80)`
está DOS veces (`boleta-job-payload.ts:95`, `sii-worker.js:1774` [V]) y corta por el FINAL = donde vive la ref:
`componerGlosa` debe devolver ≤ 80 medido igual que el worker, o el worker se la come en silencio.

**M4. Zona horaria.** Donde la fecha salga de "hoy" (boleta única, sintéticos), usar `chileDateString`, no UTC
(después de las 21:00 Chile, UTC ya es mañana). `movimientos_raw.fecha` es `date` [V schema] → sin problema.

**M5. Año.** Con la PK sin año no hay ambigüedad en la BASE; en el PAPEL `0920` no dice de qué año. Aceptable
(la boleta trae su fecha), pero es otro argumento para no depender de la fecha impresa.

**M6. Reintento otro día.** La ref se asigna una vez por propuesta y NO se regenera al reintentar (bien); una
boleta del 29-09 llevará la fecha del movimiento o la del primer intento, nunca la de su propia emisión. Con
fecha en la ref, dejarlo escrito para que nadie lo "arregle".

### Lo que NO rompe (verificado contra el plan)

- Bitácora: `ref_massdte` es un string sin PII; cualquier formato sirve.
- Doble folio por ref (§1, `result/route.ts:1186-1216` [V plan]): funciona igual con cualquier formato mientras la
  ref sea por propuesta y el índice en `boletas_emitidas` NO sea único.
- Conciliación "sin ref = no es de massDTE": funciona si la detección es ancla + regex + existencia (I3).

### FORMATO FINAL recomendado

**`R-` + 5 al azar + 1 de control, en dos grupos de 3, SIN fecha impresa.**
- Alfabeto de **24**: `23456789BCDFGHJKMNPRSTXZ` (fuera `0 O 1 I L` por vista, `U A E` para no formar palabras,
  `V` por la be/ve al dictar, `Q W Y` por raras al dictar). Control: Luhn mod 24 sobre los 5.
- Espacio: 24⁵ ≈ **8 millones por empresa, para siempre**. Una clienta de 300/día (~110k/año): ocupación 1,4 %
  al año, 7 % a los 5 años → reintentos de sorteo despreciables; tipeos atajados por el control.
- Unicidad: `PRIMARY KEY (empresa_id, ref)` + reintento; regex `^R-[2-9B-DF-HJKMNPR-TXZ]{3}-[2-9B-DF-HJKMNPR-TXZ]{3}$`
  + validación del control en `juzgarRef`.
- Sufijo ` - Ref. R-XXX-XXX` = **17 caracteres** → el texto de la clienta queda en 63 (la query de §2 no cambia).
- La fecha del movimiento, el monto y la fila de la cartola viven en el **buscador** (snapshot en `emision_refs`,
  I5), no en el papel → sin K1, sin K2, sin M5.

Ejemplos:
1. Exenta P2P: `Venta exenta - Ref. R-7F3-KX9` (29 car.). Se dicta "erre, siete efe tres, ka equis nueve".
2. Afecta con glosa de la clienta: `Servicio de asesoría septiembre - Ref. R-M4D-2TH` (48 car.).
3. Glosa larga recortada: `Intercambio USDT orden 88213 cliente frecuente, pago transf. - Ref. R-H8C-P5N`
   (el texto se recorta a 63, la ref entera siempre al final; ≤ 80).

**Variante B' (solo si Matías confirma que la fecha del movimiento en la boleta NO es riesgo, K1):**
`R-20SEP-XXXX` → `Venta exenta - Ref. R-20SEP-7F3K` — día + mes en 3 letras (sin DDMM/MMDD ambiguo), 4 al azar
del alfabeto de 24 (24⁴ ≈ 330k por empresa y fecha) **+ recomendación de sumar 1 de control** (`R-20SEP-7F3KX`,
sufijo 21 → texto de la clienta a 59). Unicidad sobre el string completo, sin año.

## Dónde se VE la referencia en la app (pedido del fundador, 2026-09-28)
- **Tabla grande de Boletas/Facturas** (`sections/BoletasMensualesView.tsx:123-165`, la misma card en la mesa de
  boletas y en la de facturas): columna nueva **"Ref."** al lado de "Folio" (grid `58px 62px …` → agregar ~72px),
  en tipografía mono y con botón copiar. Boletas antiguas sin ref: "—".
- **Lista "Últimas emitidas"** de la mesa (`Mesa.tsx:~103`, junto a `#{folio}`): la ref chica al lado del folio.
- **Boleta personalizada** (`PreviewBoletaButton` / PDF propio de massDTE): imprimir la misma ref para que la
  versión personalizada y la original del SII (`DescargarBoletaButton`) se crucen a simple vista.
- Datos: `/api/boletas/rcv` y `mesa-data.ts` suman `ref` al select de `boletas_emitidas` (columna de la migración).
- El buscador de la app acepta ref, folio+tipo, monto+fechas y n_documento (empresa SIEMPRE de la sesión).
- Test de fuente: la columna "Ref." existe en ambas vistas; test puro del formato mostrado (R-XXX-XXX).

## DECISIÓN FINAL DEL FUNDADOR (2026-09-28) — manda sobre todo lo anterior
La referencia es un **ID INTERNO**: para la clienta y para nosotros dentro de la app ("para no perderse" y para
soporte). **NO se imprime en la boleta del SII (no va en el Detalle) ni en la boleta personalizada.**
- Queda: formato `R-XXX-XXX` (5 + control, alfabeto de 24), único por empresa y por propuesta, guardado en
  emision_refs / emision_jobs / boletas_emitidas; columna "Ref." en la tabla de Boletas y Facturas
  (BoletasMensualesView), junto al folio en "Últimas emitidas", y buscador (ref, folio+tipo, monto+fechas,
  n_documento; empresa siempre de la sesión). Viaja en la bitácora de la extensión para cruzar logs y soporte.
- Sale: glosa con ref, `ref_omitida`/`REF_NO_ESCRITA`, lectura de la ref en recibo/PDF/receipt, `juzgarRef`
  contra el documento del SII, límite de 63 caracteres, riesgo de fecha impresa (K1/K2 ya no aplican).
- Consecuencia asumida: la verificación contra el SII sigue siendo por monto + tipo + fecha + ventana horaria +
  correlatividad (principios 2 y 3), no por referencia exacta.
