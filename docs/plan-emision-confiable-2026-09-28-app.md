# Plan: emisión confiable, lado APP + SERVIDOR (2026-09-28)

> Plan de construcción, **no construido**. Construye sobre la rama local `fix/costo-vercel` (sin publicar;
> ya trae `propuesta-emitible.ts` falla cerrada, `ya_emitida` en el runner y la verificación de la emisión
> incierta). El lado EXTENSIÓN (bitácora persistente, keepalive, calce por Tipo, rango de fechas en /reportes)
> es de **otro plan**; acá solo defino qué espera la app de ella.
>
> **Base de cada afirmación:** `archivo:línea` = leído hoy en la rama. "Memoria" = viene de las fichas del
> incidente (no re-verificado en vivo). "No verificado" = hay que probarlo antes de construir.

**El caso que manda (LC, 27-sep 23:37):** la boleta 17 ($50.000, propuesta `641055e8`) quedó con su job
`running` sin respuesta de la extensión. La pestaña murió, el candado le mostró "Equipo: LC SERVICES está
emitiendo…" (era ella misma) y la propuesta **sigue re-emitible** aunque el folio 24531 pudo salir (memoria).

**Principio único:** *resultado desconocido = se consulta a la fuente; nunca se repite a ciegas*. Y la clienta
ve **una línea**: "salió con folio N" / "no salió, va de nuevo" / "quedó a medias".

---

## 1. Resultado desconocido = se consulta, nunca se repite a ciegas

### 1.1 Job de lote `running` vencido = lápida

**Hoy:** `revisarEnVuelo` (`src/lib/emission/propuesta-emitible.ts:76-88`) solo bloquea jobs con
`expires_at > ahora` (`:82`). Al vencer, la propuesta vuelve a "lista" sin lápida (riesgo A del adversarial).
`pendientes-emision.ts:117-124` solo trae `estado = 'revision_pendiente'` para el Set `enRevision` y la pestaña
A medias, así que el job colgado tampoco aparece ahí.

**Cambio:**
- Nuevo puro `src/lib/emission/lapida.ts`:
  `esLapidaEfectiva(job: { estado; propuesta_id; expires_at }, ahora): "a_medias" | "sin_respuesta" | null`
  → `revision_pendiente` = `"a_medias"`; `created|running` + `propuesta_id` no nulo + `expires_at <= ahora` =
  `"sin_respuesta"`; lo demás `null`. La boleta única (sin `propuesta_id`) queda igual: su reja es el candado
  (`locks.ts:84-99`).
- `revisarLapida` (`propuesta-emitible.ts:47-60`): consulta `estado in (revision_pendiente, created, running)`
  y juzga con `esLapidaEfectiva`. `revisarEnVuelo` se queda como está (vivo = `EMISION_EN_CURSO`). Nuevo código
  `SIN_RESPUESTA` (409) con detalle "Esta boleta quedó sin respuesta del SII. Verifícala antes de re-emitir."
- `pendientes-emision.ts:117-124`: misma consulta ampliada + `esLapidaEfectiva`; `construirAMedias`
  (`src/lib/intermediario/a-medias.ts`) agrega `motivo: "a_medias" | "sin_respuesta"` al `ItemAMedias`.
- `sii-local/result` `registrar_folio_manual` (`route.ts:671`) acepta también `sin_respuesta` (hoy exige
  `revision_pendiente` → la clienta no podría registrar el folio del job colgado).
- `liftRevisionTombstone` (`result/route.ts:410-421`): al registrar la boleta de la propuesta, cierra también
  sus jobs `running/created` vencidos (hoy solo levanta `revision_pendiente`).

**Test que falla sin el cambio** (`src/lib/emission/propuesta-emitible.test.ts`, mock de Supabase como ya se
usa): propuesta con un job `running`, `propuesta_id` y `expires_at` hace 1 min → hoy `revisarPropuestaEmitible`
devuelve `{ ok: true }`; debe devolver 409 `SIN_RESPUESTA`. Más `lapida.test.ts` con la tabla de verdad
(running vivo → null; running vencido con propuesta → sin_respuesta; running vencido sin propuesta → null;
failed vencido → null).

**Riesgo:**
- Retroactivo: todo job colgado viejo sin boleta pasa a A medias. **No verificado cuántos hay**; antes del PR
  correr (solo lectura):
  `select count(*) from emision_jobs j where j.estado in ('created','running') and j.expires_at < now() and j.propuesta_id is not null and not exists (select 1 from boletas_emitidas b where b.propuesta_id = j.propuesta_id and b.estado <> 'anulada');`
  Si son muchos y viejos, acotar a `created_at >= now() - 30 días` y resolver el resto a mano.
- Un colgado que murió ANTES de apretar EMITIR queda bloqueado hasta verificarlo. Por eso 1.2 (botón
  "Verificar") tiene que salir pegado a este PR. Mientras tanto la salida es el folio a mano o soporte.
- Índice para la consulta ampliada: **no verificado** si existe `(empresa_id, estado)` en `emision_jobs`.

**Clienta:** antes, la de $50.000 volvía a "Listas" y la podía re-emitir (doble folio). Después aparece en
**A medias** como "Quedó sin respuesta del SII · $50.000 · 27-sep 23:37 · [Verificar]".

### 1.2 Reanudar saca la boleta EN VUELO y la verifica primero

**Hoy:** el rastro se guarda con `base.slice(progreso.procesadas)` (`EmitirLoteModal.tsx:176-179`). Mientras
corre, la boleta en vuelo todavía no cuenta como procesada (`lote-runner.ts:184-185` suma después del
`await`), así que **queda primera en el rastro** y Reanudar la re-emite (riesgo B). `LotePendiente`
(`lote-persist.ts:31-37`) no sabe cuál estaba en vuelo.

**Cambio:**
- Puro nuevo en `lote-persist.ts`: `rastroReanudacion(baseIds, progreso) → { remainingIds, enVuelo }`. Con
  `itemActual` presente, `enVuelo = itemActual.propuestaId` y `remainingIds` lo excluye. `LotePendiente` gana
  `enVuelo?: { propuestaId: string; desdeMs: number }` (sin PII, solo UUID + hora).
- **Adoptar el job colgado, en el servidor** (`POST /api/emision/jobs` con `origin: "verificacion_lote"` y
  `adopta_propuesta_id`). La lógica de decisión va en un puro nuevo `src/lib/emission/adopcion.ts`:
  `decidirAdopcion({ jobs, userId, ahora }) → { ok, jobViejo, ventana, fechaIntento } | { ok:false, code }`:
  - el job colgado debe ser **del mismo usuario**, con esa propuesta, `created|running` o lápida `sin_respuesta`;
  - si sigue vivo y tiene < 3 min → `EMISION_EN_CURSO_PROPIA` (no se adopta algo que puede estar trabajando);
  - ventana = `created_at → min(expires_at, ahora)` del job viejo (tope 30 min: el worker ya lo recorta,
    `background.js:1456-1458`);
  - suelta el candado del job viejo (`emision_locks` delete) **sin cambiarle el estado**: sigue protegiendo por
    1.1. Así no hace falta ninguna transición nueva "hacia menos protección".
  - la verificación se abre saltando `revisarLapida`/`revisarEnVuelo` **solo para esa propuesta**; `revisarYaEmitida`
    se mantiene (si ya está registrada devuelve el folio, como hoy `useEmisionLote.ts:406-408`).
  - `folios_hoy` se calcula para la **fecha del intento**, no para hoy (hoy es `hoyChile`, `jobs/route.ts:528`).
- **App:** al apretar Reanudar (`EmitirTabContent.tsx:737-770`), si hay `enVuelo` (o, sin rastro, si la
  pestaña A medias tiene un `sin_respuesta` de la tanda) → primero `verificarEnVuelo()`: adopta, arma el job con
  `buildBoletaJob({ verifyOnly: true, verifyWindow })` (ya existe, `useEmisionLote.ts:410-425`) y espera con el
  mismo `esperarDesenlace` (`:346-361`, timeout 180 s). Extraer ese bloque del driver a una función del hook
  reutilizable (hoy vive dentro de `emitirUna`).
- Interpretación con un puro nuevo `interpretarVerificacion({ desenlace, fechaIntento, hoy })`:
  - `emitida` → cierra (el server ya registró y levanta la lápida);
  - `fallida` con `verificado_sin_folio` **y** `fechaIntento === hoy` → la app cierra el job viejo `failed`
    (`running → failed` está permitido, `locks.ts:118`) y la boleta vuelve **al principio** de la tanda;
  - `fallida` de otro día → **a medias** (ver 1.6: /reportes muestra solo HOY y el calce exige la fecha del job,
    `sii-worker.js:1417,1421` → un "no salió" de ayer es falso);
  - todo lo demás → el job viejo se sella `revision_pendiente` y queda en A medias.
- Tras la línea de resultado, **el lote sigue solo** con `remainingIds` (sin pedir otro clic).
- Mismo cambio en el camino actual de emisión incierta: `useEmisionLote.ts:400` cierra el intento `failed`
  ANTES de verificar; si la pestaña muere ahí, la propuesta queda re-emitible. Con 1.1 ya no (la verificación
  colgada con `propuesta_id` es lápida), pero conviene no cerrar `failed` hasta tener el veredicto.

**Tests que fallan sin el cambio:**
- `lote-persist.test.ts`: base de 20, `procesadas = 16`, `itemActual = base[16]` → hoy `remainingIds[0] ===
  base[16]`; debe ser `base[17]` y `enVuelo.propuestaId === base[16]`.
- `adopcion.test.ts`: job de otro usuario → rechazo; job vivo de 1 min → `EMISION_EN_CURSO_PROPIA`; job
  colgado de 20 min → ventana `created_at → expires_at`; `fechaIntento` = fecha Chile del `created_at`.
- `interpretarVerificacion.test.ts`: "verificado sin folio" con intento de ayer → debe dar a medias (hoy el hook
  lo da por fallida y la propuesta queda re-emitible, `useEmisionLote.ts:431`).

**Riesgo:** la verificación abre el Resumen de ventas del SII (solo lectura, ya en uso desde 0.2.8). Si la
extensión instalada no tiene `verify_only` (< 0.2.8, publicada el 26-sep según memoria), no se verifica: el job
se sella a medias. Hay que detectarlo por versión en el PONG (hoy no hay capability para esto; ver §3).

**Clienta:** antes, Reanudar → la boleta 17 salía de nuevo (posible doble folio) y las demás reventaban con
"No se pudo iniciar" (ver 1.4). Después: "Reviso primero la boleta que quedó en el aire…" → una línea →
sigue con las 200 que faltan.

### 1.3 Cerrar solo con correlatividad como CONDICIÓN

**Hoy:** un folio con `evidence.source = "reportes_calce_unico"` cierra solo si no hay veto por otra lápida del
mismo monto (`result/route.ts:430-458`, `:907-909`). No se mira la secuencia.

**Cambio:**
- Puro nuevo `src/lib/emission/correlatividad.ts`:
  `juzgarCorrelativo({ folio, ultimoRegistrado }) → { cierra: true } | { cierra: false; foliosAjenos: number[]; motivo }`
  - cierra solo si `ultimoRegistrado != null && folio === ultimoRegistrado + 1`;
  - `folio > ultimo + 1` → `foliosAjenos = [ultimo+1 … folio-1]` (tope 20): son folios que el SII entregó y que
    massDTE no tiene (emisión a mano en el portal, u otra a medias);
  - `folio <= ultimo` o sin último → no cierra (motivo propio).
- `result/route.ts` junto a `vetoCalce` (`:907`): si `esCalceReportes(result)`, consultar
  `max(folio)` de `boletas_emitidas` por `empresa_id + tipo_dte` (**anuladas incluidas**; usa el
  `UNIQUE (empresa_id, tipo_dte, folio)` de `20260415_boletas_sii_mock.sql:84`) y exigir `cierra`. Si no, cae en
  la rama de evidencia débil (`:918-955`) → lápida `revision_pendiente`, y se guarda `foliosAjenos` + folio
  sugerido en `status_message`/`rememberResult` para que A medias los muestre.
- Se aplica a **todo** `reportes_calce_unico` (emisión normal y verificación): los dos son inferencia, no lectura
  del recibo. El folio leído del recibo (`high` sin calce) no cambia.
- A medias muestra aparte: "El SII tiene los folios 24172–24173 que no salieron de massDTE (¿los emitiste a
  mano?)" y el input de folio **prellenado con el sugerido** (un clic en "Confirmar folio").

Esto **no** es el "ancla último+1" que el adversario de 0.2.8 vetó: no asigna nada; solo exige que el calce
coincida con la secuencia. De paso ataja el bug de Tipo (`sii-worker.js:1421` ignora 39 vs 41): un folio 39
casi nunca es el siguiente de la serie 41.

**Test que falla sin el cambio:** `correlatividad.test.ts` (tabla de verdad) + un estático al estilo
`folio-ajeno.test.ts` que exige que la rama de `esCalceReportes` llame a `juzgarCorrelativo` antes de
`hasStrongEvidence`.

**Riesgo:** más "a medias" cuando la clienta emite también a mano, o cuando el SII salta de CAF (nuevo rango no
contiguo; **no verificado** si pasa en e-Boleta). Degrada a lo seguro, no cruza folios. Medir: boletas cerradas
sin humano / emitidas (la métrica de la promesa, memoria 26-sep).

**Clienta:** antes, un folio ajeno del mismo monto se podía registrar como suyo. Después, si algo no calza en la
secuencia, queda a medias con el folio sugerido listo para confirmar y la lista de "folios que no son de massDTE".

### 1.4 Reanudar no revienta en cadena

**Hoy:** `startJob` devuelve `null` ante cualquier rechazo (`useEmisionLote.ts:207`), incluido
`EMISION_BLOQUEADA` (el 409 trae `bloqueo.is_mine`, `jobs/route.ts:435-454`), `EMISION_EN_CURSO` y
`REVISION_PENDIENTE`. `emitirUna` lo convierte en "fallida" (`:261`) y el runner pausa por error en CADA boleta
(`lote-runner.ts:225-234`). Es lo que vivió LC a las 23:43.

**Cambio:**
- Extraer a puro `clasificarStartJob(status, json)` (hoy es inline en `:190-218`) con salidas nuevas:
  `bloqueada_propia` (EMISION_BLOQUEADA + `is_mine`), `bloqueada_ajena`, `en_curso` (EMISION_EN_CURSO),
  `a_medias` (REVISION_PENDIENTE / SIN_RESPUESTA).
- `DesenlaceItem` nuevo `{ estado: "frenada"; causa: "candado_propio" | "candado_ajeno" | "en_curso" }`: igual que
  `pausada_remota` (`lote-runner.ts:175-182`) **no consume el ítem** y detiene el lote sin pausa por boleta. El
  modal ofrece: `candado_propio`/`en_curso` → "Verificar y seguir" (1.2); `candado_ajeno` → "X está emitiendo;
  sigue cuando termine" (conserva el rastro).
- `a_medias` = se salta sin pausa (como `ya_emitida`, `lote-runner.ts:194-195`) y se cuenta en "a medias".

**Tests que fallan sin el cambio:** `lote-runner.test.ts`: driver que devuelve `frenada` en la 3ª → hoy el tipo
no existe; con él, `procesadas = 2`, `fase = "frenada"` y `alPausar` nunca llamado. `clasificarStartJob.test.ts`:
409 `EMISION_BLOQUEADA` con `bloqueo.is_mine = true` → `bloqueada_propia` (hoy `null`).

**Riesgo:** bajo; cambia solo qué hace el lote ante un rechazo. Cuidar que `en_curso` de la MISMA propuesta no se
confunda con uno de otra (el código trae la propuesta).

**Clienta:** antes, 200 avisos "Una boleta falló ¿Saltar y seguir?". Después, un solo aviso con la acción correcta.

### 1.5 "Liberar mi candado" en el lote: nunca `cancelled` con propuesta

**Hoy:** `DELETE /api/emision/jobs` usa `cancelled` si no le dicen otra cosa (`jobs/route.ts:55-60`) y lo aplica a
cualquier job propio `running` (`:642-647`). `cancelStaleLock` de la boleta única cierra `cancelled` el job del
candado activo (`EmitirDirectaView.tsx:1415-1423`), que **puede ser un job del lote** → la propuesta queda
re-emitible (riesgo C).

**Cambio:**
- Server, puro `estadoCierreSeguro(pedido, job, ahora)`: si el job tiene `propuesta_id` y se pide `cancelled` →
  se guarda `revision_pendiente`. Excepción: los `cancelled` que el mismo server pone antes de mandar nada a la
  extensión (`:479`, `:497`) no pasan por el DELETE, así que no se tocan.
- En la pestaña del lote, el botón no dice "liberar": dice **"Verificar y seguir"** y hace 1.2 (verifica). Si la
  extensión no puede verificar, sella a medias. Nunca cancela.

**Test que falla sin el cambio:** `estadoCierreSeguro.test.ts`: job con `propuesta_id`, pedido `cancelled` → hoy
el DELETE lo guarda `cancelled`; debe salir `revision_pendiente`. Boleta única (sin propuesta) sigue `cancelled`.

**Riesgo:** un job del lote cancelado a propósito antes de mandarse (p. ej. factura con datos incompletos) ya usa
`failed` (`useEmisionLote.ts:308`), no `cancelled`; no se afecta. Revisar otros llamadores del DELETE con `grep`.

**Clienta:** no ve diferencia en el uso normal; ya no existe el botón que abría la puerta al doble folio.

### 1.6 Medianoche: fecha real por boleta

**Hoy:** `hoy` se fija al abrir el modal (`EmitirLoteModal.tsx:74`) y viaja como `fechaEmision` de TODAS las
boletas (`:100`). El worker no rellena la fecha en el portal (solo la usa para calzar y registrar,
`sii-worker.js:1417,1545`). Un lote que cruza las 00:00 (LC emitía a las 23:37) registra boletas con la fecha
de ayer y el calce busca en la fecha equivocada → 0 candidatas → "no salió" → doble folio.

**Cambio:** `fechaEmision = chileDateString(new Date())` dentro de `emitirUna`, por boleta (y en la verificación,
la fecha del intento). Guarda en `interpretarVerificacion` (1.2) para el "otro día".

**Test que falla sin el cambio:** puro `fechaParaEmitir(ahora)` + test de que `loteItems` ya no lleva la fecha
(estático) o, mejor, mover el armado del item a una función pura `itemParaEmitir(item, ahora)` y testear que
dos llamadas a ambos lados de las 00:00 Chile dan fechas distintas.

**Riesgo:** ninguno conocido. **Clienta:** no lo ve; deja de pasar.

---

## 2. Tu propio candado no te bloquea

**Hoy:**
- `lock-visibility.ts:61-67`: con plan de equipo arma "NOMBRE está emitiendo desde su computador…" aunque
  `is_mine` sea `true` (calculado en `:51` y no usado).
- `EmitirTabContent.tsx:224` toma `lockedByOther`, que solo compara `job_id` con el job actual
  (`useEmissionLockStatus.ts:167`; en esta pestaña es `null`) → **cualquier** candado, incluido el propio, pinta la
  barra "Equipo" (`:976-979`), deshabilita Emitir (`:1003`) y bloquea con toast (`:514`). `lockedByOtherUser` y
  `myStaleLock` ya existen (`useEmissionLockStatus.ts:169-171`) pero la pestaña no los usa.

**Cambio:**
- `buildVisibleEmissionLock`: si `is_mine` → mensaje propio, nunca "Equipo". Si no es modo equipo y es ajeno
  (no debería pasar con 1 persona), el genérico de siempre.
- Puro nuevo `clasificarCandado({ lock, ahora, loteAquí, loteOtraPestañaAt })` →
  `libre | ajeno | propio_en_curso | propio_sin_respuesta`:
  - `ajeno` = `is_mine === false` (único que muestra "Equipo: NOMBRE…" y deshabilita Emitir);
  - `propio_en_curso` = mío y (lote corriendo en esta pestaña, u otra pestaña marcó `massdte:lote-vivo:<empresa>`
    en localStorage hace < 30 s — la escribe `useEmisionLote` cada 10 s mientras corre; cero costo de servidor);
  - `propio_sin_respuesta` = mío, sin pestaña viva y con el candado de hace > 3 min (`heartbeat_at` del candado =
    su creación, porque el lote no late).
- `EmitirTabContent.tsx`: barra y botón según la clase:
  - `propio_en_curso`: "Estás emitiendo en otra pestaña" (sin botón, se va sola);
  - `propio_sin_respuesta`: **"Tu emisión anterior quedó sin respuesta — [Verificar y seguir]"** → 1.2; Emitir
    habilitado (si la clienta aprieta Emitir, primero corre la verificación);
  - `ajeno`: igual que hoy, solo con otra persona real.
- Resultado en **una línea**, donde la clienta está mirando (la barra misma): "Salió con folio 24531 ✓" /
  "No salió: vuelve a Listas" / "Quedó a medias: la dejé en A medias".

**Tests que fallan sin el cambio:** `lock-visibility.test.ts`: `businessMode: true`, `is_mine: true` → hoy el
mensaje contiene "esta emitiendo desde su computador"; debe no contenerlo. `clasificarCandado.test.ts`: tabla de
verdad (mío + pestaña viva → en curso; mío + 20 min sin pestaña → sin respuesta; ajeno → ajeno).

**Riesgo:** la misma persona emitiendo desde **otro computador** (no hay flag cruzado): tras 3 min se le ofrece
"Verificar y seguir" aunque el otro siga vivo. Es seguro: verificar solo lee, el job viejo sigue protegido (1.1)
y el server exige > 3 min (1.2). Peor caso: dos emisiones concurrentes de la misma empresa; la correlatividad
(1.3) las manda a medias en vez de cruzarlas.

**Clienta:** antes, "Equipo: LC SERVICES está emitiendo… bloqueada" siendo ella sola, 15 min sin salida.
Después: "Tu emisión anterior quedó sin respuesta — Verificar y seguir", un clic, una línea, sigue.

---

## 3. Contrato lado app con la bitácora persistente de la extensión

La extensión (otro plan) anota ANTES de actuar, en `chrome.storage.local`: "voy a apretar EMITIR (job, monto,
hora)". La app la usa así:

**Mensajes (mismo canal `window.postMessage`, `source` como hoy):**
- Anuncio: el PONG agrega la capability `emision_bitacora_v1` (y, del mismo plan, `reportes_verify_v1` para no
  inferir `verify_only` por versión). `verificarExtensionCompatible` ya lee capabilities
  (`useExtensionStatus.ts:49`).
- Pregunta: `{ type: "APP_CONTABLE_SII_BITACORA_QUERY", job_ids: string[] }`.
- Respuesta: `{ type: "APP_CONTABLE_SII_BITACORA", entries: [{ job_id, etapa: "recibido" | "voy_a_emitir" |
  "folio_leido" | "cerrado", at_ms, monto, tipo_dte, fecha_emision, folio? }] }`. Solo datos del propio job (sin
  receptor).

**Cómo decide la app** (puro `leerBitacora(entries, jobId)`):
| Bitácora | Decisión |
|---|---|
| sin capability o sin entradas del job | como hoy: verificar con la ventana del server (`created_at → expires_at`) |
| `recibido` y **sin** `voy_a_emitir` | EMITIR nunca se apretó → cerrar `failed` sin ir al SII |
| `voy_a_emitir` | verificar con ventana exacta `at_ms − 2 min → at_ms + 6 min` |
| `folio_leido` | registrar con ese folio por el camino de `recover_latest`/result (evidencia fuerte existente) |

Solo se confía en la AUSENCIA de `voy_a_emitir` si hay un `recibido` del mismo job (prueba que la bitácora estaba
funcionando para ese job; un storage borrado no se confunde con "no apretó").

**Servidor:** opcional y barato: `PATCH /api/emision/jobs` (el que ya existe para el latido de la boleta única,
`jobs/route.ts:678+`) acepta `emit_intent_at` y lo guarda en una columna nueva `emision_jobs.emit_intent_at`
(migración `+ _DOWN`). Sirve a la conciliación (§4) y a la caja negra. La fuente de verdad sigue siendo la
bitácora de la extensión; esto es copia.

**Extensión vieja:** sin capability → la app nunca manda la pregunta y usa la fila de la tabla de arriba. Nada
se rompe.

**Test:** `leerBitacora.test.ts` (tabla de verdad). No hay "falla sin el cambio" porque es nuevo; el test de
contrato cruza el nombre de los mensajes contra el `background.js` como texto (estilo `version-sync.test.js`).

---

## 4. Conciliación nocturna automática (fase posterior, diseño alto nivel)

**Qué compara:** por empresa, tipo (39, 41; después 33/34) y día D: folios del SII (folio, monto, fecha/hora,
estado) vs `boletas_emitidas` del día D (anuladas incluidas). Puro `cuadrarDia(sii, app)` → 4 listas:
1. en el SII y no en la app, que calzan con una a medias/sin respuesta de D → proponer cierre (con §1.3);
2. en el SII y no en la app, sin calce → "folios que no son de massDTE" (informativo);
3. en la app y no en el SII → **alarma** (folio registrado que el SII no tiene = folio cruzado);
4. mismo folio, monto distinto → **alarma**.

**Quién la ejecuta:** un cron de Vercel **no puede** leer el portal: las claves del SII viven en la bóveda
cifrada de la extensión, no en el servidor (y así debe seguir). La ejecuta la **extensión** la primera vez que
la clienta abre la app al día siguiente (o antes de su primer lote), en segundo plano, solo lectura. La
extensión manda las filas crudas a `POST /api/emision/cuadre`; el server cuadra con el puro y guarda en una
tabla `emision_cuadres (empresa_id, fecha, tipo_dte, resultado jsonb, created_at)`.

**Dónde se ve:** si todo calza, nada (a lo sumo "Cuadre de ayer ✓" discreto). Si hay 1 → aparece en A medias
con el folio sugerido. Si hay 2 → línea informativa en A medias. Si hay 3/4 → `ops_event` crítico para nosotros
y un aviso claro a la clienta. Nunca en medio del flujo de emitir.

**Dudas abiertas (marcar antes de construir):**
- /reportes muestra solo HOY por defecto (memoria 26-sep). ¿Se cambia el rango sin clics (parámetro/API
  interna) o hay que tocar el selector de fecha? Es del plan de la extensión; sin eso no hay cuadre de "ayer".
- Costo de visitar el portal a diario por empresa (detección de bots, cuentas multiempresa que cambian de
  emisor en el portal).
- Paginación (máx. 250 por página) en días de 400-500 boletas.
- Facturas tienen filtros por GET sin captcha (`mipeAdminDocsEmi.cgi`, memoria): podrían ser las **primeras**
  en conciliarse, más fácil que boletas.
- ¿El RCV de ventas trae el resumen diario de boletas (rango de folios por día)? Si sí, sería una segunda fuente
  independiente. **No verificado.**

---

## 5. Largo plazo (solo mencionar)

Folios asignados por NOSOTROS antes de enviar (CAF propio / API): `reserveSimpleApiFolio` ya existe y se usa en
`jobs/route.ts:487-515` para el proveedor `simpleapi`. Con el folio conocido antes de emitir, el reintento es
idempotente de verdad y todo este plan pasa a ser red de seguridad. El portal es el problema porque el SII
asigna el folio al final.

---

## 6. Orden de ejecución (PRs chicos)

Flujo por PR: test que falla → arreglo → commit → revisor adversarial → corrección. Nada se publica mientras
LC/MH emiten (regla de `plan-costo-vercel` §8).

| # | PR | Contenido | ¿Necesita extensión nueva? |
|---|---|---|---|
| 1 | `fix/lapida-sin-respuesta` | 1.1 (lápida efectiva + A medias `sin_respuesta` + folio a mano) + 1.5 (DELETE nunca `cancelled` con propuesta) + 1.6 (fecha por boleta) | **No.** Sale ya. Correr antes el SELECT de 1.1. |
| 2 | `fix/reanudar-sin-cadena` | 1.4 (`clasificarStartJob` + `frenada`) + rastro sin la boleta en vuelo (parte de 1.2) | **No.** |
| 3 | `fix/candado-propio` | §2 completo (copy `is_mine`, `clasificarCandado`, flag entre pestañas) | **No.** |
| 4 | `feat/verificar-y-seguir` | 1.2 completo: adopción en el server, `verificarEnVuelo`, `interpretarVerificacion`, botón "Verificar" en A medias y en la barra, línea única | **No** para la 0.2.8 ya publicada (usa `verify_only`); con < 0.2.8 degrada a sellar a medias. Idealmente salir pegado al PR 1. |
| 5 | `fix/calce-correlativo` | 1.3 (correlatividad + folios ajenos + folio sugerido prellenado) | **No** (server). Mejora cuando la extensión arregle el Tipo. |
| 6 | `feat/bitacora-app` | §3 (lectura de la bitácora, `emit_intent_at`) | **Sí**: la versión con `emision_bitacora_v1`. La app sale antes y queda dormida hasta que llegue. |
| 7 | fase posterior | §4 conciliación | **Sí**: rango de fechas en /reportes + envío de filas. |

**Qué NO hacer (de los dos adversariales):** no acortar el TTL de 15 min antes de 1-4 (empeora el doble folio);
no agregar latido de la página + "rendirse a 90 s" (el latido de la página no prueba que la extensión viva); no
copiar el "liberar = cancelled" de la boleta única al lote; no "cuadrar las 300" en el camino de la clienta (solo
la boleta en vuelo es incierta; el resto es §4).

**Pendiente humano antes del PR 1:** la respuesta de Matías sobre el folio 24531 de LC. Con el PR 1 la propuesta
`641055e8` aparece sola en A medias como "sin respuesta"; si Matías confirma el folio, se registra a mano ahí.

---

## Revisión adversarial (2026-09-28)

> Revisor adversarial, SOLO LECTURA (sin código, sin base, sin portal). Rama local `fix/costo-vercel`.
> Cubre este plan y `plan-emision-confiable-2026-09-28-extension.md`. **[V]** = lo leí hoy en el código
> (archivo:línea). **[I]** = inferencia mía, no probada.

### Veredicto corto

Los dos planes apuntan bien: PR 1 (app) ya cierra los riesgos A y B en el servidor, y la 0.2.9 ataca las causas
de fondo. Pero hay **4 bloqueantes**: (1) la adopción a los 3 min puede producir un doble folio real; (2) la
medianoche sigue abierta en el camino de verificación que ya corre hoy; (3) las lápidas `sin_respuesta`
(sobre todo las retroactivas) pueden quedar **sin salida**; (4) los contratos de mensajes de los dos planes no
coinciden. También sobra harto: el §3 de este plan casi entero y dos mensajes nuevos de la extensión.

### Verificación de afirmaciones (muestra)

| Afirmación | Resultado |
|---|---|
| ext: clic `sii-worker.js:1896` y después aviso `:1897`; `assertEmisorNoCambio` `:1895` | **[V] cierta** |
| ext: DONE se manda sin esperar el ack (`background.js:294-308`) y se cierra solo a los 5 s (`sii-worker.js:91-104`) | **[V] cierta**. Además app-bridge postea el resultado a la página recién DESPUÉS del POST (`app-bridge.js:117-150`), así que con un POST >5 s el `result_needs_review` llega a la app ANTES que el resultado → la app resuelve "revisar" y frena (`useEmisionLote.ts:136-139`). H2 es consistente con el código; sigue [NV] que sea la causa dominante |
| ext: `close` post-emit sin ack → `result_needs_review` (`background.js:900-910`) | **[V] cierta** (`:897-903`) |
| ext: `aplicarUpdateSiOcioso` solo mira `activeJobs.size` (`:34-38`); PONG con `EXTENSION_VERSION` (`:1765`) | **[V] ciertas** |
| ext: el filtro de candidatas ignora Tipo (`sii-worker.js:1421-1422`) y exige `f.fecha === fechaJob` | **[V] cierta** |
| ext: `verificarEnReportes` usa `hasta_ms` como `final_emit_at` (`background.js:1466`) | **[V] cierta** |
| app: `revisarEnVuelo` solo mira `expires_at > ahora` (`propuesta-emitible.ts:82`) | **[V] cierta** |
| app: `hoy` fijo al abrir el modal (`EmitirLoteModal.tsx:74,100`); rastro `slice(procesadas)` (`:176-179`); `procesadas` sube después del `await` (`lote-runner.ts:184`) | **[V] ciertas** |
| app: DELETE default `cancelled` (`jobs/route.ts:55-60`); `cancelStaleLock` cierra `cancelled` (`EmitirDirectaView.tsx:1414-1418`) | **[V] ciertas** (el botón dice "Cancelar y emitir de nuevo", `:1770`) |
| app: `is_mine` calculado y no usado en el copy (`lock-visibility.ts:51,61-67`); la pestaña usa `lockedByOther` (`EmitirTabContent.tsx:224,513,976,1003`) | **[V] ciertas** |
| app: `closeJob(failed)` ANTES de verificar (`useEmisionLote.ts:400`) | **[V] cierta** |
| app 1.1: "`created\|running`" | **[V] matiz**: `acquireCuentaEmissionLock` inserta siempre `running` (`locks.ts:45`); `created` no aparece en lote. Inofensivo |

Ninguna afirmación resultó falsa. Hay dos omisiones que importan: la **rama de job cerrado** del result
(`result/route.ts:814`) y la **paginación de 250** de /reportes (`sii-worker.js:602,1471`). Las dos las detallo abajo.

---

### BLOQUEANTE

**B1. Adoptar un job "propio" vivo a los 3 min puede producir un doble folio (app 1.2 + §2, dos pestañas / dos computadores / worker vivo).**
- Evidencia: 1.2 adopta si el job tiene ≥3 min aunque no haya vencido, y le suelta el candado. Si la verificación
  dice "no salió" el mismo día, `interpretarVerificacion` lo cierra `failed` y la boleta **vuelve al principio**.
  Pero ese job puede seguir vivo: puede haber otra pestaña, otro computador, o (más probable) la **ventana worker
  viva**. El content script NO muere cuando muere el SW ni cuando se cierra la pestaña de la app
  (`sii-worker.js:1890-1897` corre solo). Un login o captcha humano lleva un job a más de 3 min sin problema. La
  verificación lee la tabla ANTES del clic original → "no salió" → re-emisión → el worker original aprieta EMITIR →
  **dos folios**. El plan lo llama "seguro: verificar solo lee", pero lo que sigue a "no salió" no es solo lectura.
- Arreglo: adoptar **solo si** (a) `expires_at + 2 min` ya pasó (el margen cubre el desfase de reloj del cliente),
  **o** (b) la extensión de ESTE navegador confirma que el job está muerto (no hay `job_state` ni pestaña worker, y
  la bitácora no tiene la entrada abierta). La (b) llega con la 0.2.9. Antes de eso, `propio_sin_respuesta` muestra
  "Tu emisión anterior se libera a las HH:MM" y **el botón aparece cuando corresponde**. En la extensión, además:
  chequear `job.expires_at` en el worker justo antes de `clickFinalEmitInDialog`, porque hoy solo se chequea en el
  scan (`background.js:928`).

**B2. La medianoche sigue abierta en la verificación que YA corre en producción; 1.6 sola no la cierra.**
- Evidencia: el calce exige `f.fecha === fechaJob` (`sii-worker.js:1421`) y /reportes muestra solo HOY. Caso: la
  boleta empieza el 27 a las 23:59:30 (fecha del job = 27), el clic cae el 28 a las 00:00:05 y el camino 4b
  (`useEmisionLote.ts:397-437`) verifica el 28. La tabla completa del 28 tiene la fila, pero la fecha no calza →
  0 candidatas → `verificado_sin_folio` → `fallida` → re-emitible (`:431`) → **doble folio**. La guarda "otro día"
  está en `interpretarVerificacion`, pero eso va en el **PR 4**, y la 0.2.9 (§3b) tarda días en llegar a la flota.
- Arreglo (app, PR 1, sin extensión nueva): en 4b, `verificado_sin_folio` solo vale si
  `chileDate(intentoDesdeMs) === chileDate(intentoHastaMs) === chileDate(ahora) === fechaEmision`. Si no, queda
  "revisar". Son 3 líneas y cierran el hueco con la 0.2.8 que ya está en la calle.

**B3. Lápidas sin salida: la clienta puede quedar TRABADA para siempre (app 1.1 retroactivo + A medias).**
- Evidencia: la pestaña A medias solo ofrece "Guardar folio" y dice "Estas boletas **sí salieron** en el SII"
  (`EmitirTabContent.tsx:816-835`). Con 1.1, un job que murió ANTES de EMITIR también entra ahí (el copy miente) y
  no tiene folio que escribir. "Verificar" no lo resuelve en tres casos:
  - (i) todo lo que no sea de HOY: /reportes = hoy, y el filtro de rango quedó para la 0.3.x;
  - (ii) más de 250 boletas en el día: la tabla nunca queda `completa` (`sii-worker.js:602`, `:1394`), así que ni
    "salió" ni "no salió" cierran (`:1433`). MH con lotes de 300-500 cae acá;
  - (iii) una lápida `revision_pendiente` verificada "no salió": el paso a `failed` está **prohibido**
    (`locks.ts:117-118`, `jobs/route.ts:642-645`), así que la lápida se queda. Además el servidor nunca ve el
    veredicto `verificado_sin_folio`: es solo un mensaje a la página (`background.js:1486`).
  - El SELECT de 1.1 casi seguro trae jobs viejos, y **todos** caen en (i).
- Arreglo:
  - (a) 1.1 aplica solo a jobs creados después del deploy. Los viejos se resuelven a mano: LC `641055e8` con la
    respuesta de Matías, y las 3 a medias del 27-sep.
  - (b) Una salida humana auditada: "Revisé el SII del DD-MM y no está → vuelve a Listas". Que muestre fecha, hora
    y monto del intento, pida confirmar, y se guarde como `declaracion_no_salio` en el job y en ops_event. Esto
    necesita una transición nueva en el servidor, `revision_pendiente|running vencido → failed`, **solo** con esa
    declaración o con un veredicto de verificación que la extensión persista (un POST a `/api/sii-local/result` con
    `verificado_sin_folio`, no un mensaje a la página).
  - (c) Cambiar el copy de A medias para `sin_respuesta`: "Puede que haya salido. Verifícala antes de re-emitir."
  - (d) Facturas 33/34 con `propuesta_id` también quedan como lápida y NO tienen verifyOnly (`useEmisionLote.ts:397`
    exige `!esFactura`). Para ellas: excluirlas de 1.1 (juntando con `propuestas_ia.tipo_dte`, porque
    `emision_jobs` no tiene tipo) o darles la salida (b).

**B4. Los contratos de los dos planes no calzan (bitácora, capability, `verify_of_job_id`, `estado_perdido`).**
- Bitácora: la extensión la **empuja** en el PONG (`bitacora_abierta`, etapas `intento|clic|resultado_enviado|…`)
  más el mensaje `…_BITACORA_CERRAR`. La app la **pide** (`…_BITACORA_QUERY` → `…_BITACORA`, etapas
  `recibido|voy_a_emitir|folio_leido|cerrado`). La regla estrella de la app ("`recibido` sin `voy_a_emitir` →
  failed sin ir al SII") depende de una etapa `recibido` que la extensión **no escribe**.
- Capabilities `emision_bitacora_v1` / `reportes_verify_v1`: la app las da por hechas y el plan de la extensión no
  las agrega (hoy no existen, `modules/sii-local.js:7-16`).
- `verify_of_job_id` (extensión §1) no aparece en la adopción de 1.2. Sin eso la extensión no puede usar `clic_at`.
- `estado_perdido` (extensión §2) no aparece en este plan. Hoy la app lo trata como subestado desconocido: sigue
  esperando hasta `expires_at + 5 s`, unos 15 min, y después "revisar" (`useEmisionLote.ts:141-142, 382-385`). Es
  el mismo cuelgue de hoy. Además, si la app lo mapea a "incierta → verificar" mientras la ventana worker sigue
  viva, cae en la carrera de B1.
- Arreglo (el contrato mínimo, uno solo):
  - (1) La app manda `verify_of_job_id` en todo job de verificación, y la extensión lee SU bitácora para la ventana.
    **La app no necesita leer la bitácora**; se borra el §3 de este plan.
  - (2) Capability `reportes_verify_v1` en la 0.2.9, para no inferir por versión.
  - (3) `estado_perdido` solo lo manda el SW después de preguntarle al worker (`tabs.sendMessage` "¿en qué vas?")
    y con la pestaña worker muerta o sin respuesta. Si el worker contesta, se re-adopta y se sigue capturando.
  - (4) La app: `estado_perdido` = `fallida` con `emisionIncierta` → 4b, y la verificación no concluye "no salió"
    hasta ≥3 min después del último clic posible (`max(intento_at, cierre de pestaña)`).
  - (5) Se borran `BITACORA_CERRAR` (la extensión ve todos los desenlaces y cierra sola) y `emit_intent_at`.

### IMPORTANTE

**I1. El veto F3 no ve las lápidas nuevas `sin_respuesta` (folio cruzado).**
- `calceReportesVetado` solo busca `estado = revision_pendiente` (`result/route.ts:437-441`). Caso: A queda
  `running` vencido ($50.000, su fila aparece en el SII) y B, del mismo monto, se verifica o captura por calce. La
  única fila en la ventana es la de A, y como A es `último+1`, **la correlatividad también pasa** → B se queda con el
  folio de A.
- Arreglo: el veto también cuenta `running` vencidos con propuesta (reusar `esLapidaEfectiva`) y lápidas de AYER
  (hoy `desde = fechaEmision`, `:432`).

**I2. La correlatividad tiene que ir también en la rama de job cerrado (`result/route.ts:814`).** Hoy esa rama
(red de seguridad: stash re-entregado después de vencer, job adoptado o expirado) acepta `reportes_calce_unico` con
solo `calceReportesVetado`. 1.3 solo la pone en `:907`.

**I3. "`folio === último+1`" deja trabadas las verificaciones tardías.** Si el lote siguió (1.4 salta las a
medias), el máximo registrado ya es mayor que el folio huérfano y ninguna verificación posterior cierra sola.
- Arreglo: cierra si `folio−1` está registrado (anuladas incluidas), `folio` no lo está, y en el tramo no hay otra
  lápida del mismo monto (el hueco es único). En el caso normal da lo mismo que último+1, y además resuelve las
  viejas.

**I4. `folios_hoy` es por tipo (`jobs/route.ts:532-533`).** Un 39 ya registrado del mismo monto sigue siendo
candidato para un 41 (lotes mixtos). Arreglo barato en el PR 1: `folios_hoy` con los folios 39 **y** 41 del día.
Solo quita candidatas, así que va en la dirección segura. No cubre un 39 emitido a mano; eso lo cubren la
correlatividad y el Tipo de la 0.2.9.

**I5. Emisión manual paralela del mismo monto.** Si la boleta en vuelo NO salió y la clienta emitió a mano el mismo
monto dentro de la ventana, esa fila es la única candidata y es `último+1` → se registra como nuestra. No es doble
folio, pero la venta real queda sin boleta. Solo la referencia propia (extensión §5) lo distingue. Dejarlo escrito
como riesgo aceptado, y medirlo.

**I6. El orden de la extensión en §1: escribir `intento` ANTES de `assertEmisorNoCambio`.** El `await` de hasta
2 s entre la última compuerta y el clic abre una ventana donde el modal se re-renderiza o cambia el emisor.
`assertEmisorNoCambio` + `activeEmitDialog()` tienen que seguir siendo lo último antes del clic.

**I7. La extensión revive `submitted && !finalEmitClicked` como `estado_perdido`, pero el worker probablemente
sigue vivo y va a clickear.** Ver B4 (3): preguntarle al worker antes. Ensayarlo en MV (abajo).

**I8. Registrar la fecha real.** El resultado registra `fecha_emision` del job (`sii-worker.js:1545`). Un clic
después de las 00:00 queda con la fecha de ayer en `boletas_emitidas` (libro de ventas). Usar la fecha de la fila o
del recibo cuando exista.

### MENOR

- M1. El TTL de la bitácora (7 días) es menor que el del stash (30). Una lápida verificada después del día 7 pierde
  `clic_at`. Mejor igualarlo a 30.
- M2. Con la extensión < 0.2.8, un job `verify_only` se llena y se frena por `allow_final_emit=false` (confirmado en
  0.2.6/0.2.7): no emite, pero se cuelga 180 s → a medias. Con 1.2 va a pasar en cada Reanudar. Gatear con
  `reportes_verify_v1` (B4) y, si falta, ir directo a "a medias" sin abrir ventana.
- M3. `pendientes-emision.ts:118-123` corta en `.limit(60)`. Con más lápidas, algunas desaparecen de A medias
  (el servidor igual las bloquea, así que es seguro, pero no se ven).
- M4. La boleta única conserva "Cancelar y emitir de nuevo" → `cancelled` sobre un job suyo que pudo emitir
  (`EmitirDirectaView.tsx:1414-1418`). 1.5 no lo cubre porque no tiene `propuesta_id`. Fuera de alcance; anotarlo.
- M5. El PONG con `getManifest().version`: sin riesgo mientras `version-sync.test.js` siga verde.

### Sobre-ingeniería (qué sacar del mínimo seguro)

- App §3 completo (`BITACORA_QUERY`, tabla `leerBitacora`, `emit_intent_at` + migración): **fuera**. La extensión
  usa su bitácora por dentro vía `verify_of_job_id`, y el `folio_leido` ya lo cubre el stash con evidencia fuerte.
- Extensión: `BITACORA_CERRAR` y `bitacora_abierta` en el PONG quedan para la fase de conciliación. En la 0.2.9
  basta con que el SW, al revivir, avise por la pestaña de la app las entradas `intento|clic` de su empresa, con el
  mismo filtro de `redeliverPendingResults`.
- App 1.3: la lista de "folios que no son de massDTE" puede esperar. Se deja la regla (I3) y el folio sugerido
  prellenado.
- §4 conciliación y la referencia propia: diferidas (de acuerdo con los dos planes).
- Se quedan porque son baratos y pagan: el flag `lote-vivo` en localStorage, la telemetría `sw_boot_at` y la
  query H1/H2 de hoy.

### Portal real ("jamás clic a ciegas")

Los dos planes respetan la regla: la verificación solo lee, el filtro de fechas queda diferido y el revivido nunca
manda `FILL_AND_EMIT`. Ojo: el worker **ya** hace clics en /reportes (v-select de 250 por página,
`sii-worker.js:1471-1474`, y el menú). No emiten, pero cualquier clic nuevo ahí (rango de fechas, ordenar, paginar)
necesita ensayo propio. Con el emisor de una clienta, **solo** JS de lectura.

Qué hay que ensayar en MV antes de publicar la 0.2.9 (además de la lista del §7 del plan de la extensión):
1. Stop del SW **a mitad de `FILL_AND_EMIT`** con `allow_final_emit=false`: confirmar que el worker sigue vivo y
   llega a la compuerta (valida I7 / B4-3).
2. Con la pestaña de la app cerrada a mitad de boleta: ¿la ventana worker termina sola? (valida B1).
3. Lectura de `thead` y la columna Tipo, SOLO LECTURA.
4. Boleta de $1.000 cerca de las 23:59 MV, si el calendario lo permite: fecha de la fila vs fecha del job (B2/I8).
5. Paginación >250: no se puede ensayar con MV (pocas boletas). Queda [NV] y se asume "a medias".

### Orden final recomendado (combinando los dos planes)

| # | Qué | Por qué en este lugar |
|---|---|---|
| 0 | Hoy, sin código: query H1/H2 (extensión §0.2) + SELECT de 1.1 + respuesta de Matías sobre 24531 | Decide el orden dentro de la 0.2.9 y el alcance retroactivo |
| 1 | **App PR 1** `fix/lapida-sin-respuesta`: 1.6 (fecha por boleta) + **B2** (guarda de día en 4b) + **I4** (`folios_hoy` 39+41) + 1.5 (DELETE nunca `cancelled` con propuesta) + 1.1 **acotado a jobs nuevos** + I1 (veto con `sin_respuesta`) + copy de A medias (B3c) + `registrar_folio_manual` acepta `sin_respuesta` | Cierra A, B y C y la medianoche **con la 0.2.8 de la calle**. Todo es servidor o app |
| 2 | **App PR 2**: copy `is_mine` (§2, 3 líneas) + 1.4 (`frenada`, sin cadena) + rastro sin la boleta en vuelo | Es el absurdo que vio LC. Riesgo bajo |
| 3 | **App PR 3**: salida humana auditada + transición `→ failed` validada (B3b) + exclusión o salida de facturas (B3d) | Sin esto, PR 1 puede trabar. Idealmente va **junto** al PR 1 |
| 4 | **Extensión 0.2.9**: DONE tras ack (primero si domina H2) → calce Tipo/fecha/`rango_cubre` (§3) → telemetría → bitácora (I6) → snapshot/rehidratar con pregunta al worker (B4-3) → chequeo de `expires_at` antes del clic (B1) → capability `reportes_verify_v1` | Un solo release; dos adversariales sobre §1+§2; ensayo MV de arriba |
| 5 | **App PR 4** (sale antes que la 0.2.9 y queda dormido): `estado_perdido` → 4b con espera ≥3 min; `verify_of_job_id`; gate por capability | Es el contrato mínimo de B4 |
| 6 | **App PR 5**: 1.2 "Verificar y seguir" con adopción **solo vencido o confirmado muerto** (B1) | Depende de 3 y 5 |
| 7 | **App PR 6**: 1.3 correlatividad con regla de hueco único (I3) en **las dos ramas** (I2) | Refuerzo; la 0.2.9 ya filtra Tipo |
| — | Diferido: app §3, `emit_intent_at`, §4 conciliación, filtro de fechas 0.3.x, referencia propia, paginación >250 | Fase posterior |

No publicar nada mientras LC o MH estén emitiendo, y no acortar el TTL antes del paso 6 (esto se mantiene).
