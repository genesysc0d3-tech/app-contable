# Plan — emisión confiable, lado EXTENSIÓN (2026-09-28)

> PLAN, no construcción. Área: `extensions/sii-portal-rpa/` (background.js, sii-worker.js,
> app-bridge.js, manifest). Todo lo que la app/servidor tenga que poner va marcado **[APP]**
> como dependencia, sin diseñarlo acá.
> Base: memorias `project_incidente_lc_candado_propio_2026_09_27`, `project_emision_se_frena_2026_09_27`,
> `project_cierre_ciclo_folio_2026_09_26`, `project_extension_025_vmenu`, regla "portal SII: jamás
> clic a ciegas", runbook `docs/runbook-rpa-sii-cambio.md`.
> Convención: **[V]** = verificado leyendo el código de hoy (archivo:línea). **[NV]** = no verificado
> (inferido o se sabe solo en el portal real → ensayo MV, SOLO LECTURA si es /reportes).

Versión en la calle: **0.2.8** (`manifest.json:5`, `modules/core.js:5`, publicada 2026-09-26 según
`EXTENSION_RELEASES.json`). Este plan termina en **UNA** versión nueva: **0.2.9** (§7). Se publica solo
por Chrome Web Store (`scripts/publish-extension.sh`), nunca .zip.

---

## 0. Lo que encontré leyendo el código (cambia el orden de prioridades)

1. **El "anotar" hoy es DESPUÉS del clic, no antes.** `sii-worker.js:1896` hace `clickFinalEmitInDialog`
   y recién en `:1897` `notifyFinalEmitClicked()` (que escribe la hora en `sessionStorage`, `:127-135`,
   y avisa al SW, `:147-159`). Si el SW o la pestaña mueren entre el clic y el aviso, no queda rastro
   en ningún lado de la extensión. **[V]**
2. **Hay una segunda causa candidata para "se frena cada ~20", distinta de la muerte del SW** **[NV, fuerte]**:
   - `handleCapturedResult` manda el overlay `DONE` apenas ENVÍA el resultado a la app, sin esperar el ack
     del POST (`background.js:294-308`).
   - El overlay `DONE` arma un auto-cierre de **5 s** que manda `close` (`sii-worker.js:91-104`).
   - `close` con `finalEmitClicked && !resultPersisted` → `result_needs_review` "Cerraste tras emitir y la
     boleta aún no se confirma guardada" (`background.js:900-910`) → el lote se detiene con "Me detuve…".
   - Es decir: **si el POST `/api/sii-local/result` (vía app-bridge, `app-bridge.js:117-150`) tarda más de
     5 s, el lote se frena solo, aunque la boleta sí se guarde.** Calza con el dato del 27-sep: LC 3 y MH 10
     casos "Cerraste tras emitir…" que terminaron **recuperados** (o sea, sí estaban guardados), y con Vercel
     al límite de CPU esa semana.
   - Y la muerte del SW explica el OTRO síntoma: el cuelgue MUDO de LC 23:37 (job `running` sin ningún
     resultado ni falla): sin `activeJobs`, `handleWorkerAction` contesta `JOB_NOT_FOUND` (`background.js:800-805`)
     y nadie le avisa a la app.
   - Cómo distinguirlas con la base de hoy (solo lectura, **no lo corrí**: el clasificador bloqueó la lectura
     a prod; lo corre el fundador o el orquestador): para los jobs con `status_message` "Cerraste tras emitir…"
     del 27-sep, comparar la hora de ese evento con `boletas_emitidas.created_at` del mismo job. Si la boleta
     aparece segundos DESPUÉS del aviso → es la carrera de los 5 s (H2), no el SW.
3. `aplicarUpdateSiOcioso` (`background.js:34-38`) solo mira `activeJobs.size`. Si el SW revivió sin estado a
   mitad de una emisión, el mapa está vacío y un update pendiente puede hacer `runtime.reload()` con una
   ventana del SII emitiendo. **[V el código; NV que haya pasado]**. Se arregla solo con §2.
4. El PONG informa `EXTENSION_VERSION` de `core.js` (`background.js:1765`), no `getManifest().version`
   (pendiente anotado desde 0.2.6). Va en la misma versión: es una línea. **[V]**

---

## 1. Bitácora "anotar antes de actuar" (write-ahead)

**Decisión: `chrome.storage.local`, no `.session`.** `storage.session` se borra al recargar o actualizar la
extensión y al reiniciar Chrome (y el auto-update de `background.js:34-60` hace `runtime.reload()`). La
bitácora tiene que sobrevivir justo a eso: el SW muerto, la extensión actualizada, Chrome caído (el caso LC:
la pestaña murió). `.local` ya se usa para el stash de folios (`background.js:333-362`), mismo patrón: una
clave por job para que no haya escrituras que se pisen.

**Cambio concreto**
- Clave `sii_emit_log:<job_id>` → `{ v:1, job_id, empresa_id, emisor_rut, tipo_dte, monto_total, fecha_job,
  intento_at, clic_at, estado, folio, updated_at, ext_version }`. Sin receptor ni glosa (sin PII extra).
  TTL 7 días, se poda en el PING como hoy se poda el stash (`background.js:376-400`).
- **La escribe el WORKER (content script), no el SW**, justo antes del clic: en `sii-worker.js`, entre
  `assertEmisorNoCambio(job)` (`:1895`) y `clickFinalEmitInDialog` (`:1896`):
  `await chrome.storage.local.set({...estado:"intento", intento_at: Date.now()})`. Los content scripts tienen
  acceso a `storage.local` sin pasar por el SW, así que la anotación no depende de que el SW esté vivo.
  **Regla dura: si el `set` falla o tarda más de 2 s → `siiError` PRE-emit `BITACORA_NO_ESCRITA` y NO se
  clickea.** Sin anotación no hay clic.
- Después del clic: `estado:"clic"`, `clic_at` (reemplaza/complementa el `sessionStorage` de `:127-135`; ese
  queda como respaldo).
- El SW la actualiza: `resultado_enviado` (en `handleCapturedResult`, `:264`), `persistida` (ack en
  `RESULT_PERSISTED`, `:1778-1797`), `a_medias` (cualquier `result_needs_review`), `no_salio` (verificación con
  tabla completa, `:1487`).
- **Cómo la recupera la app tras una caída:** extender el PING existente (no un canal nuevo). El PONG
  (`:1763-1770`) suma `bitacora_abierta: [{job_id, estado, intento_at, clic_at, tipo_dte, monto_total}]`,
  solo de la `empresa_id` del ping (mismo filtro que `redeliverPendingResults`, `:387-389`) y solo con estado
  `intento|clic|resultado_enviado`. Mensaje nuevo app→ext `APP_CONTABLE_SII_BITACORA_CERRAR {job_id,
  desenlace}` (agregar a `ALLOWED_TYPES`, `app-bridge.js:24-37`).
  **[APP]** al ver una entrada abierta de un job que la app no tiene cerrado → lanzar `verifyOnly` de esa
  boleta con la ventana de la bitácora (hoy `useEmisionLote.ts:397-437` solo verifica tras un fallo en vivo).
- El job de verificación trae `verify_of_job_id` (**[APP]**, en `buildBoletaJob`): `verificarEnReportes`
  (`background.js:1453-1493`) lee la bitácora de ESE job y usa `clic_at` exacto como `final_emit_at` en vez de
  `verify_window.hasta_ms` (hoy `:1466` usa la hora en que la app se enteró del fallo, no la del clic).
- Relación con `recover_latest`: no se toca. Ese es el stash del SERVIDOR (`sii_local_resultados`,
  `src/lib/emission/recover-latest.ts`); la bitácora cubre justo el hueco que él no ve (nuestro lado dejó de
  ver).

**Test que falla sin el cambio** (`boletas-sintetico.test.js`, fixture `fixtures/eboleta-modal.js`, con fake
de `chrome.storage.local`):
- "escribe `sii_emit_log:<job>` con estado `intento` ANTES del clic en EMITIR": el fake registra el orden
  (set → click). Con el worker 0.2.8 (`MASSDTE_WORKER_SRC=<git show 19effe7:…/sii-worker.js>`) falla.
- "si `storage.local.set` rechaza → no hay clic y el error es PRE-emit `BITACORA_NO_ESCRITA`".
- En `background-rescate.test.js` (arnés `extraer()` de funciones reales): el PONG trae `bitacora_abierta`
  filtrada por empresa; `RESULT_PERSISTED` la cierra.

**Riesgo:** una causa nueva de aborto pre-emit (storage lleno o lento). Mitigación: el aborto es PRE-emit
(reintentable, sin folio) y va a la caja negra con `code`. Cuota: sin `unlimitedStorage` hay ~10 MB; cada
entrada pesa <1 KB y el TTL poda.

**Ensayo MV:** emitir 1 boleta de $1.000 con MV (runbook §3) y leer en `chrome://extensions` → SW → consola:
`chrome.storage.local.get(null)` muestra la entrada `intento → clic → persistida`. Luego, con
`allow_final_emit=false` (perilla `massdte:boleta-ensayo=1`), confirmar que no queda entrada `clic`.

---

## 2. Estado de jobs fuera de memoria + keepalive de boletas + "estado perdido"

Hoy: `activeJobs = new Map()` (`background.js:19`), el `state` con `submitted`, `finalEmitClicked`,
`finalEmitAt`, `resultPersisted` nace en `openWorkerWindow` (`:1618-1645`) y vive solo en memoria. Facturas
tiene latido cada 10 s (`facturas-worker.js:1113-1124`, `:1134-1135`, recibido en `background.js:1670-1673`);
boletas no. **[V]**

**Decisión: el snapshot del state va en `chrome.storage.session`** (no `.local`): describe ventanas y
pestañas vivas que igual desaparecen si Chrome se cae; lo que tiene que sobrevivir a eso ya está en la
bitácora de §1. `.session` sobrevive a la muerte del SW, que es justo el caso.

**Cambio concreto**
- `persistirEstado(state)`: escribe `job_state:<job_id>` con `{jobId, kind, job, appTabId, appOrigin,
  workerWindowId, workerTabId, workerTabReusada, createdAt, submitted, finalEmitClicked, finalEmitAt,
  awaitingResult, resultPersisted}`. Se llama en cada cambio de esas banderas. **`submitted = true` se
  persiste con `await` ANTES de mandar `FILL_AND_EMIT`** (`background.js:1015-1022`): el SW también anota
  antes de actuar. `closeWorker` (`:445`) borra la clave.
- `rehidratar()` al arrancar el SW (top-level, devuelve una promesa `listo`). Por cada `job_state:*` cuya
  pestaña/ventana todavía exista (`chrome.tabs.get`), se restaura en `activeJobs` con `revivido: true`.
  Qué hace un job revivido — **nunca emite**:
  - `finalEmitClicked` → `captureWorkerResult` (capturar no emite; `:1495`).
  - `submitted && !finalEmitClicked` → incierto (la respuesta de `FILL_AND_EMIT` se perdió con el SW; pudo
    clickear) → status `estado_perdido` con `emision_incierta:true` + `clic_at` de la bitácora si existe.
  - `!submitted` → pre-emit seguro → cerrar la ventana y status `cancelled` "no se emitió nada".
- Los handlers que buscan el state por pestaña (`WORKER_ACTION` `:1660`, `FINAL_EMIT_CLICKED` `:1690`,
  `FACT_STEP` `:1676`, `windows.onRemoved` `:1996`, `tabs.onUpdated` `:2013`) esperan `listo` antes de decidir
  que no hay state.
- **Nunca mudo:** si después de rehidratar sigue sin state (`JOB_NOT_FOUND`, `:803`), el SW mira la bitácora
  por el `job_id` que manda el worker (`sii-worker.js:109-114` ya lo manda) y, si hay entrada `intento|clic`,
  busca las pestañas de la app (mismo `tabs.query` de `onInstalled`, `:73-75`) y les manda
  `APP_CONTABLE_SII_JOB_STATUS status:"estado_perdido"` ("La extensión perdió el hilo de esta boleta; hay que
  verificar en el SII antes de seguir"), no terminal. El worker hoy ignora la respuesta `JOB_NOT_FOUND`
  (`sii-worker.js:115-117` solo mira `lastError`): pasa a pintar `PAUSED` con ese mismo texto.
  **[APP]** `estado_perdido` = tratar como emisión incierta → verificar (no reintentar a ciegas).
- **Keepalive de boletas** (como facturas): latido `APP_CONTABLE_SII_KEEPALIVE` cada 10 s desde el worker
  mientras corren `FILL_AND_EMIT`, `CAPTURE_RESULT` y `VERIFICAR_REPORTES` (handlers en `sii-worker.js`
  `:2031`, `:2075`, `:2059`). El SW solo responde `ok`. Por qué igual con snapshot: el keepalive evita la
  muerte; el snapshot cubre la muerte que igual ocurra (Chrome puede matar el SW por otras razones).
  **[NV]** si una respuesta pendiente de `tabs.sendMessage` ya mantiene vivo al SW en Chrome ≥116: no lo sé;
  el latido lo vuelve irrelevante.
- `aplicarUpdateSiOcioso` (`:34-38`) espera `listo` y además mira que no haya `job_state:*` en `.session`.
- **Carrera de los 5 s (H2 de §0):** el overlay `DONE` y su auto-cierre se mandan cuando llega el ack
  (`RESULT_PERSISTED ok`, `:1778`), no al enviar el resultado (`:302-308`). Mientras tanto, overlay
  `LOCKED_AUTOMATION` "Guardando el folio N en massDTE…". Si el usuario aprieta cerrar antes del ack, se
  mantiene el mensaje de hoy (es verdad que no está confirmado). Si el ack no llega en 60 s, `PAUSED` con el
  folio visible (el stash sigue protegiéndolo, `:343-362`).

**Tests que fallan sin el cambio**
- `background-rescate.test.js` (arnés `extraer()`, agregar `MASSDTE_BACKGROUND_SRC=<ruta>` igual que
  `MASSDTE_WORKER_SRC` para correrlo contra 0.2.8):
  - "SW revivido: `WORKER_ACTION close` de una pestaña con `job_state` en session y `finalEmitClicked` →
    `result_needs_review`, no `JOB_NOT_FOUND`".
  - "sin state pero con bitácora `clic` → status `estado_perdido` a la app".
  - "revivido `submitted && !finalEmitClicked` → `emision_incierta:true`, jamás manda `FILL_AND_EMIT`".
  - "`submitted` se persiste ANTES de `FILL_AND_EMIT`" (orden de llamadas en el fake).
  - "DONE solo después del ack: resultado enviado sin ack + `close` a los 5 s → no hay `result_needs_review`
    si el ack llega a los 8 s" (fake timers).
- `boletas-sintetico.test.js`: "el worker late cada 10 s durante FILL_AND_EMIT" y "con respuesta
  `JOB_NOT_FOUND` pinta PAUSED, no queda en LOCKED".
- `background-flags.test.js` (a nivel de fuente): el PONG usa `getManifest().version`.

**Riesgo:** es el cambio más delicado. Un job revivido que emitiera sería una boleta doble. Candados:
(a) `revivido` nunca entra a la rama `FILL_AND_EMIT` (compuerta explícita al lado de `!state.submitted`,
`:1012`); (b) revivir solo si la pestaña existe; (c) `expires_at` sigue mandando pre-emit (`:928`). Dos
adversariales sobre este punto antes de publicar (regla del runbook para MOTOR).

**Ensayo MV:** (1) con `allow_final_emit=false`, abrir el job, ir a `chrome://serviceworker-internals` →
**Stop** del SW a mitad del llenado → la app recibe `cancelled`/`estado_perdido` (no silencio) y no se
emite nada. (2) Boleta real $1.000 MV: Stop del SW justo después del EMITIR (overlay "Boleta emitida") → el
folio se captura o queda `estado_perdido` + bitácora `clic`, nunca mudo. (3) Throttling de red del Chrome
DevTools en la pestaña de la app (POST lento >5 s) → el lote no se frena.

---

## 3. Los 3 bugs del calce en /reportes (arreglar ANTES de construir encima)

Código: `parseReportesTabla` (`sii-worker.js:1351-1404`), `calzarFolioEnReportes` (`:1411-1450`), decisión
"no salió" en `verificarEnReportes` (`background.js:1484-1488`).

**(a) Tipo 39 vs 41.** La columna se lee (`:1387`, `tipo: normalizeText(...)`) pero el filtro de candidatas
(`:1422`) no la usa → un folio 39 del mismo monto se asigna a una propuesta 41. **[V]**
- Cambio: libreto aditivo `reportes.tipo_exenta` / `reportes.tipo_afecta` (regex, con defaults en el worker,
  claves nuevas que ≤0.2.8 ignora). Candidata solo si el tipo de la fila calza con `job.tipo_dte`. Columna
  Tipo presente pero ilegible → la fila no cuenta y el calce no puede ser `high` (igual que `fechaIlegible`).
- **[NV] Qué columna trae exenta/afecta:** la tabla real tiene `Boleta` Y `Tipo` (memoria del 26-sep); no sé
  cuál dice "Exenta/Afecta" ni con qué texto. El fixture asume `Tipo = "Boleta exenta"` (`boletas-sintetico
  .test.js:545`). **Calibrar con MV, SOLO LECTURA** (JS que lee `thead th` y 3 filas; ni un clic).

**(b) Fecha.** `fechaJob = job.fecha_emision` (`:1417`), que viene del `hoy` fijado al abrir el modal
(`EmitirLoteModal.tsx:74`, `:100`) → lote que cruza las 00:00 tiene 0 candidatas. Y la hora ya envuelve la
medianoche (`:1442`) pero la fecha no. **[V]**
- Cambio en el worker: la fecha esperada sale de la hora REAL del clic (bitácora/`clic_at`, zona
  `America/Santiago`, como `horaChile` `:1344-1350`), no de `job.fecha_emision`. Si la ventana
  [clic − antes, clic + después] cruza la medianoche, se aceptan las dos fechas.
- **Candado anti doble folio (el importante):** el Resumen muestra por defecto solo HOY (memoria 26-sep). Si
  la fecha del clic ≠ hoy (reanudar al día siguiente) o la ventana cruza la medianoche, la tabla visible
  **no puede probar "no salió"**. Entonces: el worker marca `reportes_rango_cubre_emision:false` y el SW
  **nunca** manda `verificado_sin_folio` (`background.js:1484-1488` exige además ese flag) → queda a medias.
  Hoy, con la tabla completa de hoy y 0 candidatas, dice "no salió" aunque la boleta sea de ayer → re-emisión.
- **[NV] ¿/reportes deja filtrar rango de fechas?** El worker hoy no toca ningún filtro de fecha (no hay
  código de fecha/rango en `sii-worker.js`); solo sabemos "el rango por defecto es HOY", lo que sugiere que
  hay un control. **A verificar en ensayo MV, SOLO LECTURA** (mirar el DOM del filtro con JS, sin tocarlo).
  Usarlo sería otra versión (0.3.x), porque es un clic nuevo en el portal y merece su propio ensayo.
- **[APP]** `folios_hoy` debería traer también los folios de ayer cuando la ventana cruza la medianoche; y el
  `fecha_emision` que registra el server para una boleta emitida tras las 00:00.

**(c) Ventana horaria desde la bitácora.** Hoy `readFinalEmitAt` (`sii-worker.js:136-145`) lee
`sessionStorage` de la pestaña y, de respaldo, `ctx.final_emit_at` = `state.finalEmitAt` (memoria del SW,
`background.js:1507`, `:1694`). Tras una caída real no queda ninguna → `sin_hora_emitir` → a medias. **[V]**
- Cambio: orden de lectura `bitácora (storage.local, clic_at → si no, intento_at)` → sessionStorage → ctx.
  El worker puede leer `storage.local` directo. Con solo `intento_at` (el clic no alcanzó a anotarse) la
  ventana es [intento − 1, intento + 6] min.

**Tests que fallan sin el cambio** (`boletas-sintetico.test.js`, bloque "cierre del ciclo" `:569+`, correr
con `MASSDTE_WORKER_SRC` = worker 0.2.8 para verlos fallar):
- "fila tipo 39 del mismo monto y hora, job 41 → NO es candidata" (0.2.8 da `high` con el folio ajeno).
- "clic 23:59:30, fila 28/09 00:00:10, job con `fecha_emision` 27/09 → `high`" (0.2.8: 0 candidatas).
- "clic de ayer, tabla completa de hoy sin la fila → NO `reportes_tabla_completa` utilizable para 'no
  salió'" + en `background-rescate.test.js`: "`verificarEnReportes` con `reportes_rango_cubre_emision:false`
  → `result_needs_review`, nunca `verificado_sin_folio`".
- "sin sessionStorage ni ctx, con bitácora `clic_at` → `high`" (0.2.8: `sin_hora_emitir`).
- `libreto-compat-flota.test.ts`: las claves nuevas de `reportes` no rompen a 0.2.1-0.2.8.

**Riesgo:** bajo si todo cambio solo QUITA candidatas o degrada a medias; el único que agrega candidatas es
aceptar dos fechas en la medianoche, y sigue exigiendo calce único + hora en ventana + dos lecturas estables.

**Ensayo MV (SOLO LECTURA en /reportes):** leer headers y filas reales para calibrar (a); mirar el control de
fecha para (b); una boleta $1.000 MV con la tabla leída después → `high`.

---

## 4. Telemetría: confirmar la causa del "se frena cada ~20"

**Cambio concreto**
- Top-level de `background.js`: `const SW_BOOT_AT = Date.now()` y agregarlo a un anillo en `storage.local`
  `sw_boots` (últimos 50 arranques, `{at, motivo}` con `motivo` = `install|update|startup|desconocido` desde
  `onInstalled`/`onStartup`).
- Se manda en: el PONG (`sw_boot_at`, `sw_boots_24h`), cada `statusMessage` terminal y el `result` (campo
  `diag: { sw_boot_at, job_created_at, revivido, ms_resultado_a_ack, ms_resultado_a_close }`). El `result`
  viaja por app-bridge a `/api/sii-local/result` y queda en `sii_local_resultados.result` (7 días); el
  servidor pasa el objeto por `sanitizeResultForLog` genérico (`src/app/api/sii-local/result/route.ts:94-120`),
  así que números sueltos deberían pasar **[NV, confirmar en el primer resultado]**.
- `ms_resultado_a_close`: tiempo entre enviar el resultado y el `close` del overlay; mide directo H2.

**Cómo leerlo** (runbook §1, solo lectura):
- H1 (SW murió): `result->'diag'->>'sw_boot_at' > result->'diag'->>'job_created_at'` o `revivido = true`.
- H2 (carrera de 5 s): `ms_resultado_a_ack > 5000` en jobs que terminaron "Cerraste tras emitir…".
- Hoy mismo, sin release: la query de §0.2 (hora del aviso vs `boletas_emitidas.created_at`).

**Test:** `background-flags.test.js` a nivel de fuente (existe `SW_BOOT_AT` y se incluye en PONG y `diag`);
arnés: `handleCapturedResult` agrega `diag` sin pisar campos del resultado.

**Riesgo:** casi nulo (aditivo). No manda PII.
**Ensayo MV:** Stop del SW en `chrome://serviceworker-internals` → el siguiente PONG trae `sw_boot_at` nuevo.

---

## 5. Opción B (NO construir): referencia propia en la boleta

Pendiente de decisión del fundador: **la clienta final la ve impresa**.

- **Qué:** una marca corta derivada de la PROPUESTA (no del job), p. ej. `Ref MD-7F3K` (4-5 caracteres
  base32 de un hash de `propuesta_id`). Por propuesta y no por intento: dos boletas con la misma ref = doble
  folio probado, sin adivinar.
- **Dónde:** al final de la glosa del Detalle. La glosa ya se recorta a 80 caracteres
  (`boleta-job-payload.ts:95`); la ref come ~12 → recortar la glosa a 68 **[APP]**. El job hoy no trae
  `propuesta_id` (`boleta-job-payload.ts:60-81`) → agregarlo **[APP]**. El worker la escribe con el mismo
  camino de la glosa (sin cambio de MOTOR si va dentro del texto de la glosa).
- **Cómo calzaría:** (1) post-emit, el PDF capturado (`capturePdfBytes`, `background.js:240-262`) se busca
  por la ref → evidencia de extremo a extremo sin monto+hora; (2) en /reportes NO sirve directo: la tabla no
  muestra el detalle y abrir el documento es el botón "receipt" (un clic en el portal real) → la conciliación
  por ref sería con el PDF, o un cuadre nocturno aparte.
- **[NV]:** si el SII limita el largo del detalle en e-Boleta o lo corta al imprimir. Ensayo MV.
- **Costo de no hacerlo:** el calce sigue siendo monto + tipo + fecha + hora; ambiguo con montos repetidos
  en la misma ventana (queda a medias, seguro pero manual).

---

## 6. Orden de ejecución

1. **Ya, sin release:** correr la query de §0.2 (H1 vs H2). Si H2 domina, §2-"carrera de 5 s" pasa a ser lo
   primero dentro de la 0.2.9.
2. Rama `fix/extension-emision-confiable` desde `dev`.
3. §4 telemetría (aditiva, base para medir lo demás).
4. §3 calce (a)(b)(c) — solo quita candidatas o degrada; se calibra en el mismo ensayo MV de lectura.
5. §1 bitácora (worker escribe antes del clic; PONG la informa).
6. §2 snapshot + rehidratar + `estado_perdido` + keepalive + DONE tras ack + PONG con versión del manifest.
7. Dos adversariales sobre §1+§2 (MOTOR, flujo irreversible).
8. Ensayo MV completo (§7) → publicar.
9. **[APP]** en paralelo, pero se ENCIENDE después de que la 0.2.9 esté en la flota: leer `bitacora_abierta`
   y `estado_perdido` → verifyOnly; `verify_of_job_id`; `folios_hoy` con ayer.

## 7. Qué va junto en UNA versión: 0.2.9

Todo §1-§4 en una sola publicación (cada versión es una revisión de la Web Store y ~5 h de rollout). Todo es
aditivo para la app: una app vieja ignora `bitacora_abierta`, `diag` y `estado_perdido` (llega como status
no terminal desconocido **[NV: confirmar cómo trata la app un status desconocido]**).
Fuera de la 0.2.9: filtro de rango de fechas en /reportes (0.3.x, necesita su propio ensayo) y la ref propia
(§5, decisión de producto).

Compuertas antes de `bash scripts/publish-extension.sh 0.2.9` (con «sí» explícito del fundador):
- 4 puntos de versión parejos (`version-sync.test.js`: manifest, manifest.prod, core.js, `src/lib/extension.ts`).
- `npx vitest run extensions/sii-portal-rpa` verde, y los tests nuevos **fallando** contra 0.2.8
  (`MASSDTE_WORKER_SRC` / `MASSDTE_BACKGROUND_SRC` apuntando a `git show 19effe7:...`).
- `FACT_WORKER_EN_PESTANA = false` (`background-flags.test.js`).
- Ensayo MV (runbook §3, emisor MV 77.155.156-4, montos $1.000, empresa activa MV en la app, perilla de
  ensayo verificada en consola): (1) lectura de /reportes (headers, Tipo, filtro de fecha); (2) emisión
  normal → bitácora `persistida` + `diag`; (3) Stop del SW pre-emit y post-emit; (4) POST lento >5 s;
  (5) popup tapado (rAF). Nunca el emisor de una clienta; su portal es solo lectura.
- Entrada en `EXTENSION_RELEASES.json`, `CHROMEWEBSTORE.md` (historial; sin permisos nuevos: `storage` ya
  está en `manifest.json`) y Q1 del runbook en cero tras el rollout.
- No publicar mientras LC/MH estén emitiendo un lote (el auto-update espera `activeJobs` vacío, pero con la
  0.2.8 ese mapa puede mentir: §0.3).
