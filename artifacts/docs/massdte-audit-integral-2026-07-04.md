# Auditoría integral massdte — 2026-07-04

Auditoría multi-agente (9 lentes en paralelo + verificación adversarial de 2 votos sobre cada hallazgo alto) sobre `dev` post-promoción a producción (PRs #28–#42). 43 agentes, ~41 min. **Solo lectura** — ningún archivo modificado.

Método: cada hallazgo alto se sometió a dos refutadores independientes (uno de corrección de código, uno de reproducibilidad). CONFIRMADA = ambos fallaron en refutarlo. PLAUSIBLE = uno lo confirmó. REFUTADA = ambos lo tumbaron (excluida).

**Conteo:** 14 altas confirmadas · 2 altas plausibles · 51 medias · 26 bajas.


---

## 🔴 ALTAS CONFIRMADAS


### Envenenamiento cross-tenant del parser: cache global de adapters por fingerprint con first-writer-wins

**Lente:** Seguridad de API y autorización · **`src/lib/parsers/adapter-store.ts:40`**


getAdapterByFingerprint busca en parser_adapters SOLO por fingerprint, sin filtro de empresa, y el orquestador lo usa como Capa 0 (orchestrator.ts:56) para TODOS los tenants. Cualquier usuario autenticado puede registrar vía POST /api/guardar-formato un adapter 'manual' con confianza 1.0 para el fingerprint de un banco popular (el fingerprint es el header row, y /api/preview-formato se lo devuelve para cualquier archivo). El fix anti-poison (auditoría #2) solo impide SOBRESCRIBIR un adapter ajeno — no impide que el PRIMER escritor sea malicioso: su mapping (p.ej. monto→columna saldo) se aplica silenciosamente a las cartolas de todas las demás empresas con ese formato, produciendo montos incorrectos que terminan en boletas SII reales. decrementAdapterConfianza solo castiga fallos de parseo, no columnas intercambiadas que parsean 'bien'.


```
const { data, error } = await sb
  .from("parser_adapters")
  .select("*")
  .eq("fingerprint", fingerprint)   // sin filtro de empresa
  .maybeSingle();
// guardar-formato/route.ts:65-66: first-owner-wins — el compartido se conserva
```


**Fix:** Priorizar el adapter propio de la empresa (fingerprint + creado_por_empresa_id) y solo caer a adapters globales de source heurístico/dueño null; un adapter 'manual' de otra empresa no debería aplicarse cross-tenant sin validación/curaduría.


*Verificación:* CONFIRMADO. El código hace lo que el auditor describe y ninguna otra capa lo neutraliza por completo.

Evidencia verificada:
1. adapter-store.ts:37-41 — getAdapterByFingerprint filtra SOLO por `.eq("fingerprint", fingerprint)` (sin empresa). Solo exige confianza≥0.5 y no-disabled; el adapter malicioso tiene confianza 1.0. Confirmado.
2. orchestrator.ts:56 — es Capa 0 para TODOS los tenants (parseExcel → parseExcelWithOrchestrator, usado por document-processing/queue.ts:261). Confirmado.
3. guardar-formato/route.ts:5-92 — cualquier usuario autenticado con empresa puede registrar un adapter `manual`, confianza 1.0, mapeo de columnas arbitrario (desde body.roles). preview-formato/route.ts:34,73 devuelve el fingerprint de cualquier archivo. Confirmado.
4. Fix anti-poison (route.ts:64-67 y adapter-store.ts:72-77): solo bloquea SOBRESCRIBIR un adapter existente de otra empresa (first-owner-wins) — NO impide que el PRIMER escritor sea malicioso. Confirmado.
5. decrementAdapterConfianza (adapter-store.ts:179) solo baja confianza cuando tryApply falla el validador; columnas intercambiadas que parsean "bien" no se castigan. Confirmado.

Mitigación parcial existente que NO cierra el hueco: el validador (validator.ts). El único chequeo con certeza matemática contra mapeo de columnas erróneo es checkSaldoMonotonia (Check 6), pero está gated a `layout === "two_cols"` (validator.ts:75). guardar-formato SIEMPRE construye `layout: "single_col"` (route.ts:47) → ese chequeo se salta justo para el vector de ataque. Los checks 1-5 (fechas válidas, monto>0, monto<100 mil millones) atrapan mapeos groseros (p.ej. monto→columna fecha) pero no un mapeo plausible como monto→saldo, que produce enteros positivos válidos y pasa validación → montos incorrectos con confianza 1.0 vía Capa 0.

Matiz que acota (no refuta) la explotabilidad: los adapters heurísticos se autocrean con creado_por_empresa_id=null en el primer upload exitoso (saveAdapter), y un guardar-formato posterior contra ese fingerprint queda rechazado (null !== empresa atacante). Por tanto la ventana de envenenamiento es solo ANTES de que exista cualquier adapter para ese fingerprint: (a) formatos que la heurística/named NO detecta (precisamente los que se mapean a mano) nunca autocrean adapter, quedando abiertos; y (b) carrera para ser el primero en un formato nuevo. Además hay revisión humana antes de emitir, pero montos sutilmente errados pueden aprobarse.

El defecto de diseño (cache global cross-tenant + first-writer-wins + chequeo decisivo bypasseado para single_col + endpoint abierto a cualquier tenant) es real y alimenta documentos tributarios; severidad ALTA defendible. real=true. / CONFIRMADO tal como se describe; severidad ALTA justificada. Cadena verificada en código real:

1) Lectura sin filtro de tenant: adapter-store.ts:37-41 (getAdapterByFingerprint) consulta parser_adapters SOLO por fingerprint, con service-role (RLS bypass). Sin empresa_id.
2) Aplicado a todos los tenants: orchestrator.ts:56 (Layer 0) solo exige confianza>=0.5 y no-disabled; queue.ts:361 pasa el resultado a procesarDocumento(job.empresa_id, ..., preExtracted) — los montos del adapter compartido se usan para el documento de OTRA empresa.
3) Escritura por cualquier autenticado: guardar-formato/route.ts:76-88 inserta adapter confianza 1.0 con creado_por_empresa_id del atacante; layout hardcodeado a single_col (línea 48).
4) El fix anti-poison solo bloquea SOBRESCRITURA: guardar-formato:64-67 y adapter-store:72-77 devuelven el id existente cuando el dueño difiere, pero el PRIMER insert para un fingerprint nuevo NO se bloquea. El hallazgo apunta exactamente a esto.
5) El fingerprint se entrega al atacante: preview-formato/route.ts:34,71 lo devuelve para CUALQUIER archivo; fingerprint.ts:19-28 es estructural (sin valores) → cualquier archivo con la misma estructura de columnas del banco produce el mismo hash (premisa de compartición cross-tenant).
6) Se evita el chequeo más fuerte: validator.ts:75 corre la monotonía de saldo (detección de column-mapping con 'certeza matemática') SOLO si layout==='two_cols'. guardar-formato siempre emite single_col → un swap monto→saldo nunca se detecta. Los chequeos restantes (monto>0, fecha válida, conteo) aceptan valores de saldo como montos.
7) El envenenamiento se auto-refuerza: un config con columnas intercambiadas que parsea 'bien' dispara incrementAdapterSuccess (orchestrator.ts:65), subiendo confianza hacia 1.0. decrementAdapterConfianza solo actúa ante FALLO de parseo, no ante salida válida-pero-semánticamente-incorrecta — coincide con el hallazgo.

Secuencia concreta explotable: atacante (auto-registrado, con empresa) elige un formato mono-columna aún no auto-adaptado (heurística/named no lo parsean → cae a legacy → no se guarda adapter compartido) → sube un mímico estructural a /api/preview-formato y obtiene el fingerprint → POST /api/guardar-formato con rol 'monto' mapeado a la columna saldo → insert exitoso (no hay fila previa) → la víctima (otra empresa) sube su cartola real de ese formato → Layer 0 devuelve el adapter del atacante → applyAdapter lee montos de la columna de saldo (running balance) → pasa validación (single_col salta monotonía) → montos incorrectos fluyen vía preExtracted al bypass del processor → propuestas de boletas con montos erróneos para la víctima.

Matiz mitigante (no refuta): first-writer-wins exige registrar antes de que exista un adapter heurístico/named para ese fingerprint (saveAdapter los crea con dueño null en el primer parse exitoso y bloquearía el insert). Por tanto la ventana es: formatos que las capas automáticas no cubren (caen a legacy, sin adapter) o ser el primero en encontrar un formato nuevo — que es justamente la población que sirven los adapters manuales. La ventana es real, no teórica. Impacto: corrupción cross-tenant de montos que terminan en documentos tributarios propuestos (boletas SII). Exploit por usuario autenticado sin privilegios. ALTA confirmada.


### Carril REAL: resultado que llega tras expirar el job (15 min) se rechaza SIN guardarse — boleta real emitida en el SII queda invisible e induce re-emisión duplicada

**Lente:** Pipeline de emisión (plata / SII) · **`src/app/api/sii-local/result/route.ts:390`**


El job sii_local vive 15 min (jobs/route.ts:224 `ttlSeconds: provider === "sii_local" ? 15 * 60 : 5 * 60`) y el heartbeat NO extiende expires_at (api/emision/jobs/route.ts:437 solo actualiza `heartbeat_at`). Si el RPA demora más (SII lento, 2FA, reintentos de PDF 403 — y el motor masivo planea cadencia humana con jitter), el POST del resultado cae en `requireEmisionJob` → EMISION_JOB_EXPIRED (lib/emission/jobs.ts:30) y el handler retorna en las líneas 391-404 SIN llamar `rememberResult`: el resultado no queda en sii_local_resultados, así que `recover_latest` tampoco puede recuperarlo. La boleta REAL (emision_sandbox:false) existe en el SII pero no en la app; la extensión ve un 409, el usuario cree que falló y re-emite → boleta real DUPLICADA en el SII (sin NC para revertir). El backfill vía /api/sii-local/reconcile mitiga la invisibilidad pero no evita el duplicado ya emitido.


```
// jobs.ts:30-33
if (new Date(job.expires_at).getTime() <= Date.now()) return { ok: false, status: 409, error: "EMISION_JOB_EXPIRED" };
// result/route.ts:391-404 — gate falla → recordOpsEvent + return, SIN rememberResult
if (!jobGate.ok) { ... return NextResponse.json({ ok: false, error: jobGate.error, ... }, { status: jobGate.status }); }
```


**Fix:** Que el heartbeat extienda expires_at/locked_until del job y lock; y en el path de gate fallido del result, persistir igual el payload en sii_local_resultados (status 'job_expired') para que recover_latest/reconcile lo levanten en vez de perderlo.


*Verificación:* CONFIRMADO en todas sus partes, con agravantes. (1) TTL fijo: jobs/route.ts:224 crea el job sii_local con ttl 15 min y locks.ts:24,43-44 fija expires_at=locked_until=creación+15min. (2) El heartbeat NO extiende la expiración: el PATCH (jobs/route.ts:435-460) solo actualiza heartbeat_at/estado_visible, nunca expires_at. (3) La extensión valida expiración SOLO al aceptar el job (modules/sii-local.js:30), no antes del click final de emisión, y el flujo tiene etapas con humano en el loop sin tope de tiempo (login manual SII/desbloqueo de bóveda, acción 'retry' en background.js:221) — una emisión real puede completarse pasado el minuto 15. (4) result/route.ts:390-404: gate expirado → recordOpsEvent (cuya metadata NO incluye el folio ni el result) → return 409, sin rememberResult; todas las llamadas a rememberResult están después del gate. La extensión no guarda copia local (sin chrome.storage) ni reintenta: app-bridge.js:64-79 postea UNA vez y reenvía el error a la página. (5) recover_latest es doblemente inútil aquí: no hay fila en sii_local_resultados Y además re-entra al MISMO gate con el mismo job_id expirado (result/route.ts:390), por lo que devolvería 409 aunque hubiera fila. (6) El fallback manual (persistVisibleSiiFolio, EmitirDirectaView.tsx:1030-1081) postea al mismo endpoint con el mismo job expirado → mismo 409: el usuario ve el folio real en pantalla y no tiene forma de registrarlo; la única vía de crear un job nuevo es sendLocalSiiJob (línea 976), que despacha un RPA completo con auto_emit:true → emite OTRA boleta real (nuevo folio, el dedupe por empresa+tipo+folio de result/route.ts:457-463 no protege). (7) La UI muestra 'No se marca como emitida' + toast de error (EmitirDirectaView.tsx:674-684), el lock expira solo (locks.ts:27-31 borra locks vencidos), así que el reintento está habilitado e inducido. (8) Agravante: /api/sii-local/reconcile existe pero NO tiene ningún caller en src/ ni en extensions/ (grep exhaustivo) — el backfill ni siquiera está cableado, y de todos modos no revierte el duplicado ya emitido. Es carril REAL (emision_sandbox:false, result/route.ts:578) y el proyecto descartó NC (61) como feature: boleta tributaria real invisible + duplicado real irreversible = severidad ALTA justificada. / CONFIRMADO con evidencia de código en cada eslabón. (1) TTL: jobs/route.ts:224 fija ttlSeconds=15*60 para sii_local y locks.ts:24,43 escribe expires_at una sola vez; el heartbeat PATCH (jobs/route.ts:435-438,456-460) actualiza solo heartbeat_at/estado_visible — grep confirma que NADA extiende expires_at. (2) Gate: jobs.ts:30 devuelve 409 EMISION_JOB_EXPIRED y result/route.ts:390-404 retorna SIN rememberResult (el ops_event solo guarda el código de error, no el folio/PDF), así que el resultado se pierde y recover_latest no encuentra nada; peor aún, recover_latest re-ejecuta el gate con el job_id recuperado (expirado) → 409 también, y el rescate manual persistVisibleSiiFolio reusa el mismo jobId expirado → 409. (3) Secuencia concreta y realista: la extensión valida expiry SOLO al aceptar el job (background.js:629 → sii-local.js:30) y luego puede quedar en waiting_manual_login indefinidamente (background.js:345-355, vault bloqueada/captcha/2FA, mensaje explícito 'Inicia sesión manualmente y continuaremos automáticamente'); cuando el usuario loguea al minuto 16+, scanWorkerPage auto-emite SIN re-chequear expiry (background.js:305-334, auto_emit, confirmation_required:false) → boleta REAL en el SII; app-bridge.js:65 postea el resultado → 409 → descartado; la UI muestra 'Boleta SII no quedó guardada en la app' (EmitirDirectaView.tsx:684) y el usuario re-emite → folio nuevo REAL duplicado; el aviso de duplicados (boleta-duplicados) consulta boletas_emitidas donde la primera boleta no existe, y no hay NC por diseño. (4) Incluso la mitigación citada es más débil de lo dicho: /api/sii-local/reconcile no tiene NINGÚN caller en el repo (ni UI ni extensión). Severidad ALTA justificada: pérdida silenciosa del registro de un documento tributario real + inducción a duplicarlo ante el SII, disparada por demoras humanas que el propio flujo contempla.


### Reintentos del job duplican movimientos: procesarDocumento no es idempotente y el modo bypass no tiene dedup

**Lente:** Integridad de datos (operaciones destructivas) · **`src/lib/ai/processor.ts:647`**


procesarDocumento nunca limpia inserciones previas del mismo documento_id, e insertInBatches (líneas 244-257) persiste lotes de 100 sin transacción: si falla el lote 3 de 7 (o Vercel mata la función a mitad), los movimientos ya insertados quedan vivos. El job durable reintenta hasta 3 veces (markJobFailedOrRetryable, queue.ts:283-316) y el watchdog re-encola jobs 'running' >12 min (recoverStaleJobs) — cada re-ejecución vuelve a llamar procesarDocumento. En modo bypass (el carril estándar de cartolas Excel con parser determinístico) el dedup se salta por completo ('keep all rows, no dedup'), así que el re-run reinserta TODOS los movimientos: cartola con filas duplicadas → propuestas duplicadas → boletas dobles para el mismo pago (plata e impuestos). En el path no-bypass el re-run se auto-deduplica contra sus propias filas y termina en estado 'procesado' con movimientos sin propuestas.


```
if (bypassMode) {
  // Template/bypass: keep all rows, no dedup
  indicesToKeep = validMovimientos.map((_, i) => i);
  movimientosToInsert = validMovimientos.map((m) => ({ ... }));
...
const { ids: savedIds, error: movError } = await insertInBatches("movimientos_raw", movimientosToInsert);
```


**Fix:** Hacer procesarDocumento idempotente por documento: al inicio del try (o justo antes del insert) borrar movimientos_raw/propuestas_ia existentes del documento_id, o usar una clave única (documento_id, índice_fila) con upsert.


*Verificación:* CONFIRMADO en el código real. (1) processor.ts:647-661: en bypassMode el dedup se salta por completo ('keep all rows, no dedup') y procesarDocumento no tiene ningún .delete() ni chequeo de movimientos existentes del documento_id — los únicos deletes de movimientos_raw están en rutas manuales (eliminar-documento/deshacer-documento), no en el path de retry. (2) insertInBatches (processor.ts:237-260) inserta lotes de 100 secuenciales SIN transacción: si falla el lote N, los anteriores quedan persistidos y la función retorna error. (3) El error burbujea: processOneJob (queue.ts:362) lanza → markJobFailedOrRetryable (queue.ts:283-331) → status 'retryable' hasta max_attempts=3; y recoverStaleJobs re-encola jobs 'running' con locked_at >12 min (STALE_RUNNING_MS en state.ts), cubriendo el caso de Vercel matando la función a mitad de inserción. El retry re-parsea el Excel (extractContentFromJob → parseExcel → preExtracted) y re-ejecuta procesarDocumento en bypass → reinserta TODAS las filas ya insertadas. (4) No hay mitigación en otra capa: movimientos_raw no tiene constraint UNIQUE (solo PK uuid + índices no únicos, 20260410_schema_base.sql), la idempotency key del job solo evita jobs duplicados (no efectos duplicados entre intentos del mismo job), el processor usa service client (RLS irrelevante), y el índice único de boletas es por propuesta_id — los duplicados generan propuestas distintas, así que no protege contra boletas dobles. (5) El path no-bypass también se comporta como describe el auditor: el dedup consulta existentes por empresa_id sin excluir el propio documento_id (líneas 677-680), el re-run se auto-deduplica contra sus filas huérfanas del run fallido y esas quedan sin propuestas con el doc en 'procesado'. (6) El propio state.ts admite el riesgo en un comentario ('doble worker → movimientos DUPLICADOS') pero solo mitiga la concurrencia, no la falta de idempotencia tras insert parcial. Matiz menor que no cambia el veredicto: la causa más común de retry (fallos Mistral/OCR) ocurre antes de los inserts y ahí el retry es limpio; la duplicación exige fallar en la ventana insert→complete (error DB a mitad de lote, kill de Vercel durante la inserción, o fallo del update de completado en queue.ts:378 que lanza DESPUÉS de procesar todo — ese último caso duplica movimientos Y propuestas). La ventana es más estrecha de lo que sugiere la redacción, pero es real, el bypass es el carril estándar de cartolas Excel reconocidas (orchestrator capas 0/2/3 devuelven preExtracted), y con regla_id las propuestas duplicadas nacen auto-staged 'listo' a un bulk-click de emitirse: impacto directo en plata e impuestos (boletas dobles al SII). Severidad ALTA justificada. / CONFIRMADO con evidencia de código. Todos los elementos del hallazgo son exactos: (1) procesarDocumento (src/lib/ai/processor.ts:262-1090) no borra inserciones previas del documento_id — los únicos deletes viven en rutas user-initiated (eliminar-documento/deshacer-documento); (2) insertInBatches (:237-260, DB_BATCH_SIZE=100) commitea cada lote como statement independiente sin transacción; (3) en bypass (:647-661) el dedup se salta por completo, y bypass ES el carril estándar de cartolas Excel (queue.ts:259-263, parseExcel→preExtracted determinístico → re-run produce las mismas filas); (4) markJobFailedOrRetryable reintenta hasta 3 (DEFAULT_MAX_ATTEMPTS=3) y recoverStaleJobs re-encola 'running' >12min (STALE_RUNNING_MS); (5) el schema (20260410_schema_base.sql) no tiene unique constraint en movimientos_raw ni propuestas_ia — nada bloquea duplicados; (6) el propio comentario de state.ts:6-9 admite 'doble worker → movimientos DUPLICADOS'. Secuencias concretas de producción: (A) cartola de 675 movs = 7 lotes; falla transitoria en lote 3 → 200 filas quedan vivas → throw :942 → retryable → cron re-corre → re-inserta las 675 → 200 duplicadas exactas. (B) falla en el insert de propuestas (:1014) con movimientos ya completos → re-run duplica TODOS los movimientos + propuestas nuevas; las propuestas viejas sobreviven → 2 propuestas por el mismo pago; las clasificadas por regla nacen estado='listo' (:996-999) y emitir-lote solo deduplica por propuesta_id (YA_EMITIDA, route :184-213) → dos boletas reales al SII por el mismo pago. (C) ni siquiera hace falta falla parcial: si el UPDATE final a document_processing_jobs falla (JOB_COMPLETE_UPDATE_FAILED, queue.ts:378) tras un run 100% exitoso, el job queda retryable y el re-run duplica la cartola COMPLETA (movimientos + propuestas, incluidas las 'listo'). (D) kill de Vercel mid-insert → watchdog 12min → re-run. La afirmación secundaria del path no-bypass también se verifica: el re-run consulta existentes de toda la empresa (:677-680, sin excluir el propio documento_id), matchea loose contra sus propias filas parciales, las salta, y el doc termina 'procesado' con movimientos huérfanos sin propuestas. Severidad ALTA amerita: carril estándar, reintentos automáticos (cron + watchdog + botón reprocesar que resetea attempts=0 sin limpiar), sin backstop en DB, y el resultado son registros financieros duplicados y boletas tributarias dobles.


### Deshacer deja el documento imposible de reprocesar: el job 'completed' bloquea el re-encolado para siempre

**Lente:** Integridad de datos (operaciones destructivas) · **`src/app/api/procesar-documento/route.ts:82`**


deshacer-documento resetea el doc a 'subido' (route.ts:96-103) pero nunca toca document_processing_jobs. La idempotency key es por documento (documentoId:v1) y enqueueDocumentProcessingJob devuelve el job existente sin resetearlo cuando su status es 'completed' (queue.ts:78). El único endpoint de reproceso (/api/procesar-documento, botón '↻ Reprocesar' en DocCardList.tsx:326, visible justamente para estado 'subido'/'procesado') hace early-return 'Documento ya procesado.' sin procesar nada. Resultado determinístico: Deshacer → Reprocesar es un no-op silencioso; el documento queda en 'subido' con 0 movimientos y la única salida es eliminarlo y re-subirlo. Lo mismo invalida el flujo Mapear → Reprocesar sobre un doc ya procesado.


```
// procesar-documento/route.ts
if (job.status === "completed") {
  return NextResponse.json({ ok: true, ..., message: "Documento ya procesado." });
}
// queue.ts:78
if (["queued", "running", "retryable", "completed"].includes(existing.data.status)) {
  return existing.data;
}
```


**Fix:** En deshacer-documento (y en el reproceso manual) resetear el job a 'queued' con attempts=0 (o aceptar un flag force en enqueueDocumentProcessingJob que también resetee jobs 'completed'), combinado con la limpieza idempotente del finding anterior.


*Verificación:* CONFIRMADO en todas sus partes leyendo el código real. (1) deshacer-documento/route.ts:96-103 resetea el doc a 'subido' con 0 movimientos y NO toca document_processing_jobs (grep: la tabla solo se referencia en database.types, state.ts, queue.ts y ops/diagnostics.ts). (2) La idempotency key es `${documentoId}:document-processing:v1` (state.ts:15-17) con constraint UNIQUE en la migración — un job por documento para siempre. (3) enqueueDocumentProcessingJob (queue.ts:77-80) devuelve el job existente sin resetearlo cuando status ∈ [queued,running,retryable,completed]; solo resetea failed/cancelled. (4) procesar-documento/route.ts:82-90 hace early-return HTTP 200 'Documento ya procesado.' sin procesar ni cambiar el estado del doc; el worker solo reclama queued/retryable (queue.ts:182). (5) El botón '↻ Reprocesar' (DocCardList.tsx:325-326) es visible justo para estado subido/procesado y llama ese endpoint; callApi (líneas 169-179) solo muestra toast en !res.ok, así que el 200 no-op es totalmente silencioso. (6) Mapear también muere ahí: FieldMapper → save-mapping/route.ts:91 → fetch interno a /api/procesar-documento, y encima reporta reprocessStarted=true engañosamente. Intenté refutarlo por otras capas y no hay mitigación: el endpoint de operador /api/document-processing/retry usa retryDocumentProcessingJob que en queue.ts:420 devuelve el job sin cambios si está 'completed' (ni god-mode lo rescata); no hay triggers en las migraciones; el FK cascade solo aplica al DELETE del documento — por eso la única salida es Eliminar + re-subir (subir-procesar siempre inserta fila nueva → key nueva). Escenario determinístico: doc procesado OK (job completed) → Deshacer (borra movimientos/propuestas) → Reprocesar = no-op silencioso → doc atascado en 'subido' con 0 movimientos sin recuperación in-app. Severidad alta justificada: flujo primario de la UI, destruye trabajo del usuario, falla silenciosa, única salida destructiva (re-subir). / CONFIRMADO con secuencia concreta reproducible: (1) subir cartola → worker procesa → doc 'procesado' (processor.ts:1037) y job 'completed' (queue.ts:370); (2) click Deshacer (visible para 'procesado', DocCardList.tsx:330) → deshacer-documento/route.ts:96-103 borra propuestas/movimientos/ia_uso y resetea doc a 'subido' SIN tocar document_processing_jobs (grep repo-wide: solo queue.ts escribe esa tabla); (3) click Reprocesar (visible para 'subido', DocCardList.tsx:325) → enqueueDocumentProcessingJob encuentra el job por key por-documento sin contador de corrida (state.ts:15: `${documentoId}:document-processing:v1`), devuelve el 'completed' sin resetear (queue.ts:78-80) y la ruta hace early-return 200 ok:true 'Documento ya procesado.' (procesar-documento/route.ts:82-90) sin actualizar el doc ni kickear la cola; (4) el cliente callApi (DocCardList.tsx:169-179) solo toastea en !res.ok e ignora `message` → no-op 100% silencioso, doc queda en 'subido' con 0 movimientos poleando cada 5s. Sin escape: retryDocumentProcessingJob solo resetea failed/retryable/cancelled (queue.ts:420) y el cron solo reclama queued/retryable; única salida = Eliminar + re-subir (nuevo documento_id → nueva key). También confirmado el segundo vector: save-mapping/route.ts:87-96 llama a /api/procesar-documento y reporta reprocessStarted=res.ok=true sobre el no-op 200, así que Mapear→Reprocesar en un doc procesado dice haber arrancado y nunca aplica el nuevo adapter. Severidad ALTA justificada: determinístico, silencioso, en el flujo principal de la mesa, precedido de un borrado destructivo, y la recuperación (eliminar y re-subir) no se comunica al usuario. Matiz menor que no baja la severidad: es recuperable re-subiendo el archivo y deshacer desde estado 'error' sí funciona (job 'failed' se resetea en queue.ts:81-101), lo que confirma que la trampa es específica del camino 'completed'.


### Cancelar no cancela el job durable: procesamiento zombie que revive datos y burla el guard de eliminar

**Lente:** Integridad de datos (operaciones destructivas) · **`src/app/api/cancelar-documento/route.ts:28`**


Cancelar solo actualiza documentos_subidos.estado='error'; el job en document_processing_jobs sigue 'queued'/'running' y el worker no verifica nunca el estado del doc ni un status 'cancelled'. El worker sobreescribe el cancel: processOneJob repone estado='procesando' (queue.ts:336-342), markJobFailedOrRetryable también (queue.ts:292), y al completar deja 'procesado' con movimientos — el documento 'cancelado' revive solo. Peor: eliminar-documento solo bloquea si estado==='procesando' (eliminar route:64) y su propio mensaje instruye 'Cancela el procesamiento antes de eliminarlo' — cancelar+eliminar borra archivo y filas MIENTRAS el worker sigue corriendo: sus inserts posteriores chocan con FK (job marcado failed, ops_errors críticos) o, si el usuario re-subió el archivo creyendo que falló, el doc zombie duplica los movimientos (bypass sin dedup).


```
const { error } = await supabase
  .from("documentos_subidos")
  .update({ estado: "error", progreso_ia: { estado: "error", error: "Cancelado por el usuario" } })
  .eq("id", body.documento_id)
  .eq("empresa_id", usuario.empresa_id);
```


**Fix:** Cancelar debe además marcar el job (status='cancelled', locked_at/by null) y el worker debe abortar/no-claimear jobs cancelados y re-verificar el estado del documento antes de insertar; eliminar-documento debe consultar document_processing_jobs (queued/running/retryable) en vez de confiar solo en documentos_subidos.estado.


*Verificación:* CONFIRMADO con evidencia de código en todas sus partes sustantivas. (1) cancelar-documento/route.ts:28-35 solo actualiza documentos_subidos.estado='error'; ningún código del repo setea status='cancelled' en document_processing_jobs (el estado existe en el CHECK de la migración 20260621223000 y en state.ts:13 pero jamás se escribe — solo retryDocumentProcessingJob lo lee en queue.ts:420). (2) El worker nunca consulta el estado del doc: claimJobs filtra solo por status del job, processOneJob repone estado='procesando' incondicional (queue.ts:336-342), markJobFailedOrRetryable también en el branch retryable (queue.ts:292), y procesarDocumento termina dejando estado='procesado' con movimientos+propuestas insertados (processor.ts:~1035-1046) — el doc cancelado revive solo. (3) No hay mitigación en otra capa: cero triggers en migraciones, el worker usa service-role (RLS irrelevante), y el job es durable (cron en vercel.json + kicks fire-and-forget en subir-procesar:163). (4) La ventana no es teórica: el botón Cancelar solo se renderiza cuando estado==='procesando' (DocCardList.tsx:344-346), o sea CADA uso ocurre con el worker corriendo (OCR+IA tardan minutos, maxDuration 300s). (5) eliminar-documento/route.ts:64-69 solo bloquea estado==='procesando' y su mensaje instruye exactamente la secuencia rota (cancelar→eliminar); tras eliminar, los inserts del zombie chocan con el FK NOT NULL de movimientos_raw.documento_id (schema_base.sql:69) y generan ops_errors. (6) La duplicación por re-subida es real en el carril bypass/template: processor.ts:648-661 salta el dedup por completo ('Template/bypass: keep all rows, no dedup'), y las propuestas duplicadas pueden nacer auto-stageadas 'listo' — a un bulk-click de emitir boletas duplicadas en el SII. Única imprecisión menor que no invalida: tras eliminar, el job row cae por ON DELETE CASCADE, así que no queda 'marcado failed' y el primer ops_error es severity 'error' (no 'critical', que requiere agotar reintentos). Severidad ALTA justificada: el feature de cancelar está completamente roto (nunca cancela nada), revierte silenciosamente una acción explícita del usuario, y en una app tributaria el camino cancelar→re-subir puede terminar en boletas duplicadas emitidas al SII. / CONFIRMADO con evidencia de código y secuencia concreta reproducible. (1) cancelar-documento/route.ts:28-35 solo hace update de documentos_subidos (estado='error'); jamás toca document_processing_jobs — el status 'cancelled' existe en el tipo (state.ts:13) y en el CHECK de la migración, pero ningún código del pipeline lo escribe (grep exhaustivo: solo se lee en retryDocumentProcessingJob). (2) El worker nunca verifica el estado del doc: claimJobs filtra solo por status del job; processOneJob repone estado='procesando' exactamente en queue.ts:336-342; markJobFailedOrRetryable lo repone en queue.ts:292; procesarDocumento re-escribe 'procesando' en cada lote (processor.ts:298/469/926) y termina en 'procesado' con movimientos (processor.ts:1035-1037), sin leer nunca estado para abortar. (3) Secuencia de producción DETERMINÍSTICA, sin carrera: subir cartola grande (675 movs = minutos de IA por lotes) vía /api/subir-procesar → job durable + kick (route:127,163) → doc 'procesando' → UI muestra '✕ Cancelar' (DocCardList.tsx:345) → clic → estado='error' → el siguiente write de progreso del worker lo repone a 'procesando' y al terminar queda 'procesado' con TODOS los movimientos: el doc cancelado revive en todos los caminos (kick vivo = sobrescritura in-flight; kick muerto = cron diario 12:45 UTC lo reclama; running stale = watchdog → retryable → queue.ts:292). (4) Bypass de eliminar CONFIRMADO: eliminar-documento/route.ts:64-68 solo bloquea estado==='procesando' y su mensaje instruye literalmente 'Cancela el procesamiento antes de eliminarlo'; tras cancelar, el botón Eliminar aparece y el guard pasa mientras el worker sigue corriendo (ventana = duración de cada llamada IA, decenas de segundos) → archivo y filas borrados bajo el worker → inserts posteriores de movimientos_raw chocan con FK NOT NULL REFERENCES documentos_subidos → ops_errors + tokens IA quemados. MATIZ menor que no baja la severidad: document_processing_jobs.documento_id es ON DELETE CASCADE (migración 20260621223000:7), así que el job se borra con el doc (no queda 'failed' y el primer fallo registra severidad 'error', no 'critical'); la integridad DB la contienen las FKs. El sub-claim de duplicación por re-subida es plausible pero condicional (el dedup conserva deliberadamente P2P mismo día/monto como reales). SEVERIDAD ALTA justificada: el único mecanismo de cancelación del producto es sobrescrito determinísticamente por la cola durable en el flujo principal de subida — un documento que el usuario canceló revive solo como 'procesado' y sus movimientos alimentan propuestas de boletas (documentos tributarios reales en el SII), además de que el propio mensaje del guard de eliminar instruye la secuencia que lo burla.


### El carril REAL (sii_local) no persiste propuesta_id: la 'barrera final' anti-deshacer y el filtro de ya-emitidas son ciegos a folios reales

**Lente:** Integridad de datos (operaciones destructivas) · **`src/app/api/sii-local/result/route.ts:554`**


El insert de boletas_emitidas del carril sii_local (el único que emite folios REALES hoy, vía extensión/boleta única — emitir-lote bloquea proveedores reales y la UI manda a 'Boleta única', EmitirTabContent.tsx:224-226) no incluye propuesta_id ni actualiza la propuesta. Toda la integridad post-emisión cuelga de ese link: el guard de deshacer/eliminar cuenta boletas con .in('propuesta_id', propIds) (deshacer route:72-77), pendientes-emision excluye por propuesta_id (pendientes-emision.ts:42-47) y el congelado 'frozen' de la mesa igual. Consecuencias: la propuesta emitida de verdad sigue apareciendo 'lista para emitir' para siempre (re-emisión = boleta real doble), y el usuario puede Deshacer/Eliminar la cartola con folios reales vivos — exactamente lo que el comentario 'BARRERA FINAL intacta' (eliminar route:11-12) dice impedir — y al reprocesar volver a boletear los mismos pagos.


```
const { data: boleta, error: insertErr } = await sb
  .from("boletas_emitidas")
  .insert({
    empresa_id: empresaId,
    tipo_dte: tipoDte,
    folio,
    ... // sin propuesta_id
    emision_proveedor: "sii_local",
    emision_sandbox: false,
```


**Fix:** Propagar propuesta_id en el job de emisión sii-local (y futuro simpleapi) hasta el insert de boletas_emitidas, o al confirmar folio real marcar/vincular la propuesta, para que pendientes, yaEmitidas y la barrera de deshacer/eliminar vean los folios reales.


*Verificación:* CONFIRMADO con evidencia de código. (1) El insert de boletas_emitidas en src/app/api/sii-local/result/route.ts:552-580 no incluye propuesta_id (grep 'propuesta' en todo src/app/api/sii-local/ = 0 hits), mientras el carril mock de emitir-lote SÍ inserta propuesta_id:pid (~línea 365) — toda la maquinaria de integridad fue diseñada sobre ese link. (2) Tampoco hay contexto upstream: la creación de jobs (emision/jobs/route.ts) solo lleva provider/tipo_dte/origin, y el backfill de reconcile también inserta sin propuesta_id; no existe capa de reparación. (3) Las tres barreras citadas son ciegas a propuesta_id NULL: deshacer-documento:72-77 y eliminar-documento:90-95 cuentan .in('propuesta_id', propIds) → count 0 → se permite deshacer/eliminar una cartola con folios reales vivos, contradiciendo el propio comentario 'BARRERA FINAL intacta' (eliminar:11-12); pendientes-emision.ts:41-47 excluye solo boletas con propuesta_id → la propuesta emitida de verdad queda 'lista para emitir' para siempre; el frozen (DocCardList.tsx:224) viene de la vista documento_pipeline_counts (migración 20260610180000) que usa be.propuesta_id = pi.id → la cartola nunca se congela. (4) El escenario es el flujo que la propia app prescribe: EmitirTabContent.tsx:224-226 bloquea el masivo para proveedores reales con 'Emite con Boleta única por ahora' (y el server igual, batchBlockedResult/PROVEEDOR_NO_IMPLEMENTADO), y EmitirDirectaView (Boleta única) no tiene ninguna referencia a propuestas; su chequeo de duplicados es solo una advertencia hover, no un bloqueo. No encontré mitigación en RLS, constraints de DB, tipos TS ni middleware. Matiz menor: la 're-emisión doble' vía masivo está bloqueada hoy para proveedores reales; el camino a la doble boleta real es re-emitir por Boleta única (que la lista de pendientes eternos invita a hacer) o el loop deshacer→reprocesar→re-boletear que describe el auditor. Severidad ALTA justificada: el único carril con folios reales del SII es invisible para toda la integridad post-emisión de una app tributaria. / CONFIRMADO con evidencia de código en todas las capas. (1) El insert de boletas_emitidas en src/app/api/sii-local/result/route.ts:552-580 no incluye propuesta_id y el archivo jamás toca propuestas_ia; el backfill de reconcile (reconcile/route.ts:99-120) tampoco. (2) No existe forma de que el carril real lleve el link: emision_jobs no tiene columna propuesta_id (database.types.ts), POST /api/emision/jobs no acepta ninguna referencia, y EmitirDirectaView.tsx (Boleta única, 1630 líneas) tiene cero menciones de 'propuesta'. Solo el carril mock de emitir-lote persiste propuesta_id (route.ts:365). (3) Los proveedores reales están bloqueados del carril que sí linkea: provider-guards.ts bloquea sii_local/simpleapi en emitir-lote (línea 321) y emitir-boleta (línea 123), y la UI manda explícitamente a Boleta única (EmitirTabContent.tsx:224-226 y 264-267). (4) Toda la integridad post-emisión cuelga del link ausente: pendientes-emision.ts:41-47 excluye solo por propuesta_id no-nulo (y pasa yaEmitida:false en línea 107) → la propuesta emitida de verdad queda 'lista para emitir' para siempre; deshacer-documento:72-77 y eliminar-documento:90-95 cuentan boletas con .in('propuesta_id', propIds) → con propuesta_id NULL el guard nunca dispara y se puede Deshacer/Eliminar la cartola con folios reales vivos, contradiciendo el comentario 'BARRERA FINAL intacta' (eliminar route:11-12); el congelado 'frozen' de la mesa (DocCardList.tsx:224) viene de documento_pipeline_counts (migraciones 20260610180000/20260702110000) que también joinea be.propuesta_id = pi.id. Secuencia concreta reproducible: empresa con proveedor sii_local (único carril de folios REALES hoy) sube cartola → aprueba propuestas → masivo bloqueado → emite folios reales vía Boleta única/extensión → boleta persiste sin propuesta_id → propuestas siguen 'listas' (invitación a doble boleta real; el dedup por folio no protege porque la re-emisión genera folio nuevo) y la cartola queda des-congelada y eliminable, y al reprocesar los mismos pagos vuelven como pendientes. Único matiz: la re-emisión requiere pasar de nuevo por el flujo manual de Boleta única (el masivo está bloqueado), pero la app desinforma activamente y la falla de la barrera anti-deshacer/eliminar es automática server-side en el único carril con validez tributaria real → severidad ALTA justificada.


### Cambiar de empresa activa deja la mesa mostrando los datos de la empresa anterior (estado client-held + cache cruzada)

**Lente:** Calidad del código React · **`src/app/(app)/escritorio/v5/MesaController.tsx:48`**


MesaController guarda la mesa en useState sembrado con initialMesa y cachea rangos en cacheRef keyed solo por view|date|month (sin empresaId). EmpresaBrand.switchEmpresa (EmpresaBrand.tsx:69) hace router.refresh() tras cambiarEmpresaActiva — pero el propio equipo documentó que router.refresh() NO re-siembra el estado de la mesa. Resultado: en cuentas Business multiempresa, al cambiar de empresa los slots RSC (marca, columna izquierda) muestran la empresa nueva mientras las pestañas Check/Emitir/Boletas siguen mostrando documentos, propuestas y boletas de la empresa ANTERIOR; peor, navegar el calendario puede servir entradas de cacheRef pobladas con datos de la otra empresa. El server (emitir-lote filtra por empresa_id, route.ts:189) contiene el riesgo de plata, pero la UI muestra data tributaria de otra empresa. En page.tsx:333 MesaController se monta sin key.


```
// MesaController.tsx
const [mesa, setMesa] = useState(initialMesa);
...
const cacheRef = useRef<Map<string, MesaDateDependent>>(
  new Map([[keyOf(initialMesa.workMode, initialMesa.selDate, ...), initialMesa]]),
);
// EmpresaBrand.tsx:69 (tras cambiarEmpresaActiva)
router.refresh();
```


**Fix:** Montar MesaController con key={empresaId} en page.tsx para forzar remount (re-siembra estado y cache) al cambiar de empresa, o resetear mesa/cacheRef en un ajuste-durante-render cuando cambia la prop empresaId.


*Verificación:* CONFIRMADO con evidencia de código en todas las citas. (1) MesaController.tsx:48 usa useState(initialMesa) sin ningún efecto que re-sincronice al cambiar initialMesa/empresaId, y cacheRef (líneas 12, 51-53) se llavea solo por view|date|month sin empresaId; navigate() (líneas 64-65) sirve la cache antes de fetch, por lo que rangos visitados devuelven datos de la empresa ANTERIOR tras el cambio. (2) EmpresaBrand.tsx:69 hace solo router.refresh() tras cambiarEmpresaActiva (actions.ts:263-318, que solo actualiza usuarios.empresa_id + revalidatePath — nada de eso resetea useState del cliente). (3) page.tsx:333 monta MesaController SIN key; grep en todo v5 no encuentra key={empresaId} ni window.location.reload en el path de cambio, ni listener de cambio de empresa que dispare reloadMesa (solo escucha massdte:open-doc y massdte:uploaded). (4) El propio equipo documentó el mecanismo en MesaController.tsx:113-114: router.refresh() 'no actualizaba la mesa (el estado no se re-siembra de initialMesa sin remount/F5)' — no es especulación, fue observado en esta app. (5) cargarMesa (actions.ts:592-611) resuelve la empresa server-side, así que tras el cambio se mezclan rangos frescos (empresa nueva) con rangos cacheados (empresa vieja) en la misma sesión, y broadcastMesa propaga los números stale a la card de Registros de la empresa nueva. (6) La feature es real y alcanzable: planPermiteMultiempresa (actions.ts:188) + selector en EmpresaBrand.tsx:39 = feature pagada del plan Business. Mitigación única encontrada: el server sí contiene el riesgo de plata (emitir-lote route.ts:189 filtra por usuario.empresa_id y propuestas ajenas fallan con NO_ENCONTRADA), exactamente como el auditor ya reconocía. Matiz: las empresas pertenecen a la misma cuenta (no es fuga cross-tenant entre clientes distintos), pero mostrar documentos tributarios de otra empresa bajo la marca de la nueva, con cache envenenada persistente hasta F5, en la superficie central de un producto tributario y en cada uso del switcher, justifica severidad alta como bug de producto. / CONFIRMADO leyendo el código real. (1) MesaController.tsx:48 guarda la mesa en useState(initialMesa) y cacheRef (líneas 12, 51-53) cachea rangos con clave `view|date|month` SIN empresaId; en todo el archivo no hay ningún efecto que re-siembre el estado cuando cambian initialMesa/empresaId — el propio comentario del equipo (líneas 112-114) admite que router.refresh() "no actualizaba la mesa (el estado no se re-siembra de initialMesa sin remount/F5)". (2) page.tsx:333 monta MesaController sin key, V5Root.tsx:99 renderiza dashboardContent sin key, y /massdte/page.tsx es un re-export de la misma página: nada fuerza remount al cambiar empresa. (3) EmpresaBrand.tsx:54-70 llama cambiarEmpresaActiva (actions.ts:263-318: update de usuarios.empresa_id + revalidatePath, sin redirect) y luego router.refresh(), que por diseño de Next.js preserva el estado client. (4) Secuencia concreta: cuenta con planes_config.multiempresa=true y 2+ empresas en cuenta_empresas → selector visible (canSwitch, EmpresaBrand.tsx:39); cargar /massdte con empresa A (mesa y cache sembradas con docs/propuestas/pendientes/boletas de A, todo filtrado por empresa_id en mesa-data.ts:119-129); cambiar a B → los slots RSC (marca, RegistrosToggleCard) muestran B pero las 3 pestañas siguen mostrando A, porque Mesa.tsx alimenta Check (MesaTab mesa={mesa}), Emitir (EmitirTabContent initial={mesa.pendientes}, que hace `const data = initial` sin fetch propio) y Boletas (mesa.boletasView) solo desde el estado stale. (5) Cache cruzada verificada: cargarMesa (actions.ts:592-611) usa la empresa activa server-side, así que tras el switch un rango nuevo trae datos de B pero volver a un rango visitado hace cache-hit (MesaController.tsx:64-65) y sirve datos de A — mezcla A/B indefinida en la sesión. (6) Los self-heals (reloadMesa limpia toda la cache) solo disparan por acción del usuario, realtime sobre datos de la empresa nueva, o poll solo mientras hay docs "procesando": un switch normal no dispara ninguno. (7) El riesgo de dinero está contenido server-side (emitir-lote filtra por usuario.empresa_id, route.ts:115 y 189), exactamente como describe el hallazgo. Severidad alta proporcionada: app tributaria mostrando documentos, montos y boletas de otra empresa en el flujo principal del plan Business (feature real de esta rama), con estado mezclado y cache cruzada persistente hasta F5.


### Boletas SimpleAPI descargan un PDF regenerado con 'Timbre simulado' en vez del PDF oficial guardado

**Lente:** Higiene y fuente única de verdad · **`src/components/boletas/DescargarBoletaButton.tsx:30`**


El union de emision_proveedor del botón quedó congelado en "mock" | "baseapi" | "sii_local" y la rama que baja el PDF oficial (línea 52) solo chequea "sii_local". Pero el carril real SimpleAPI escribe emision_proveedor: "simpleapi" (src/app/api/simpleapi/result/route.ts:365) y guarda el PDF oficial en storage (proveedor_respuesta.pdf.storage_path, líneas 313-316), que el endpoint /api/intermediaria/boleta/[id]/pdf sirve para cualquier proveedor. Una boleta simpleapi cae al fallback generarBoletaPDF: el usuario del carril REAL descarga un PDF hecho en casa cuyo pie dice "Timbre simulado para pruebas" (src/lib/pdf/boleta-pdf.ts:149) y cuyo TED es el placeholder "simpleapi://ted/..." (simpleapi/result/route.ts:362), teniendo el PDF oficial del SII a un fetch de distancia. El botón se usa en la mesa v5 (Mesa.tsx:103) y en BoletasMensualesView.


```
emision_proveedor?: "mock" | "baseapi" | "sii_local";
...
if (b.emision_proveedor === "sii_local") {
  const pdfRes = await fetch(`/api/intermediaria/boleta/${id}/pdf", ...)
// simpleapi/result/route.ts:365 → emision_proveedor: "simpleapi"
// boleta-pdf.ts:149 → "Timbre simulado para pruebas"
```


**Fix:** Agregar "simpleapi" al union y a la rama que llama /pdf (o mejor: rutear a /pdf siempre que proveedor_respuesta.pdf.storage_path exista y usar el fallback local solo para mock). Definir el union de proveedores en un módulo compartido para que no vuelva a quedar congelado.


*Verificación:* CONFIRMADO en código. (1) DescargarBoletaButton.tsx:30 tiene el union congelado en "mock"|"baseapi"|"sii_local" y las únicas ramas runtime son ==="sii_local" (línea 52, única que llama a /api/intermediaria/boleta/[id]/pdf) y ==="baseapi" (línea 71); "simpleapi" no matchea ninguna y cae al fallback generarBoletaPDF con emision_proveedor undefined (línea 115). (2) El carril real escribe emision_proveedor:"simpleapi" (src/app/api/simpleapi/result/route.ts:365, estado "aceptado", emision_sandbox:false) y sube el PDF oficial a Storage guardando proveedor_respuesta.pdf.storage_path (líneas 284-288 y 313-317). (3) El endpoint /api/intermediaria/boleta/[id]/pdf sirve ese PDF para cualquier proveedor (solo requiere pdf.storage_path, sin filtro por proveedor), así que el PDF oficial estaba a un fetch. (4) No hay mitigación en otra capa: /api/intermediaria/boleta/[id] devuelve select("*") sin normalizar el proveedor, y mesa-data.ts:125 lista boletas_emitidas sin filtro de proveedor, con el botón montado en Mesa.tsx:103, BoletasMensualesView.tsx:162 y PreviewBoletaButton.tsx:139. (5) El fallback es incluso peor que lo descrito: boleta-pdf.ts con isBaseApi=false imprime "DOCUMENTO SIMULADO" en el cuadro de folio (línea 81), "Timbre simulado para pruebas" (línea 149), el TED placeholder "simpleapi://ted/..." (route.ts:362), "Estado: SIMULADO (demo)" (línea 176) y "DOCUMENTO DE PRUEBA — simulado, no informado al SII y sin validez tributaria real" (línea 187) sobre una boleta real aceptada por el SII. "simpleapi" es valor legítimo del constraint (migración 20260608202426). Severidad alta procede: el usuario del carril real de un producto tributario descarga un comprobante que se autodeclara sin validez tributaria, teniendo el oficial disponible. / CONFIRMADO con secuencia de disparo concreta. (1) El carril SimpleAPI es real y vivo: page.tsx:23 mapea "simpleapi", EmitirDirectaView.tsx:617 (cableado en LeftQuickActions.tsx:134) postea a /api/simpleapi/result, que inserta la boleta con emision_proveedor:"simpleapi" (route.ts:365), TED placeholder "simpleapi://ted/..." (362) y sube el PDF oficial a Supabase Storage registrando proveedor_respuesta.pdf.storage_path (285, 313-317). (2) El endpoint /api/intermediaria/boleta/[id]/pdf sirve ese PDF sin gate de proveedor (getPdfMeta solo lee storage_path; provider ausente → download de "documentos", justo donde se subió). (3) El botón nunca lo usa: el union de línea 30 es solo compile-time (el API hace select("*") y en runtime llega "simpleapi"), la rama de PDF oficial (línea 52) chequea solo "sii_local", "baseapi" (71) tampoco matchea → fallback generarBoletaPDF con emision_proveedor undefined (115) → isBaseApi=false → boleta-pdf.ts:149 imprime "Timbre simulado para pruebas" + el TED falso (163-169). (4) Expuesto en Mesa.tsx:103, BoletasMensualesView.tsx:162 y PreviewBoletaButton.tsx:139, listados sin filtro de proveedor (mesa-data.ts:125). Secuencia: empresa con proveedor simpleapi → emite boleta real aceptada por el SII → clic en descargar en la mesa → recibe PDF casero autodeclarado simulado en vez del PDF oficial guardado. Severidad alta justificada: es el carril de emisión real del producto, cada descarga entrega un documento tributario inservible como respaldo, y el fix (agregar "simpleapi" a la rama de línea 52) demuestra que el PDF oficial estaba a un fetch.


### El diálogo de Check dice "Vas a emitir" / "Confirmar emisión" pero NO emite nada

**Lente:** UX de flujos · **`src/app/(app)/escritorio/v5/VeredictoCartola.tsx:161`**


El botón Aprobar de la cartola abre una confirmación cuyo copy afirma que se está emitiendo ("Vas a emitir 30 · total $X" → botón "Confirmar emisión"), pero la acción solo promueve las propuestas a estado 'aprobado' (cola del tab Emitir). El toast posterior dice "N enviadas a Emitir" (MesaTab.tsx:147), contradiciendo el diálogo. Un microemprendedor no contador queda convencido de que sus boletas ya llegaron al SII y nunca pasa por el paso real de Emitir → boletas jamás emitidas → incumplimiento tributario. Es la afirmación equivocada en el momento más consecuente del flujo.


```
Vas a emitir <b style={{ color: "var(--text)" }}>{listas}</b>
...
<button className="vcart-cb" onClick={() => { setConfirming(false); onAprobar(); }} ...>Confirmar emisión</button>
// MesaTab.tsx:147 → toast(`${r.count} enviadas a Emitir`)
```


**Fix:** Cambiar el copy a lo que realmente pasa: "Vas a dejar N listas en Emitir" / botón "Aprobar y enviar a Emitir", y tras aprobar mostrar CTA "Ir a Emitir →" (dispatch switch-tab) para cerrar el loop.


*Verificación:* CONFIRMADO en código. VeredictoCartola.tsx:161-167 muestra "Vas a emitir N · total $X" con botón "Confirmar emisión" que solo llama onAprobar() → handleAprobarCartola (MesaTab.tsx:143-150) → aprobarCartola (revisar/actions.ts:348-381), que ÚNICAMENTE hace update({estado:'aprobado'}) en propuestas_ia — cero contacto con providers de emisión. El toast inmediato dice "N enviadas a Emitir" (MesaTab.tsx:147) y el panel queda en "Todo enviado a Emitir" (VeredictoCartola.tsx:182), contradiciendo el botón recién pulsado. La emisión real exige un segundo paso manual: abrir el tab Emitir, seleccionar, pulsar emitir y pasar OTRO modal de confirmación (EmitirTabContent.tsx:222-255, 379, 452) que POSTea a /api/intermediaria/emitir-lote (route.ts:216-218 solo acepta estado='aprobado', confirmando que 'aprobado'=en cola, no emitida). No existe capa que lo neutralice: único caller de emitir-lote es ese botón, ningún cron de vercel.json auto-emite, y nada lleva al usuario al tab Emitir tras "confirmar". Severidad alta justificada: el copy afirma un acto legal (emisión al SII) que no ocurrió, en el momento más consecuente del flujo, para un usuario objetivo no contador; el modo de falla plausible (usuario cree que emitió y cierra la app) = boletas jamás emitidas = incumplimiento tributario. Además existe una segunda confirmación "real" en Emitir, así que "Confirmar emisión" es objetivamente la etiqueta equivocada para una acción de encolado. / CONFIRMADO con evidencia de código. El diálogo (VeredictoCartola.tsx:161-167) dice "Vas a emitir N · total $X" con botón "Confirmar emisión", pero onAprobar (único wiring: MesaTab.tsx:231 → handleAprobarCartola:143-150) llama aprobarCartola (revisar/actions.ts:348-381), que SOLO hace update({estado:"aprobado"}) en propuestas_ia — sin proveedor de emisión, sin boleta, sin SII. La emisión real exige un paso manual posterior en el tab Emitir (EmitirTabContent.tsx:222 handleEmitir → /api/intermediaria/emitir-lote, cuyo route.ts:218 exige estado==="aprobado" como PREcondición, prueba de que aprobado≠emitido); no hay cron/trigger que auto-emita. Secuencia disparadora = el happy path principal: subir cartola → dejar tx en 'listo' → Aprobar → "Confirmar emisión" → toast "N enviadas a Emitir" (MesaTab.tsx:147) → nada llega al SII salvo que el usuario visite Emitir y confirme de nuevo. El propio comentario del componente (línea 95: "Aprobar atómico = manda a Emitir (gatillo real hacia el SII)") admite que el gatillo real es otro. Amerita ALTA: es una afirmación falsa en el único punto de confirmación deliberada, dirigida a microemprendedores no contadores, con consecuencia de boletas jamás emitidas e incumplimiento tributario silencioso; las señales correctivas (toast en jerga "enviadas a Emitir", hint "Todo enviado a Emitir") son ambiguas para un lego y no compensan. Fix trivial de copy, impacto de producto máximo.


### Cartola en estado error: el visor no muestra la causa ni ofrece reintentar

**Lente:** UX de flujos · **`src/app/(app)/escritorio/v5/MesaTab.tsx:287`**


Si el procesamiento IA de una cartola falla (estado='error'), en la mesa el usuario solo ve la palabra "Error" en rojo en el árbol (DocCardList.tsx:487) y, al seleccionarla, el visor cae al fallback que dice "Sin propuestas pendientes en este documento." — texto engañoso que suena a 'no hay nada que hacer'. El mensaje real del error (progreso_ia.error, DocCardList.tsx:311-315) y los botones Reprocesar/Deshacer (líneas 325-334) viven solo en el mode="list" de DocCardList, inalcanzable en el producto (único uso es forceTree). Dead-end total en el flujo núcleo subir→revisar: el usuario no sabe qué pasó ni qué hacer, salvo eliminar y adivinar.


```
{selDoc.estado === "procesando" ? "Procesando movimientos…" : "Sin propuestas pendientes en este documento."}
// DocCardList.tsx:487 (grid vivo): const meta = doc.estado === "error" ? "Error" : …
// DocCardList.tsx:311-315 (solo list, muerto): Error: {progreso.error} + botón ↻ Reprocesar
```


**Fix:** En el visor del Check, rama explícita para estado==='error': mostrar progreso_ia.error en lenguaje claro + botón "Reprocesar" (POST /api/procesar-documento ya existe) y sugerencia de Mapear si el formato no se reconoció.


*Verificación:* CONFIRMADO con evidencia de código. (1) MesaTab.tsx:287 tiene exactamente el texto citado: para un doc massdte con estado='error', pend.length===0 (sin propuestas) y estado≠'procesando' → el visor muestra "Sin propuestas pendientes en este documento.", sin causa ni retry. (2) DocCardList.tsx:487 (modo grid/árbol) reduce el error a meta="Error" rojo; el title de la fila (línea 495) solo trae nombre_archivo, nunca progreso_ia.error. (3) El mensaje real (líneas 311-315, "Error: {progreso.error}") y los botones Reprocesar/Deshacer (325-334) existen SOLO en mode==='list'; el único uso de DocCardList en todo el repo es MesaTab.tsx:198 con forceTree, que fija mode='grid' (DocCardList.tsx:124) y oculta el toggle (línea 201) → list es código muerto en el producto. (4) El fallo es asíncrono (processor.ts:1080 marca estado='error' tras dejar el doc 'procesando'); el realtime/poll de DocCardList refresca en silencio sin toast, y DropzoneUpload solo notifica errores de SUBIDA HTTP, no de procesamiento. (5) mesa-data.ts:122 no filtra por estado, así que los docs en error quedan visibles en la mesa como dead-end. Matices que NO refutan: existe un camino de reproceso no señalizado (visor "↔ Mapear" → FieldMapper → "Procesar movimientos →" → save-mapping con reprocess:true → /api/procesar-documento), pero no muestra la causa, exige re-mapear columnas a ciegas y save-mapping/route.ts:51 lo rechaza para todo lo que no sea Excel ("Mapeo solo para Excel") — para una cartola PDF en error el dead-end sí es total (solo Eliminar). Nit menor: incluso en el list muerto, Reprocesar (línea 325) requiere estado procesado|subido, no 'error' (solo Deshacer cubre error), o sea la UI de recuperación para 'error' era aún más pobre de lo que el auditor implica. Severidad ALTA justificada: es el flujo núcleo subir→revisar de un producto cuya tesis es la facilidad; el fallo de IA deja al usuario con un "Error" sin explicación y un mensaje que sugiere que no hay nada pendiente. / CONFIRMADO con secuencia reproducible: (1) usuario sube cartola → worker IA falla por cualquier excepción → catch en src/lib/ai/processor.ts:1074-1089 marca estado='error' + progreso_ia.error, sin toast (job de fondo, realtime solo refresca en silencio); (2) el árbol vivo muestra solo 'Error' en rojo (DocCardList.tsx:487), tooltip = nombre de archivo; (3) al seleccionar, MesaTab no cumple la rama VeredictoCartola (línea 230 exige estado==='procesado') y con pend.length===0 (un fallo no crea propuestas) cae a la línea 287: 'Sin propuestas pendientes en este documento.' — texto engañoso; (4) progreso_ia.error se renderiza ÚNICAMENTE en DocCardList.tsx:311-315, dentro de mode='list', que es código muerto: la única instanciación de <DocCardList> en todo src/ es MesaTab.tsx:198 con forceTree, que fuerza mode='grid' (DocCardList.tsx:124) y oculta el toggle (línea 201). Matiz doble que no refuta: (a) incluso en el modo list muerto, '↻ Reprocesar' NO se muestra para estado='error' (línea 325 exige procesado/subido; para error solo '↩ Deshacer'); (b) existe un camino de recuperación escondido — '↔ Mapear' → botón 'Guardar y reprocesar' (FieldMapper.tsx:282 → /api/parser/save-mapping reprocess:true → /api/procesar-documento, que no bloquea docs en error) — pero no está rotulado como reintento, el visor le dice al usuario que no hay nada pendiente, y falla si el archivo no quedó en Storage. Severidad alta justificada: flujo núcleo subir→revisar, fallo silencioso de un evento realista (caída del proveedor IA), mensaje que afirma lo contrario de la realidad, y única salida evidente = eliminar y re-subir a ciegas.


### La subida de cartolas (dropzone) no es operable por teclado — el punto de entrada del producto

**Lente:** Accesibilidad y usabilidad operable · **`src/app/(app)/escritorio/v5/DropzoneUpload.tsx:122`**


El dropzone es un <div> con onClick que dispara un <input type=file> con display:none. No tiene tabIndex, role ni onKeyDown: un usuario de teclado no puede abrir el selector de archivos, y el drag&drop tampoco le sirve. Como este componente es la única vía de subida (LeftQuickActions.tsx:298), el flujo completo cartola→boleta queda inaccesible sin mouse. Mismo patrón en el wizard: el placeholder 'Subir logo' de EmisorForm.tsx:297 también es <div onClick> sin foco.


```
<input ref={inputRef} type="file" ... style={{ display: "none" }} onChange={handleInput} />
<div className="dz" onClick={() => inputRef.current?.click()}
  onDragEnter={...} onDrop={...}
  style={{ cursor: "pointer", ... }}>
```


**Fix:** Convertir el dropzone en <button type="button"> (o añadir role="button", tabIndex={0} y onKeyDown Enter/Espacio) que llame inputRef.current.click(); aplicar lo mismo al placeholder de logo en EmisorForm.


*Verificación:* CONFIRMADO con evidencia de código. (1) DropzoneUpload.tsx: el input file (línea 119-120) tiene display:none (fuera del tab order y del árbol de accesibilidad) y el div.dz (línea 122) no tiene tabIndex, ni role, ni onKeyDown, ni onPaste, ni label htmlFor; el CSS .dz (page.tsx:193-200) solo define :hover, sin :focus — un usuario de teclado no puede abrir el selector, y drag&drop es inherentemente de mouse. (2) Es la única vía: DropzoneUpload se usa una sola vez (LeftQuickActions.tsx:298, dentro del modal 'Carga masiva') y DropzoneUpload.tsx:83 es el único caller frontend de /api/subir-procesar; los botones que abren el modal SÍ son <button> reales, así que el usuario de teclado llega al modal y queda en callejón sin salida. La ingesta Telegram (lib/telegram/ingesta.ts) es un canal aparte solo de imágenes, no mitiga. (3) EmisorForm.tsx:297 confirmado: el placeholder 'Subir logo' es <div onClick> sin foco con input display:none (línea 270); el patrón accesible existe en el propio repo (EmitirDirectaView:1318 usa <button> real para su input file), pero no aquí. Ninguna capa servidor (route handler, RLS, middleware) puede neutralizar un problema de operabilidad de teclado del cliente. Severidad alta justificada: fallo WCAG 2.1.1 nivel A en el punto de entrada único del flujo cartola→boleta — el producto completo es inusable sin mouse. / CONFIRMADO con evidencia de código. (1) DropzoneUpload.tsx:119-127: el input file tiene display:none (fuera del tab order, sin id/label asociado) y el div.dz con onClick no tiene tabIndex, role ni onKeyDown — grep sobre el archivo devuelve cero coincidencias de tabIndex|onKeyDown|role. (2) Es la única vía: DropzoneUpload se usa solo en LeftQuickActions.tsx:298 y es el único caller UI de /api/subir-procesar. (3) Secuencia concreta reproducible: el usuario de teclado SÍ abre el modal (el trigger 'SUBIR CARTOLAS' es un <button> nativo con :focus-visible, línea 211), pero dentro del modal solo son focuseables el botón × y el link 'Plantilla Excel'; Enter/Space nunca dispara inputRef.click(), el drag&drop exige puntero, y el botón 'Subir todo' está gateado por queue.length>0 — callejón sin salida total: ninguna cartola puede subirse sin mouse, y con ella todo el flujo cartola→boleta masiva (el core del producto). (4) EmisorForm.tsx:297 confirma el mismo patrón (<div onClick> sin foco para 'Subir logo'). Intentos de refutación fallidos: la ingesta Telegram es un canal aparte (no alternativa web de teclado) y 'Leer comprobante' de EmitirDirectaView (botón real) solo cubre emisión directa individual, no el flujo de cartola. Falla WCAG 2.1.1 en el punto de entrada del producto que excluye por completo a usuarios de solo-teclado: severidad alta justificada. Fix trivial: role="button" + tabIndex=0 + onKeyDown (Enter/Espacio) en ambos divs.


### Cero labels asociados a inputs y errores inline sin anuncio en todo v5 + wizard

**Lente:** Accesibilidad y usabilidad operable · **`src/app/(app)/empresa/EmisorForm.tsx:611`**


No existe ni un solo htmlFor, aria-describedby, aria-invalid ni aria-live/role=alert en src/app/(app)/escritorio/v5/ ni en src/app/(app)/empresa/ (verificado por grep). En el paso obligatorio del wizard, Field renderiza <label> como hermano del input sin asociación; en el editor inline los campos de receptor solo tienen placeholder (revisar-shared.tsx:442-447) y el error 'RUT no válido' (revisar-shared.tsx:449) ni los errores de Field (EmisorForm.tsx:626) se anuncian ni se vinculan al campo. Un lector de pantalla escucha inputs sin nombre y nunca se entera del error.


```
<label style={{...}}>
  {label}
  {required && <span ...>*</span>}
</label>
{children}   // el input queda fuera del label, sin htmlFor/id
```


**Fix:** Generar id con useId y asociar htmlFor + aria-describedby (hint/error) + aria-invalid en Field y en los inputs del editor inline; dar role="alert" al párrafo de error.


*Verificación:* Confirmado con evidencia de código. (1) Grep independiente en src/app/(app)/escritorio/v5/ y src/app/(app)/empresa/ devuelve CERO htmlFor, aria-describedby, aria-invalid, aria-live y role=alert — los únicos aria-* existentes son aria-label de botones/toggles y aria-modal del dialog, nunca en campos de formulario. (2) EmisorForm.tsx: Field (líneas 592-637) renderiza <label> (611) como hermano de {children} (624) sin htmlFor, y los inputs que recibe (324, 342, 353, 364, 375, 391) no tienen id ni aria-label; el error (626-629) es un <p> estilado sin role/aria-live ni vínculo al campo, y aria-invalid jamás se setea (solo borde rojo visual vía clase ef-input-error). (3) Ese formulario ES el paso obligatorio del wizard: EmpresaPopup.tsx:794 monta <EmisorForm variant=popup> como contenido del paso 'emisor'. (4) revisar-shared.tsx:442-447 confirmado: inputs de receptor solo con placeholder, y el error 'RUT no válido' (449) es un div plano sin anuncio ni asociación; el label 'Monto' (429) también es hermano sin asociación. (5) Busqué mitigaciones en otras capas y no existen: la única live region de la app es Toast.tsx:37 (role=status aria-live=polite), pero los errores inline de campo nunca pasan por Toast; no hay utilidades sr-only ni librería de formularios que inyecte ids, y al ser markup cliente puro ninguna capa servidor/RLS/middleware puede compensarlo. Único matiz menor: los inputs tienen placeholder, que algunos lectores exponen como nombre de respaldo (no conforme WCAG y desaparece al escribir), así que 'inputs sin nombre' es levemente exagerado en Chrome/VoiceOver; pero la mitad del hallazgo sobre errores no anunciados es un gap total. Patrón sistémico que afecta el flujo obligatorio de onboarding y el editor central de revisión: un usuario de lector de pantalla no puede completar el alta de emisor ni enterarse de errores de validación. Severidad alta justificada. / CONFIRMADO con matiz menor. Verificación independiente: (1) grep propio confirma CERO htmlFor/aria-describedby/aria-invalid/aria-live/role=alert en escritorio/v5/ y empresa/ (los únicos htmlFor del repo están en auth/onboarding); (2) Field (EmisorForm.tsx:611-624) renderiza <label> hermano del input sin id/htmlFor y el error es un <p> plano (626-629), evidencia citada exacta; los inputs solo tienen placeholders que son VALORES DE EJEMPLO ('12.345.678-9', 'Osvaldo Pérez / Mi Empresa SpA'), de modo que el lector de pantalla anuncia ejemplos como nombre de campo en el paso emisor del wizard (EmpresaPopup.tsx:794, navegación bloqueada si falla validación); (3) secuencia concreta de producción SIN ningún anuncio en revisar-shared.tsx: RUT con DV inválido → div 'RUT no válido' (línea 449) sin live region → puedeStagear=false (340) → botón Aprobar disabled (475) y handleAprobar early-return (345), NINGÚN toast en ese camino: silencio total para AT, botón atenuado sin razón programática; el select de medio de pago (444) no tiene nombre accesible. MATIZ que refuta una frase absoluta: el auditor no grepeó src/components/Toast.tsx:37, que tiene role=status aria-live=polite, y en EmisorForm el submit fallido SÍ dispara toast('RUT inválido') (líneas 95/102) que se anuncia — 'nunca se entera del error' es falso para ese sub-camino (aunque el anuncio es genérico, polite y no vinculado al campo; el error inline al blur sigue mudo). El hallazgo estructural (cero asociación label↔input y errores nunca vinculados/anunciados inline) existe tal como se describe, con fallas WCAG nivel A (1.3.1, 3.3.1/3.3.2, 4.1.2) sistémicas en el wizard obligatorio y en el flujo central de aprobación/emisión: severidad alta justificada.


### Query de propuestas del rango sin límite y con select('*') anidado: todo el mes se serializa al cliente

**Lente:** Rendimiento · **`src/app/(app)/escritorio/v5/mesa-data.ts:119`**


La consulta principal de la mesa trae TODAS las propuestas del rango con todas sus columnas más movimientos_raw(*) anidado, sin .limit(). En modo mes el rango es el mes extendido a semanas completas. Con la escala objetivo del producto (una cartola de prueba real ya genera 675 propuestas), un mes activo supera fácil las 1.000 filas: PostgREST trunca silenciosamente en su max-rows (default 1000) — la mesa muestra datos incompletos sin error — y hasta ese tope el payload completo (~22 columnas × propuesta + movimiento + doc) viaja al cliente en el RSC inicial, en CADA cargarMesa (toggle día/semana/mes) y en cada reload silencioso por realtime, quedando además retenido en el estado de MesaController. La query hermana del calendario (línea 120) tampoco tiene límite, así que los puntos del calendario también se truncan.


```
const [propsData, calProps, ...] = await Promise.all([
  supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))").eq("empresa_id", empresaId).gte("created_at", workStart).lt("created_at", workEnd).order("created_at", { ascending: false }),
```


**Fix:** Reemplazar el `*` por la lista de columnas que MesaTab/revisar-shared realmente consumen y poner un .limit() explícito con detección de desborde (count exacto + aviso 'mostrando N de M'); a mediano plazo cargar las propuestas por documento bajo demanda al seleccionar en el árbol.


*Verificación:* Confirmado en código real. mesa-data.ts:119 hace select('*,movimientos_raw(*,documentos_subidos(...))') sin .limit(), filtrado solo por empresa_id + rango created_at; en modo mes el rango es el mes extendido a semanas completas (líneas 87-98). supabase/config.toml:18 fija max_rows=1000 (igual al default hosted de PostgREST), que trunca SILENCIOSAMENTE (HTTP 200, sin error en supabase-js): propuestas, docTipoMix (l.202), editadoIds (l.240) y los puntos del calendario (calProps l.120, también sin límite) se calculan sobre datos incompletos. La escala es realista: processor.ts inserta 1 propuesta por movimiento y la cartola de prueba de referencia tiene 675 movimientos → un mes activo supera 1000 filas. El payload completo viaja al cliente: page.tsx:334 pasa mesaInicial (con propuestas verbatim, mesa-data.ts:258) como prop al client component (RSC flight), cada cargarMesa lo re-serializa entero, y MesaController lo retiene en useState MÁS un cacheRef Map sin tope por cada rango visitado (peor que lo descrito). Los reloads silenciosos por realtime existen: EmitirTabContent.tsx:148-152 escucha postgres_changes en propuestas_ia (event *) y boletas_emitidas con debounce 500ms → reloadMesa silent → re-fetch completo. Ninguna capa mitiga: RLS solo filtra por empresa (no capa filas), no hay paginación ni proyección; los head:true counts (l.123-124,128) y el .limit(50) de docs (l.122) muestran que el autor capó otras queries pero no esta. Único matiz: la truncación de editadoIds es solo UI (el gate server de emitir-lote sigue exigiendo estado='aprobado'), pero la desaparición silenciosa de datos en la mesa/calendario de un producto contable + la amplificación de payload justifican severidad alta. / CONFIRMADO con evidencia de código. (1) mesa-data.ts:119 hace select("*,movimientos_raw(*,documentos_subidos(...))") sin .limit()/.range(); la query hermana del calendario (línea 120) tampoco tiene límite — mientras las queries vecinas SÍ los tienen (docs .limit(50) línea 122, boletas .limit(300) línea 125), o sea es omisión. (2) El tope silencioso existe en ESTE proyecto: supabase/config.toml:18 fija max_rows=1000 (igual al default hosted); PostgREST responde 200 con 1000 filas y supabase-js no reporta error; con order desc se pierden las MÁS ANTIGUAS del rango. (3) La escala es real, no hipotética: processor.ts:959-1012 inserta 1 propuesta por movimiento y la cartola de prueba de referencia trae 675 movimientos en UNA subida; el modo mes extiende el rango a semanas completas (líneas 92-98). Secuencia concreta: 2 cartolas reales en el mismo mes (~1350 propuestas) + toggle a vista mes → la mesa pierde ~350 propuestas sin error, mientras pendCount/aprobCount (líneas 123-124, counts exactos sobre el MISMO rango) muestran los totales verdaderos → UI internamente inconsistente; los puntos del calendario también se capan. (4) El payload completo viaja y se retiene tal como se describe: page.tsx:71 lo serializa en el RSC inicial como prop de MesaController (client), cada primer toggle de rango lo refetchea vía cargarMesa (actions.ts:592), EmitirTabContent.tsx:148-152 suscribe a TODOS los eventos de propuestas_ia + INSERT de boletas y dispara reloadMesa({silent:true}) con debounce 500ms (una emisión masiva refire la query sin límite una y otra vez), y MesaController.tsx:48-53 retiene cada rango visitado en useState + cacheRef. Matices menores que no cambian el veredicto: el cache en memoria evita refetch en toggles repetidos al mismo rango (el "en CADA cargarMesa" está levemente sobreafirmado) y el mislabel de 'editado' por editadoIds truncado (línea 240) es solo UI porque emitir-lote re-valida estado 'aprobado' en el server. Severidad ALTA justificada: pérdida de datos silenciosa en la superficie central del producto exactamente a la escala objetivo (emisión masiva desde cartolas), más serialización repetida de ~1000 filas anchas anidadas al cliente.


### getPendientesEmision hace 2 queries sin límite que crecen con la vida de la empresa, en cada carga de la mesa

**Lente:** Rendimiento · **`src/lib/intermediario/pendientes-emision.ts:41`**


En cada render de la mesa (SSR, cada toggle del calendario y cada reload silencioso por realtime) se traen los propuesta_id de TODAS las boletas_emitidas de la empresa (sin rango ni límite) y todas las propuestas aprobado/editado con tipo_dte (líneas 55-60, tampoco acotadas al rango). Para un emisor masivo —el caso de negocio— esto crece sin techo: miles de filas transferidas por cada interacción del calendario. Peor: al superar el max-rows de PostgREST (default 1000) el Set yaEmitidas se trunca en silencio y boletas YA emitidas reaparecen como 'listas para emitir' en la cola de Emitir (el server sí las bloquea en emitir-lote con YA_EMITIDA, pero el usuario ve pendientes fantasma y recibe errores al confirmar).


```
const { data: emitidas } = await supabase
  .from("boletas_emitidas")
  .select("propuesta_id")
  .eq("empresa_id", empresaId)
  .neq("estado", "anulada")
  .not("propuesta_id", "is", null);
```


**Fix:** Consultar solo contra las propuestas visibles: `.in("propuesta_id", visibleIds)` (mismo patrón que emitir-lote route.ts:188-191), y acotar la query de tipo_dte al mismo rango/ids. Elimina el crecimiento sin techo y el riesgo de truncamiento.


*Verificación:* CONFIRMADO leyendo el código real. (1) Las dos queries existen tal cual: pendientes-emision.ts:41-46 trae TODOS los propuesta_id de boletas_emitidas de la empresa sin rango, sin .limit() y sin .order(); la de tipo_dte (:55-60) tampoco está acotada. Solo la query principal de propuestas respeta el rango del calendario. (2) La frecuencia es real: getPendientesEmision corre dentro de fetchMesaDateDependent (mesa-data.ts:223), invocada en el SSR de page.tsx y en la server action de navegación; MesaController cachea toggles repetidos en el cliente, pero reloadMesa limpia esa cache y EmitirTabContent.tsx:152 suscribe realtime a INSERT en boletas_emitidas → cada boleta emitida dispara un re-fetch silencioso completo de ambas queries. (3) No hay guarda en otra capa: emitir-lote NUNCA actualiza propuestas_ia.estado tras emitir (cero .update() sobre esa tabla), así que las propuestas emitidas quedan 'aprobado' para siempre y el ÚNICO dedup de la cola es el Set yaEmitidas; RLS no reduce filas (ya filtra por empresa_id) y no hay límite en route/middleware/tipos. (4) La truncación es real: supabase/config.toml:18 fija max_rows=1000 (default hosted igual); sin ORDER BY, sobre 1000 boletas de vida el Set pierde filas arbitrarias y boletas YA emitidas reaparecen como 'listas' inflando totales; al confirmar, el server las bloquea con YA_EMITIDA (emitir-lote:212-213) porque SU check sí está acotado (.in propuesta_id, ≤200) — exactamente el escenario descrito (pendientes fantasma + errores al usuario, sin doble emisión). Único matiz: la transferencia por query está capada en 1000 filas por max_rows (no 'miles' sin techo), pero ese cap es precisamente lo que produce el bug silencioso. Severidad alta justificada: el cliente objetivo es el emisor masivo (cartola de prueba = 675 movs; >1000 boletas de vida se alcanza en semanas) y el fallo corrompe silenciosamente la cola central del producto. / CONFIRMADO con evidencia de código. (1) Las 2 queries citadas (pendientes-emision.ts:41-46 y 55-60) son empresa-wide, all-time, sin limit/range/ORDER BY. (2) max_rows=1000 está explícito en supabase/config.toml:18 (y es el default hosted): PostgREST trunca en silencio y sin orden determinista. (3) El Set yaEmitidas es el ÚNICO filtro que oculta boletas emitidas de la cola: emitir-lote NUNCA actualiza propuestas_ia (solo SELECT en línea 107) y la migración documento_pipeline_counts confirma que 'emitida' se deriva por exists() — la propuesta queda 'aprobado' para siempre. (4) Frecuencia confirmada: getPendientesEmision corre en cada SSR, cada navegación de calendario sin cache, cada upload y cada reload silencioso por realtime (EmitirTabContent.tsx:148-155 se suscribe a postgres_changes de propuestas_ia y boletas_emitidas y dispara reloadMesa silent que vacía la cache completa). (5) Secuencia concreta: emisor masivo (cartola real de prueba = 675 movs) emite 675 boletas/mes → al mes 2 hay 1350 filas > 1000 → el Set pierde ~350 ids arbitrarios → boletas YA emitidas reaparecen como 'listas para emitir' con totales inflados; al confirmar, el server las rechaza una a una con YA_EMITIDA (su guard sí está acotado con .in(ids), lote ≤200 → no hay doble emisión). (6) Agravante no citado: la truncación de la 2ª query (tipo_dte) puede botar la decisión humana 41-EXENTA; la UI manda tipo_sugerido como override con precedencia MÁXIMA en el route (línea 272) → puede emitirse 39-AFECTA real equivocada. Matices menores que no cambian el veredicto: la transferencia por interacción está capada a ~1000 filas/query por max_rows (no crece 'sin techo' en bytes) y la cache en memoria absorbe toggles repetidos a rangos ya visitados. La severidad ALTA se sostiene: truncación silenciosa en el camino del dinero, pendientes fantasma de documentos tributarios ya emitidos, alcanzable en ~2 meses de uso normal por el cliente objetivo del producto, más un camino secundario que emite el tipo DTE incorrecto.


---

## 🟠 ALTAS PLAUSIBLES (un verificador la confirmó)


### El aviso de duplicados omitidos (caso P2P repetidos) es inalcanzable en el producto vivo

**Lente:** UX de flujos · **`src/app/(app)/escritorio/v5/DocCardList.tsx:271`**


El warning "Esta cartola tiene transferencias del mismo monto… puedes recuperarlos" y el desplegable "Ver omitidos" (duplicados_detalle/falsos_duplicados_warning que processor.ts sí escribe) solo se renderizan en mode==="list" (línea 213). Pero el único consumidor de DocCardList es MesaTab con forceTree (MesaTab.tsx:207), que fuerza mode="grid" y nunca muestra nada de esto. El usuario objetivo (vende cripto P2P con cobros repetidos del mismo monto — el caso que este warning existe para cubrir) pierde movimientos reales silenciosamente: no hay forma en la UI de ver qué se omitió ni de recuperarlo. Además, ni aun en el código muerto existe acción de recuperación (solo texto que la promete).


**Fix:** Mover el aviso + lista de omitidos al visor de cartola (VeredictoCartola) o al popup Editar, y cablear una acción real "Recuperar" (re-insertar el movimiento omitido); mientras no exista, no prometer "puedes recuperarlos".


### En Emitir, la selección individual de boletas solo funciona con mouse

**Lente:** Accesibilidad y usabilidad operable · **`src/app/(app)/escritorio/v5/EmitirTabContent.tsx:313`**


El checkbox de cada ítem es un <div className="cb"> con onClick y el cuerpo (<div className="inf">, línea 317) que alterna selección o navega a Check también es un div con onClick. Sin tabIndex ni role="checkbox"/aria-checked, un usuario de teclado o lector de pantalla no puede elegir QUÉ boletas emitir (solo tiene 'Seleccionar todas', que es un checkbox real) ni saltar a Check desde un ítem bloqueado. Es el flujo de dinero central del producto.


**Fix:** Reemplazar el div.cb por un <input type="checkbox"> real (como el 'Seleccionar todas' de la línea 282) con aria-label por ítem, y hacer del 'Resolver en Check' un <button> real.


---

## 🟡 MEDIAS


### Seguridad de API y autorización


- **Bot de Telegram: vincular sin gate de rol y sin revocación — un viewer o un miembro vetado/removido puede aprobar propuestas** — `src/app/api/telegram/webhook/route.ts:139`  
  POST /api/telegram/link solo exige sesión + empresa (telegram/link/route.ts:63-70, sin check de rol), así que un 'viewer' puede vincular su chat. Una vez vinculado, el webhook autoriza cada callback solo con telegram_chats.activo (empresaDelChat) y aprobarBot/editarCampoBot operan por empresa_id sin verificar rol ni vetado del usuario que vinculó (propuestas.ts:661-668). Además, NINGÚN código pone telegram_chats.activo=false (grep sin resultados): al remover/vetar a un miembro, su chat sigue pudiendo listar, editar y aprobar propuestas (acto tributario) indefinidamente — bypass del gate ROLES_ESCRITURA/ROLES_EMISION y del kill-switch vetado que sí se aplica en el resto de la app.  
  *Fix:* Exigir ROLES_EMISION en POST /api/telegram/link y, en el webhook, revalidar que telegram_chats.usuario_id siga activo, no vetado y con rol de escritura; desactivar los chats del usuario al removerlo/vetarlo.

- **registrarConsentimiento es una server action pública sin auth que escribe con service role la tabla de prueba legal** — `src/app/(auth)/auth/actions.ts:72`  
  El archivo es un módulo "use server", por lo que TODA función exportada es un endpoint POST invocable desde fuera. registrarConsentimiento(userId, email) no valida sesión ni que userId corresponda al caller: cualquiera que obtenga su action-id puede insertar filas arbitrarias (user_id/email/ip falsos) en `consentimientos` vía service role. Esa tabla es la prueba inmutable del consentimiento (burden of proof Ley 19.628/21.719): permitir inserciones forjadas/no autenticadas degrada su valor probatorio y habilita escritura ilimitada a la DB sin auth.  
  *Fix:* Quitarle el export (helper interno llamado por signUp) o moverla a un módulo sin "use server"; si debe quedar exportada, validar sesión y derivar userId/email de auth.getUser().

- **editarMovimientoPropuesta omite el guard de estado y el downgrade a 'editado': se puede mutar monto/receptor de una propuesta ya aprobada en cola de emisión** — `src/app/(app)/revisar/actions.ts:419`  
  editarPropuesta protege con .in("estado", ["pendiente","editado","listo"]) y marca estado:'editado' (auditoría #21), pero editarMovimientoPropuesta actualiza movimientos_raw.monto/descripcion y propuestas_ia.receptor_rut/receptor_nombre/notas SIN filtro de estado y SIN degradar a 'editado'. Una propuesta 'aprobado' (comprometida a Emitir) puede cambiarse de receptor/monto justo antes de que emitir-lote la lea (usa p.receptor_rut y mov.monto como fallback de total), burlando la regla de re-aprobación. Además movUpdate.monto = campos.monto se persiste sin validación runtime (las server actions son endpoints públicos; el tipo TS no limita el payload).  
  *Fix:* Replicar el guard .in("estado", ["pendiente","editado","listo"]) en ambos updates, setear estado:'editado' cuando cambian campos emitibles, y validar monto con Number.isFinite + rango.

- **El 'doble gate' del operador dev no verifica usuarios.dev_mode: el god-mode depende solo de un email hardcodeado** — `src/lib/dev/support-mode.ts:72`  
  dev/actions.ts:5-25 documenta 'doble gate server-side (sesión + usuarios.dev_mode)' pero getDevOperatorContext solo compara email contra DEV_OPERATOR_EMAIL y vetado — dev_mode nunca se chequea (los únicos usos reales son diagnóstico 'informativo' y el bypass de cuota en emitir-lote). Ese gate custodia poderes irreversibles: purgarCuenta (borrado total de cualquier cuenta), setCuentaPlan, modo soporte read-any-tenant (requireAccountApiAccess lo honra) y /api/document-processing/retry. No hay kill-switch por columna: si la cuenta del operador se compromete (deuda conocida: password débil sin MFA) no existe la segunda barrera que el propio código promete.  
  *Fix:* Agregar `|| usuario.dev_mode !== true` al rechazo en getDevOperatorContext, alineando el código con el invariante documentado y habilitando dev_mode como kill-switch.

- **crearEmpresa no verifica empresa existente: re-onboarding pisa empresa_id/rol del usuario y permite squatting de RUT** — `src/app/(onboarding)/onboarding/actions.ts:61`  
  La action es alcanzable por cualquier usuario logueado y hace upsert de usuarios con rol:'owner' y el empresa_id nuevo sin comprobar si el usuario ya pertenece a otra empresa. Un contador/viewer invitado que envíe el formulario de /onboarding queda desconectado de la empresa compartida (usuarios.empresa_id cambia y cambiarEmpresaActiva solo permite empresas de SU nueva cuenta) — recuperación solo vía operador. Además el RUT es único global: un tercero puede registrar el RUT de otra empresa primero y bloquear su onboarding legítimo ('Ese RUT ya está registrado').  
  *Fix:* Si usuarios.empresa_id ya existe, rechazar (o derivar al flujo multiempresa de la cuenta) en vez de upsert con rol owner; considerar verificación del RUT antes de reservarlo definitivamente.

- **Rate limiting en memoria por instancia serverless: inefectivo en Vercel, y el OCR (costo IA) no tiene gate de plan** — `src/lib/security/rate-limit.ts:29`  
  El store es un Map en globalThis: en Vercel cada instancia/cold start tiene su propio contador, así que los límites (ocr-comprobante 12/min, emision-jobs 12/min) se multiplican por N instancias y se evaden con requests paralelas. Agrava que /api/ocr-comprobante (Mistral OCR, costo por request) solo exige sesión + empresa — sin plan activo ni cuota (ocr-comprobante/route.ts:51-61): una cuenta gratuita recién registrada puede quemar presupuesto de OCR de forma prácticamente ilimitada.  
  *Fix:* Respaldar el rate limit en un store compartido (Upstash/Redis o tabla Postgres con upsert atómico) y añadir gate de plan/cuota al OCR igual que en emisión.


### Pipeline de emisión (plata / SII)


- **Carril REAL: totalsFor persiste neto/iva del cliente sin verificar neto+iva=total** — `src/app/api/sii-local/result/route.ts:328`  
  Para tipo 39, la boleta real se persiste con `monto_neto` e `iva` tomados tal cual del payload de la extensión (scraping del portal SII), con fallback independiente por campo. Si la extensión manda un neto escrapeado y un iva desalineado (o viceversa), se guarda una boleta real cuyo neto+iva no cuadra con monto_total — el registro contable/RCV del usuario queda corrupto sin ningún aviso. En el carril mock esto es imposible porque descomponerBruto garantiza la identidad por construcción (validation.ts:72-77); el carril real no tiene ese cierre.  
  *Fix:* Validar `monto_neto + iva === monto_total` (tolerancia ±1 como DETALLE_NO_CUADRA); si no cuadra, recalcular ambos con descomponerBruto(total) y registrar la discrepancia en proveedor_respuesta para auditoría.

- **Lote de hasta 200 boletas secuenciales sin maxDuration: el corte a mitad deja lock colgado y respuesta perdida** — `src/app/api/intermediaria/emitir-lote/route.ts:101`  
  El route acepta 200 propuestas (línea 101-103) y las procesa en serie con ~5 roundtrips a DB por ítem (RPC folio + insert boleta + insert documento + selects), pero no exporta `maxDuration` — a diferencia del webhook de Telegram que sí lo hace (route.ts:1128 `export const maxDuration = 300`). 200 ítems × ~1.5s ya roza los 300s. Si Vercel mata la función a mitad del loop, el `finally` (línea 497-499) no corre: el lock queda activo hasta su TTL (300s, línea 160), la respuesta con el detalle de qué se emitió se pierde (boletas SÍ persistidas una a una), y no se escribe el audit de cuenta. El usuario ve un error genérico sin saber cuántas salieron.  
  *Fix:* Exportar `maxDuration = 300`, bajar el tope por request (p. ej. 50 con chunking en el cliente) y dimensionar el TTL del lock por encima de la duración máxima esperada del lote.

- **Pre-check anti-duplicado del lote es fail-open y no dedupe los ids del payload: colisiones queman folio y devuelven DB_INSERT_FAILED en vez de YA_EMITIDA** — `src/app/api/intermediaria/emitir-lote/route.ts:184`  
  El set `yaEmitidas` se construye ignorando el `error` del select (destructuring solo de `data`, catch vacío en línea 193): si la consulta falla, el lote sigue con el set vacío. Además `ids` (líneas 93-97) no se dedupe, así que el mismo propuesta_id dos veces en `body.items` pasa el pre-check en ambas iteraciones. La doble boleta la salva el índice único parcial (migración 20260416_boletas_propuesta_link.sql:10-12), PERO para entonces `issueMockBoleta` ya consumió el folio vía consume_next_folio (mock.ts:48-51, antes del insert de la línea 361): cada colisión quema un folio del CAF y el usuario recibe un 'DB_INSERT_FAILED' críptico en vez de 'YA_EMITIDA'.  
  *Fix:* Deduplicar (`const ids = [...new Set(...)]`), abortar el lote si el select de yaEmitidas devuelve error, y mapear el código 23505 del insert a error_code YA_EMITIDA legible.

- **El gate de cuota activa trial_inicio con el conteo crudo del payload, antes de filtrar propuestas inválidas** — `src/app/api/intermediaria/emitir-lote/route.ts:174`  
  verificarEmisionMasiva se llama con `ids.length` ANTES de descartar YA_EMITIDA / ESTADO_INVALIDO / TIPO_INVALIDO / NO_BOLETAR. Dos efectos: (1) si la empresa no tiene trial iniciado, `decidirGate` retorna 'activar_trial' y metering.ts setea `empresas.trial_inicio` de inmediato — aunque después el lote falle al 100%, el reloj del período de prueba ya corre (días de trial = plata del usuario); (2) un lote de 8 con 4 ya emitidas se rechaza por CUOTA_AGOTADA cuando quedan 5 disponibles, aunque solo 4 fueran a emitirse.  
  *Fix:* Filtrar primero (yaEmitidas + estado + tipo emitible) y pasar al gate solo el conteo real a emitir; o diferir el update de trial_inicio hasta después de la primera emisión exitosa del lote.

- **emitir-boleta (única) no tiene lock de emisión ni idempotencia server-side: doble submit = boleta doble** — `src/app/api/intermediaria/emitir-boleta/route.ts:29`  
  A diferencia del lote (que adquiere acquireCuentaEmissionLock, emitir-lote/route.ts:154), este route no toma ningún lock ni acepta idempotency-key, y las boletas únicas no tienen propuesta_id, así que el índice único parcial tampoco las protege. El único guard es el estado `emitiendo` del cliente (EmitirDirectaView.tsx:291), que no cubre retry de red, doble pestaña ni requests directos: dos submits = dos boletas con folios distintos que inflan los ingresos del usuario, sin flujo de anulación en la app (decisión sin NC). Hoy es carril mock/sandbox, pero es EL endpoint de boleta única del producto.  
  *Fix:* Reusar el mismo lock por cuenta del lote (acquire/release en finally) o aceptar un idempotency-key del cliente persistido en boletas_emitidas con índice único.

- **El lote acepta tipo_dte 39 (afecta) para una empresa exenta: el override del payload manda sin validar tipo_contribuyente** — `src/app/api/intermediaria/emitir-lote/route.ts:272`  
  La precedencia `tipoPorId.get(pid) ?? tipoPersistido ?? clasif.tipo_dte ?? 39` hace que el tipo_dte del body mande sobre todo, sin contrastarlo con `empresa.tipo_contribuyente`. La regla 'empresa exenta ⇒ venta exenta' se aplica solo al insertar propuestas (processor.ts:977 vía normalizarTipoPorEmisor, tipo-emisor.ts:31-32) y como bias del clasificador — pero en el punto donde se emite el documento no hay guard: un payload con `tipo_dte: 39` (UI con datos stale, bug futuro, o request directo) emite una boleta AFECTA con IVA para un contribuyente exento, un documento tributario incorrecto que genera débito fiscal indebido.  
  *Fix:* En el route, si `empresa.tipo_contribuyente === "exento"` y tipoDte resuelve 39, forzar 41 (o rechazar con error TIPO_INCOMPATIBLE_EMISOR) — espejo del punto único de tipo-emisor.ts a nivel de emisión.


### Integridad de datos (operaciones destructivas)


- **TOCTOU en deshacer/eliminar vs emisión en vuelo: el guard cuenta boletas y luego borra sin lock; el FK SET NULL orfana la boleta** — `src/app/api/deshacer-documento/route.ts:72`  
  deshacer y eliminar hacen check-then-act sin ningún lock: cuentan boletas_emitidas y DESPUÉS borran propuestas (en eliminar, además, entre el check y el delete corren los borrados de storage R2/Supabase — segundos de ventana). Ninguna de las dos rutas consulta el emission lock de cuenta que emitir-lote sí toma (locks.ts). Si una emisión está en vuelo cuando pasa el guard (count=0): (a) la boleta se inserta después del delete de la propuesta → FK viola → folio ya consumido por consume_next_folio sin registro de boleta; o (b) la boleta se inserta antes del delete → boletas_emitidas.propuesta_id es ON DELETE SET NULL (migración 20260416_boletas_propuesta_link.sql:6), el delete pasa en silencio y queda una boleta con folio desvinculada mientras el movimiento se borra y puede re-proponerse/re-emitirse. Hoy el lote es solo mock (sandbox), pero el patrón queda armado para los carriles reales.  
  *Fix:* deshacer/eliminar deben adquirir el mismo acquireCuentaEmissionLock antes del guard (y liberar en finally), de modo que no puedan correr concurrentes con una emisión de la cuenta.

- **emitir-lote: ids duplicados en un mismo request emiten dos boletas para la misma propuesta** — `src/app/api/intermediaria/emitir-lote/route.ts:192`  
  La única defensa contra doble emisión es yaEmitidas, que se calcula UNA vez antes del loop y nunca se actualiza; ids (route:93-97) no se deduplica, la propuesta jamás cambia de estado (sigue 'aprobado' — ningún código del repo setea 'emitido') y boletas_emitidas no tiene unique sobre propuesta_id. Un POST con [X, X] (doble click que arma el array dos veces, retry del cliente, o request manual) emite dos boletas con dos folios para la misma propuesta dentro del mismo lote: el lock de cuenta protege entre requests, no dentro de uno.  
  *Fix:* Deduplicar ids al normalizar (const unicos = [...new Set(ids)]) y hacer yaEmitidas.add(pid) tras cada emisión exitosa; idealmente además unique parcial en boletas_emitidas(propuesta_id) WHERE estado != 'anulada'.

- **deshacer-documento ignora los errores de todos sus deletes y resetea a 'subido' igual** — `src/app/api/deshacer-documento/route.ts:86`  
  Los deletes de propuestas_ia (86), movimientos_raw (90), ia_uso (93) y el update final (96-103) descartan el objeto error sin verificarlo: si cualquiera falla (timeout, pool agotado), el flujo continúa y responde { ok: true }. Peor caso: delete de movimientos falla pero el doc queda 'subido' → documento 'virgen' con movimientos/propuestas vivos; si el usuario logra reprocesar (o re-sube), esos restos conviven con la nueva pasada. En eliminar-documento pasa lo mismo con propuestas/movimientos/ia_uso (líneas 135-143): solo el delete de la fila final se verifica.  
  *Fix:* Capturar el error de cada delete/update y abortar con 500 al primer fallo (sin resetear estado); como los FK ya son ON DELETE CASCADE, la alternativa simple es delegar la cascada y verificar un único delete.

- **Auditoría incompleta: deshacer y cancelar no dejan rastro en cuenta_audit** — `src/app/api/deshacer-documento/route.ts:105`  
  eliminar-documento registra recordCuentaAudit ('documento_eliminado', route:149-158), pero deshacer-documento —que destruye propuestas y movimientos, igual de irreversible para los datos derivados— retorna { ok: true } sin ninguna entrada de auditoría, y cancelar-documento (que aborta un procesamiento pagado en tokens) tampoco. Para un producto tributario, las operaciones destructivas sin trazabilidad de quién/cuándo rompen la reconstrucción de qué pasó con una cartola ante un reclamo del SII o de soporte.  
  *Fix:* Añadir recordCuentaAudit en deshacer-documento (accion 'documento_deshecho', con conteo de propuestas/movimientos borrados, como hace eliminar) y en cancelar-documento (accion 'procesamiento_cancelado').

- **La recuperación de la cola depende de un cron DIARIO y de un kick post-respuesta no garantizado en Vercel** — `src/app/api/subir-procesar/route.ts:163`  
  El kick oportunista es una promesa suelta (sin await, sin waitUntil/after de Vercel): tras retornar la respuesta, la función serverless puede congelarse y matar el procesamiento en cualquier punto (además alimentando el finding de duplicación por inserts parciales). El comentario dice 'el cron lo retoma', pero /api/document-processing/cron corre UNA vez al día (vercel.json: '45 12 * * *'), y el watchdog de jobs colgados solo se ejecuta dentro de processDocumentQueue (próximo upload o ese cron). Si el kick muere, la cartola del usuario queda en 'procesando/queued' hasta 24 horas — para el usuario, la app está rota.  
  *Fix:* Envolver el kick en waitUntil (@vercel/functions) o after() de next/server y declarar maxDuration acorde en las rutas de upload/reproceso; subir la frecuencia del cron de la cola (cada pocos minutos en plan Pro) como red real de rescate.

- **Puntero de storage sin verificación tras subir a R2: PII huérfana imposible de borrar** — `src/app/api/subir-procesar/route.ts:102`  
  El doc se inserta con storage_path='memoria' y recién después de subir a R2 se actualiza el puntero — pero ese update no verifica el error, y si la función muere entre la subida a R2 (línea 86) y el update, el doc queda apuntando a 'memoria' mientras la cartola real (PII bancaria) vive en R2. eliminar-documento filtra explícitamente los paths 'memoria' (route:110), así que ese archivo no se borrará nunca por ninguna vía del producto; el job sí procesa (lleva su propio storagePath), ocultando la divergencia.  
  *Fix:* Verificar el error de ese update (y marcarlo/reintentar si falla); la key de R2 es determinística (empresa/docId__nombre), así que además un barrido de huérfanos por prefijo de empresa cerraría el gap del crash.


### Calidad del código React


- **Boleta única: cinco router.refresh() esperando refrescar la mesa — patrón documentado como roto** — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:899`  
  Tras emitir/persistir una boleta única (mock línea 899, SimpleAPI 653, resultado SII 685, folio manual 1090, PDF recuperado 1121) el componente llama router.refresh(), que no actualiza la mesa (estado client-held). EmitirDirectaView vive en leftColumn, FUERA del MesaReloadContext, así que no hay reloadMesa. Mitigación incidental: el INSERT en documentos_subidos/boletas_emitidas dispara realtime en DocCardList/EmitirTabContent — pero esos solo están montados si la pestaña correspondiente está activa Y la mesa no está vacía (Mesa.tsx:53 renderiza compactEmpty sin MesaTab). Escenario de fallo: usuario nuevo con mesa vacía emite su PRIMERA boleta (incluso real vía SII); cierra el modal y la pestaña Boletas sigue diciendo 'Aún no hay boletas' hasta F5 — exactamente el bug que ya arreglaron para el uploader con el evento massdte:uploaded.  
  *Fix:* Reemplazar los router.refresh() por window.dispatchEvent(new CustomEvent("massdte:uploaded", { detail: { date: chileTodayString() } })) — el mismo puente que MesaController ya traduce a recarga fresca de la mesa (patrón de MassDTEAction.handleUploaded).

- **VeredictoCard.commit ignora el error de editarPropuesta y aprueba igual con los datos viejos** — `src/app/(app)/escritorio/v5/VeredictoCard.tsx:211`  
  commit() persiste primero las ediciones locales (tipo afecta/exenta, neto/iva/total, tipo_dte) con editarPropuesta y NUNCA revisa su resultado; luego ejecuta aprobarPropuesta. Si editarPropuesta devuelve {error} (validación, RLS, race), la propuesta se aprueba y entra a la cola de Emitir con el tipo y montos ANTIGUOS mientras el usuario ve el toast 'Aprobada'. Escenario: usuario corrige afecta→exenta en el visor de Telegram y aprueba; el edit falla silenciosamente → queda staged como afecta con IVA fabricado sobre una venta exenta (el footgun tributario que el clasificador prohíbe). Además, si editarPropuesta lanza (red), busy queda atascado en true.  
  *Fix:* Capturar el resultado de editarPropuesta y abortar (toast + setBusy(false) + return) si trae error, igual que hace ExpandedDetail.handleAprobar en revisar-shared.tsx:363-364; envolver todo en try/finally.

- **Server actions await-eadas sin try/catch: un throw deja el estado busy atascado y botones deshabilitados para siempre** — `src/app/(app)/escritorio/v5/MesaTab.tsx:143`  
  Patrón sistémico: handleAprobarCartola (MesaTab.tsx:143-150), ExpandedDetail.handleAprobar/handleRechazar (revisar-shared.tsx:344-379), CartolaEditor.stagePendientes (CartolaEditor.tsx:161-175), EditorAmpliado.guardar (EditorAmpliado.tsx:132-152) y GlosaComunControl.persist (GlosaComunControl.tsx:35-41) hacen await de un server action sin try/catch. Los server actions LANZAN ante caída de red/deploy en curso (no devuelven {error}), así que el setBusy(false)/setAprobandoCartola(false) posterior nunca corre: rechazo de promesa sin manejar y el botón 'Aprobar N'/'Poner listo'/'Guardar' queda deshabilitado (busy=true) hasta remontar el componente, sin ningún feedback al usuario. Contrasta con eliminarSelDoc (MesaTab.tsx:181-192) que sí usa try/catch/finally.  
  *Fix:* Envolver cada await de server action en try { ... } catch { toast("Error de red — intenta de nuevo", "error"); } finally { setBusy(false); } (mismo patrón que eliminarSelDoc).

- **SimpleAPI/SII local: si la extensión no responde al postMessage, emitiendo/localWorkerLoading quedan atascados sin timeout** — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:964`  
  sendSimpleApiGenerar hace setEmitiendo(true), crea el job de emisión (lock server-side) y despacha window.postMessage a la extensión; el único camino que resetea emitiendo es que la extensión conteste APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT o un status de error. Si la extensión fue deshabilitada/crasheó después del ping inicial de montaje (extensionStatus quedó 'ready' cacheado), no llega respuesta jamás: el CTA queda en 'Generando...' indefinidamente, canSubmit=false, y el lock de emisión solo muere por TTL. Mismo agujero en sendLocalSiiJob (localWorkerLoading, línea 976-987). El helper pingLocalSiiExtension ya implementa el timeout de 900ms — el envío del job no lo reutiliza.  
  *Fix:* Tras el postMessage, armar un window.setTimeout (p.ej. 10-15s sin ningún STATUS recibido) que resetee emitiendo/localWorkerLoading, cierre el job (closeEmissionJob) y muestre toast 'La extensión no responde — recárgala en Chrome'; cancelarlo al recibir el primer mensaje del job.

- **MesaController.navigate: fallo silencioso (URL ya cambiada) y respuestas fuera de orden sin guard de secuencia** — `src/app/(app)/escritorio/v5/MesaController.tsx:66`  
  navigate() hace history.replaceState ANTES del fetch y luego, si cargarMesa devuelve !res.ok (red caída, sesión expirada), no hace nada: ni toast, ni revertir la URL — el usuario clickea un día, no pasa nada visible y la URL queda apuntando a un rango que la mesa no muestra (compartir/F5 da otra cosa que lo que se ve). Además dos navegaciones rápidas no cacheadas corren en paralelo sin token de secuencia: si la respuesta del primer click llega después de la del segundo, setMesa deja la mesa en el rango viejo con la URL del nuevo. reloadMesa (líneas 78-85) tiene el mismo fallo silencioso: tras aprobar/emitir, si la recarga falla el usuario sigue viendo contadores viejos sin ningún aviso.  
  *Fix:* Agregar un ref de secuencia (const seq = ++seqRef.current; ... if (seq !== seqRef.current) return;) para descartar respuestas obsoletas, y en !res.ok mostrar toast de error (y/o revertir la URL al rango vigente).


### Higiene y fuente única de verdad


- **Estados de propuesta sin fuente única: la lista emitible ['aprobado','editado'] y las allowlists de transición están copiadas a mano en ≥8 archivos** — `src/lib/intermediario/pendientes-emision.ts:31`  
  Exactamente la clase de bug que ya mordió al equipo sigue estructuralmente abierta: no existe ningún union type ni constante compartida para el estado de propuestas_ia (database.types.ts lo tipa como string pelado). La lista ["aprobado","editado"] está escrita a mano en pendientes-emision.ts:31,59,170 y account-360.ts:490; las allowlists de transición ["pendiente","editado","listo"] en revisar/actions.ts:240 y :335; los filtros de mesa en mesa-data.ts:123,143,203, MesaTab.tsx:137 y telegram/propuestas.ts:292,668. Ya hay una divergencia sospechosa: contarComprobantesTelegramUtiles (v5/actions.ts:128) filtra .in("estado", ["pendiente","aprobado","editado"]) SIN 'listo' — si una propuesta telegram pasa por ponerListo (que no restringe origen, revisar/actions.ts:313-335) deja de contar para el metering mientras está staged. Cada estado nuevo (como 'listo', agregado hace poco) obliga a cazar N archivos.  
  *Fix:* Crear src/lib/propuestas/estados.ts con el union EstadoPropuesta y constantes con nombre (ESTADOS_EMITIBLES, ESTADOS_PRE_EMISION, ESTADOS_BORRADOR, ESTADOS_UTILES_METERING) e importarlas en todos los .in()/comparaciones; revisar en ese paso si el metering telegram debe incluir 'listo'.

- **Lista EXENTOS_POR_TIPO duplicada en 4 archivos y ya divergió: VeredictoCartola omite factura_exenta y transferencia_p2p** — `src/app/(app)/escritorio/v5/VeredictoCartola.tsx:74`  
  La lista de tipos exentos por ley (la que evita fabricar IVA sobre cripto/forex/P2P) existe en 4 copias: revisar-shared.tsx:301 y EditorAmpliado.tsx:35 (arrays idénticos EXENTOS_POR_TIPO/AFECTOS_POR_TIPO), mesa-data.ts:211-212 (encadenada inline para docTipoMix) y VeredictoCartola.tsx:74 como fallback de esExenta — y esta última YA divergió: le faltan "factura_exenta" y "transferencia_p2p". Cuando tipoMix llega undefined (docs fuera de mesa.docTipoMix), una cartola de transferencias P2P sin tipo_dte persistido se muestra como AFECTA en el veredicto que el usuario usa para decidir el Aprobar atómico, contradiciendo el split del server y del editor.  
  *Fix:* Exportar EXENTOS_POR_TIPO/AFECTOS_POR_TIPO (o helpers esTipoExento/esTipoAfecto) desde un módulo compartido — el candidato natural es src/lib/ai/tipo-emisor.ts, que ya es el punto único de la regla exento — y consumirlos en los 4 sitios.

- **TIPOS_EMITIBLES re-declarado a mano dentro de emitir-lote en vez de importar el export existente** — `src/app/api/intermediaria/emitir-lote/route.ts:224`  
  pendientes-emision.ts:13 exporta const TIPOS_EMITIBLES (la cola de Emitir la usa), pero el gate real de emisión re-declara un array local con el mismo nombre y contenido dentro del loop del route. Hoy son idénticos; el día que se agregue un tipo boletable nuevo (p. ej. un tipo de venta de F5 multi-fuente) a uno y no al otro, la cola mostrará propuestas que el server rechaza con TIPO_INVALIDO — el mismo patrón cola-vs-gate del bug de 'editado' que ya los mordió.  
  *Fix:* Borrar la copia local y hacer import { TIPOS_EMITIBLES } from "@/lib/intermediario/pendientes-emision" (o mover la constante a un módulo neutro tipo lib/intermediario/tipos.ts si preocupa el ciclo de imports).

- **Validación de RUT implementada dos veces (lib/rut.ts y lib/sii/validation.ts) con semánticas distintas, ambas usadas en el producto** — `src/lib/rut.ts:11`  
  Hay dos módulo-11 completos: src/lib/rut.ts:11 (limpia solo [.\-\s], sin tope de largo) y src/lib/sii/validation.ts:43 (limpia todo lo no [0-9kK], tope 10 chars). No son equivalentes: "12,345,678-5" es válido para validation.ts y falso para rut.ts; un RUT de 12 dígitos con DV correcto pasa en rut.ts y falla en validation.ts. Y ambos están vivos en superficies vecinas: EmitirDirectaView.tsx:7 y onboarding/actions.ts:8 importan @/lib/rut, mientras revisar-shared.tsx:15, EditorAmpliado.tsx:8, empresa/actions.ts:9 y EmisorForm.tsx:6 importan @/lib/sii/validation. El mismo RUT puede ser aceptado en el editor de Check y rechazado en la emisión directa (o viceversa), y también hay dos formatRut.  
  *Fix:* Eliminar src/lib/rut.ts (y su test) y migrar EmitirDirectaView y onboarding/actions a validarRut/formatRut de lib/sii/validation.ts, que es la versión con más cobertura y la que usa el resto del stack de emisión.

- **Allowlist de roles de emisión new Set(["owner","admin","contador"]) copiada en 11 archivos de API** — `src/lib/api/account-guard.ts:10`  
  El mismo Set de roles autorizados a emitir/mutar está re-declarado en account-guard.ts:10, emitir-lote/route.ts:33, emitir-boleta/route.ts:27, simpleapi-multipart-proxy.ts:17, sii-local/result/route.ts:59, sii-local/reconcile/route.ts:7, simpleapi/dte/generar/route.ts:20, simpleapi/result/route.ts:11, revisar/actions.ts:38, y además inline en cancelar-documento/route.ts:15, eliminar-documento/route.ts:34 y deshacer-documento/route.ts:27. Es una decisión de AUTORIZACIÓN sin fuente única: agregar/renombrar un rol (p. ej. dar emisión a 'viewer' o crear 'operador') exige tocar 11+ archivos y basta olvidar uno para dejar un endpoint con permisos distintos al resto.  
  *Fix:* Exportar ROLES_EMISION (y un type Rol = "owner" | "admin" | "contador" | "viewer") desde src/lib/api/account-guard.ts o un lib/auth/roles.ts y reemplazar las 11 copias por el import; empresa/actions.ts (ROLES_INVITABLES/ROLES_GESTION_MIEMBROS) puede vivir en el mismo módulo.

- **Fechas 'hoy' en UTC pelado (toISOString) en el parser de fechas IA y en el fallback de emitir-lote, saltándose chileDateString** — `src/lib/ai/fecha.ts:17`  
  La regla del equipo es explícita (Vercel corre en UTC; usar chile-date.ts), y existe la fuente única chileDateString() — pero parseFecha usa como fallback new Date().toISOString().slice(0,10) (lib/ai/fecha.ts:16-18, se aplica cuando el comprobante no trae fecha parseable) y emitir-lote hace lo mismo para fechaMovimiento (route.ts:238: (mov?.fecha ?? new Date().toISOString()).slice(0,10)), mientras dos líneas más arriba la fecha_emision sí usa chileDateString() (route.ts:195). Entre las 20/21:00 y medianoche de Chile ambos producen la fecha de MAÑANA: movimientos con día corrido (rompe la agrupación por día chileno del calendario) y una fecha de movimiento distinta de la de emisión dentro del mismo request.  
  *Fix:* Reemplazar ambos por chileDateString() de src/lib/chile-date.ts (import directo); de paso, grep por toISOString().slice(0, 10) como guard en CI para que no reaparezca.


### UX de flujos


- **La cola de Emitir está filtrada por el período del calendario y el estado vacío no lo dice** — `src/app/(app)/escritorio/v5/EmitirTabContent.tsx:95`  
  getPendientesEmision se llama con el rango del calendario (mesa-data.ts:223-225, {start: workStart, end: workEnd}) y la vista por defecto al entrar a /massdte es 'día' = hoy. Boletas aprobadas ayer y no emitidas desaparecen del tab Emitir al día siguiente: el estado vacío dice "Nada listo para emitir · Cuando una propuesta quede lista, aparecerá aquí", sin mencionar el filtro de período ni ofrecer ampliar la vista. Combinado con el hallazgo #1 (el usuario cree que Aprobar emitió), boletas aprobadas quedan varadas invisibles indefinidamente.  
  *Fix:* En el vacío de Emitir consultar (o traer en totales) las aprobadas fuera del rango y mostrar "Tienes N listas en otros días — Ver el mes →" (navigate view=month); como mínimo, aclarar "en este período" en el copy.

- **Fallo grave de SimpleAPI ("aceptado sin guardar") se muestra en tarjeta verde de éxito** — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:1495`  
  La tarjeta de resultado usa siempre colores de éxito (fondo/borde/texto verde) aunque lastResult.ok sea false: el estado "Aceptado sin guardar" (el SII aceptó el DTE pero la app NO lo persistió — el peor escenario intermedio) se lee como éxito. El riesgo concreto: el usuario reinterpreta la señal, vuelve a emitir el mismo DTE y termina con doble boleta real, o al revés, cierra creyendo que todo quedó guardado. Además muestra "Track {id}" (jerga del proveedor) sin explicación.  
  *Fix:* Condicionar el estilo por lastResult.ok (ámbar/rojo cuando no persistió) y en ese estado priorizar la acción de recuperación con advertencia explícita "NO vuelvas a emitirla — recupérala".

- **Toasts con códigos crudos al emitir lote (EMPRESA_SIN_CUENTA, QUERY_FAILED + error Postgres)** — `src/app/api/intermediaria/emitir-lote/route.ts:127`  
  Varios returns de error del endpoint de lote no traen 'detalle' humano: acceso.codigo (EMPRESA_SIN_CUENTA/EMPRESA_INACTIVA/USUARIO_SIN_CUENTA/CUENTA_INACTIVA), EMPRESA_SIN_DATOS_FISCALES, y QUERY_FAILED con pErr.message (mensaje técnico de Postgres en inglés). El cliente hace toast(json.detalle ?? json.error) (EmitirTabContent.tsx:250), así que el usuario ve el código pelado como mensaje justo después de confirmar una emisión. EMPRESA_SIN_CUENTA es un estado que la propia app trata como normal ("Sin plan" en FacturacionUsoPanel), no un error técnico.  
  *Fix:* Añadir detalle humano con próxima acción a cada return (p. ej. "Tu cuenta no está activa — revisa Facturación y uso en Empresa") o extender errorAmable() del cliente para mapear estos códigos; nunca pasar pErr.message al usuario.

- **Extensión SII faltante: el CTA principal muere en un toast sin ruta de instalación** — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:1412`  
  Con proveedor sii_local y la extensión no instalada (computador nuevo, Chrome reinstalado), el botón principal "Emitir en SII" termina en toast "No pude encontrar la extensión local SII" (línea 1142) y un aviso "No encuentro la extensión local. Recárgala en Chrome y vuelve a intentar" que asume que ya está instalada. El botón "Instalar extensión" existe pero vive en otra superficie (Empresa → Emisión, EmissionProviderConfig.tsx:346) y nada en el punto de fallo lleva ahí. Para el flujo de emisión REAL — el corazón del producto — es un dead-end.  
  *Fix:* Al detectar extensionStatus==='missing' ofrecer el botón/enlace de instalación ahí mismo (o abrir Empresa → paso Emisión), distinguiendo "no instalada" de "instalada pero dormida — recárgala".

- **Revisar 1×1 exige tipear un Detalle obligatorio que el flujo bulk no pide** — `src/app/(app)/escritorio/v5/revisar-shared.tsx:340`  
  El gate puedeStagear de ExpandedDetail exige !!detalle.trim(): el usuario que abre una tx de baja confianza solo para corregir el monto queda bloqueado en "Poner listo" hasta escribir un detalle a mano — para CADA tx revisada. Contradice el diseño documentado en el propio archivo (líneas 313-317: detalle vacío → cae a glosa común o a la del banco) y es inconsistente con "Poner listas" en bulk, que stagea sin detalle. Para el usuario no contador que debe revisar las tx <80% una por una, es fricción pura que además pisa la precedencia de la glosa común.  
  *Fix:* Quitar !!detalle.trim() del gate (dejar que el vacío caiga al fallback de glosa como documenta el comentario) y marcar el campo como opcional con placeholder "Se usará la glosa de la cartola".


### Consistencia visual


- **Colores semafóricos hardcodeados con la paleta DARK (#f59e0b/#22c55e/#ef4444/#5b9cf6) en vez de los tokens: en tema claro pintan los tonos de dark sobre blanco** — `src/app/(app)/escritorio/v5/EmitirTabContent.tsx:343`  
  V5Root define pares claro/oscuro para el semáforo (light: --amber:#d97706, --green:#16a34a, --blue:#2563eb, --red:#dc2626; dark: #f59e0b/#22c55e/#5b9cf6/#ef4444 — V5Root.tsx:86-87), pero EmitirTabContent hardcodea los valores DARK como literales en ~10 lugares (líneas 97, 341, 343, 360, 388, 393, 407, 430, 437, 438) y BoletasMensualesView en 100 y 148. En tema claro, textos de 9-11px en #f59e0b sobre fondo blanco/rgba(245,158,11,.08) quedan a ~2.1:1 de contraste: los avisos 'Falta tipo', el badge '● PRUEBA / MODO PRUEBA' y los contadores 'con IVA / sin IVA' del flujo de emisión son casi ilegibles justo donde el usuario decide emitir.  
  *Fix:* Reemplazar los literales por var(--green)/var(--blue)/var(--amber)/var(--red) — exactamente como ya hace EmitirDirectaView.tsx:1534 y DocCardList.tsx:16 para los mismos conceptos.

- **El mismo concepto (tipo DTE 39/41) tiene código de color distinto según la vista: 39 es verde en emisión/visor pero naranja-accent en buscador y mensual** — `src/app/(app)/escritorio/v5/SearchHistoryView.tsx:64`  
  Cuatro archivos definen su propio mapa de color para tipo 39/41: BoletaVisor.tsx:33-34 y EmitirDirectaView.tsx:1534 usan 39=var(--green), 41=var(--blue); SearchHistoryView.tsx:64-65 usa 39=var(--accent) (naranja) y 41=#3B82F6 hardcodeado; BoletasMensualesView.tsx:20-21 usa 39=#E8553E y 41=#3B82F6. La misma boleta afecta es verde al emitirla y naranja al buscarla; además #3B82F6 es un azul distinto de var(--blue) (#2563eb claro / #5b9cf6 oscuro) e ignora el par claro/oscuro del token. Rompe el aprendizaje de color del usuario no-contador entre superficies hermanas.  
  *Fix:* Extraer un único TIPO_DTE_META compartido (un archivo en v5) con tokens var(--green)/var(--blue) y consumirlo desde las cuatro vistas, eliminando los #3B82F6/#E8553E locales.

- **Doble sistema de tokens en conflicto: V5Root redefine :root/.dark con nombres y valores que pisan a globals.css (--border, --accent-light) y las superficies compartidas usan un tercer valor** — `src/app/(app)/escritorio/v5/V5Root.tsx:86`  
  globals.css define el sistema oficial (--background:#EDE9E1, --card, --muted, --border:#E2DCD1...) y V5Root inyecta por <style> un segundo sistema global (:root --bg/--surface/--text/--text2/--text3...) que además REDEFINE --border (rgba(0,0,0,.08) vs #E2DCD1) y --accent-light con valores distintos, y pisa el background del body. Componentes compartidos montados dentro del v5 usan un tercer valor de superficie: Toast.tsx:41 y HintSelector.tsx:124 pintan popovers con `dark:bg-[#1c1c1e]`, que no es ni --surface (#16181d) ni --surface2 (#1a1c24) — en dark los toasts/popovers no calzan con ninguna superficie hermana del v5. Y FieldMapper (compartido) consume var(--text2)/var(--surface) que solo existen mientras V5Root está montado.  
  *Fix:* Consolidar en un solo sistema: mover la paleta v5 a globals.css (o renombrar para no colisionar con --border/--accent-light) y alinear las superficies de Toast/HintSelector a var(--surface) para que popovers y paneles hermanos compartan el mismo dark.

- **Card 'Actividad' del dashboard con accent #A9B2C0 hardcodeado (paleta dark): contador e ícono casi invisibles en tema claro** — `src/app/(app)/escritorio/v5/RegistrosToggleCard.tsx:54`  
  En el toggle Ventas/Actividad del dashboard, 'ventas' usa var(--accent) (token con par claro/oscuro) pero 'actividad' hardcodea #A9B2C0 — un gris-azul pensado para fondo oscuro. En tema claro, el contador de eventos (fontSize 14, fontWeight 700) y el ícono se pintan #A9B2C0 sobre rgba(169,178,192,.16) encima de var(--surface) blanco: contraste ~1.9:1, prácticamente invisible. Es asimétrico dentro del mismo componente: una mitad tokenizada, la otra de un solo tema.  
  *Fix:* Usar var(--text3) (que ya tiene par claro #8b8275 / oscuro #697080) o agregar un token dedicado con ambos temas, en lugar del literal #A9B2C0.


### Accesibilidad y usabilidad operable


- **EmpresaPopup: aria-modal sin focus trap ni inert — Tab se escapa a la app tapada y el foco muere al cerrar** — `src/app/(app)/escritorio/v5/V5Root.tsx:107`  
  V5Root deja el dashboard completo montado como hermano del popup sin inert/aria-hidden. EmpresaPopup declara role="dialog" aria-modal="true" (EmpresaPopup.tsx:625-627) pero no atrapa el foco: al tabear desde el último control, el foco pasa a los controles del dashboard que están debajo del overlay (invisibles pero operables). Al cerrar, el popup se desmonta y el foco cae a <body> en vez de volver al botón que lo abrió. aria-modal=true además hace que el lector de pantalla 'pierda' el fondo mientras el foco real sí está ahí.  
  *Fix:* Poner inert al contenedor del dashboard mientras empresaOpen (o usar <dialog>.showModal()), y en onClose devolver el foco al botón disparador guardando document.activeElement al abrir.

- **Foco invisible: outline:none sin reemplazo en los inputs de los editores** — `src/app/(app)/escritorio/v5/revisar-shared.tsx:382`  
  El estilo compartido `inp` del editor inline (Detalle, Monto, RUT, nombre, dirección, comuna, selects) elimina el outline sin ofrecer ningún estilo :focus-visible alternativo. Mismo patrón en EditorAmpliado.tsx:155 y 215, EmitirDirectaView.tsx:1368 y 1617, GlosaComunControl.tsx:92, LeftQuickActions.tsx:464 y sections/BoletasMensualesView.tsx:81. globals.css no define ningún estilo de foco global (grep sin matches). Un usuario de teclado no sabe en qué campo está mientras corrige una boleta. EmisorForm sí lo hace bien (.ef-input:focus-visible, EmisorForm.tsx:186).  
  *Fix:* Extraer el patrón de EmisorForm (clase con :focus-visible que pinta borde accent + ring de 3px) a una clase compartida y aplicarla a todos los inputs que hoy llevan outline:none inline.

- **Botones solo-ícono sin nombre accesible: ✓ ✎ ✕ del flujo Revisar y otros** — `src/app/(app)/escritorio/v5/revisar-shared.tsx:202`  
  RowActionBtn (usado en cada fila de CartolaEditor y ConfianzaGroupSection) renderiza botones cuyo único contenido es el carácter ✓/✎/✕, sin aria-label ni title: el lector de pantalla anuncia el glifo o nada. Ídem los ✎/✕ de la cola de subida (DropzoneUpload.tsx:164-171) y el botón de edificio del header que abre el wizard de empresa (LeftQuickActions.tsx:484, único ha-btn sin aria-label). Agrava el caso del ✕: el ghost .ce-reject/.rs-reject queda a opacity .28 y solo se revela con :hover (CartolaEditor.tsx:45-46, revisar-shared.tsx:104-105), así que con foco de teclado el botón destructivo es casi invisible.  
  *Fix:* Añadir prop label a RowActionBtn y pasarla como aria-label ('Poner lista', 'Editar', 'Rechazar'); sumar :focus-within a la regla del ghost (.ce-row:focus-within .ce-reject{opacity:1}) y aria-label="Empresa" al botón del header.

- **Cerrar un borrador de DTE es un <span onClick> anidado dentro de un <button>** — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:1242`  
  En las pestañas de borradores de Emisión Directa, el ✕ de 'Cerrar boleta pendiente' es un span con onClick y aria-label dentro del <button> de la pestaña: HTML interactivo anidado (inválido), no focusable y sin manejo de tecla — un usuario de teclado puede cambiar de borrador pero jamás cerrarlo/descartarlo. El aria-label sobre un span no interactivo tampoco lo expone como control.  
  *Fix:* Sacar el cierre fuera del botón (botón hermano superpuesto con position:absolute) o, mínimo, cerrar el borrador activo con tecla Supr/Backspace sobre la pestaña enfocada.

- **Acordeones de secciones y filas expandibles del editor de cartola son <div onClick> sin teclado ni aria-expanded** — `src/app/(app)/escritorio/v5/CartolaEditor.tsx:289`  
  El header de sección (Pendientes/Listas/Rechazadas) del CartolaEditor nuevo es un div con onClick sin role/tabIndex/aria-expanded: no se puede colapsar/expandir por teclado ni se anuncia su estado. Igual el header por confianza (revisar-shared.tsx:110, div.cg-h) y las filas de tx (CartolaEditor.tsx:320 y revisar-shared.tsx:150) — estas últimas mitigadas a medias porque el ✎ es un botón real que también expande, pero sin nombre accesible (hallazgo aparte).  
  *Fix:* Convertir el header en <button> full-width con aria-expanded={open} (el botón bulk interno ya hace stopPropagation, sigue funcionando); replicar en cg-h.

- **Colores semánticos de la paleta oscura hardcodeados: badges y avisos ilegibles en tema claro** — `src/app/(app)/escritorio/v5/EmitirTabContent.tsx:341`  
  V5Root define la paleta clara con --amber:#d97706, --green:#16a34a, --blue:#2563eb (V5Root.tsx:86), pero EmitirTabContent usa los literales de la paleta oscura: '#f59e0b' (badge 'Falta tipo' línea 341, aviso de otros tipos línea 97, barra de lock líneas 360-361), '#22c55e' y '#5b9cf6' (badges Afecta/Exenta línea 343, folios del recibo línea 393, chips del pre-vuelo 437-438). Sobre el fondo claro #f5f0eb dan ~2.1-2.3:1 en textos de 9-11px — ilegibles y muy por debajo de AA (4.5:1). En dark están bien; el bug es solo del tema claro.  
  *Fix:* Reemplazar los literales #f59e0b/#22c55e/#5b9cf6 por var(--amber)/var(--green)/var(--blue), que ya traen las variantes AA por tema.

- **--text3 no cumple contraste AA en NINGUNO de los dos temas y se usa como label de formulario** — `src/app/(app)/escritorio/v5/V5Root.tsx:86`  
  --text3 es #8b8275 sobre --bg #f5f0eb en claro (~3.3:1) y #697080 sobre #0f1014 en oscuro (~3.8:1): ambos bajo 4.5:1 para texto normal, y se usa en textos de 9-11px que no califican como 'large text'. No es solo decorativo: es el color de los labels del editor inline (revisar-shared.tsx:381 'Detalle/Tipo/Monto/Comprador'), de hints del wizard (EmisorForm.tsx:631) y de microcopy legal/tributario (EmitirTabContent.tsx:446).  
  *Fix:* Oscurecer/aclarar --text3 hasta ≥4.5:1 sobre --bg y --surface en ambos temas (p. ej. #6e675c claro / #8a91a0 oscuro), o reservar --text3 solo para decorativo y subir labels/hints a --text2 (que sí pasa).

- **Animaciones infinitas (sparkles, flechas de tabs, sonar, view transition) sin prefers-reduced-motion** — `src/app/(app)/escritorio/v5/LeftQuickActions.tsx:47`  
  Solo CalendarStrip.tsx:87 y VeredictoCartola.tsx:22 respetan prefers-reduced-motion; globals.css no tiene guard global (grep sin matches). Quedan corriendo siempre, incluso en reposo: el conic-gradient giratorio de los sparkle buttons (.spark opacity .4 en reposo, animation rotate infinite, LeftQuickActions.tsx:47-48 y .mass-spark 173-174), la onda de las flechas de tabs (tabArrowWaveFade infinite, TabsV5.tsx:69-101), los sonares de los empty states (Mesa.tsx:19-26, revisar-shared.tsx:61-65) y la view transition circle-expand del cambio de tema (V5Root.tsx:90-91). Para usuarios con sensibilidad vestibular es movimiento permanente sin forma de apagarlo (WCAG 2.3.3 / 2.2.2).  
  *Fix:* Añadir en globals.css un bloque @media (prefers-reduced-motion: reduce){ .spark,.mass-spark,.tab-flow-active span,[style*="Sonar"]... {animation:none} ::view-transition-new(root){animation:none} } o replicar el guard que ya existe en CalendarStrip en cada componente.


### Rendimiento


- **Fan-out de realtime: 3 DocCardList + EmitirTabContent disparan hasta 4 recargas completas de la mesa por un solo cambio** — `src/app/(app)/escritorio/v5/DocCardList.tsx:150`  
  MesaTab monta 3 instancias de DocCardList (paneles Telegram/massDTE/boleta, MesaTab.tsx:305-307). Cada una crea su propio canal postgres_changes sobre documentos_subidos con el MISMO filtro y su propio debounce de 700ms. Un solo INSERT/UPDATE de documento dispara 3 callbacks → 3 llamadas casi simultáneas a cargarMesa, que ejecuta las ~12 queries del bundle completo + getPendientesEmision cada una (~36+ queries por evento). EmitirTabContent suma un 4º canal con event:'*' sobre propuestas_ia (EmitirTabContent.tsx:148-156): durante el procesamiento IA de una cartola grande (ráfaga de inserts de propuestas) se encadenan recargas completas repetidas. Además hay un poll de 5s por instancia mientras haya docs 'procesando' (línea 165).  
  *Fix:* Subir la suscripción realtime a UN solo lugar (MesaController, donde ya vive reloadMesa) y que los DocCardList sean consumidores pasivos; un único debounce global coalesce documentos_subidos + propuestas_ia.

- **Poll incondicional de /api/emision/jobs cada 5s para todos los usuarios, incluso con proveedor mock** — `src/app/(app)/escritorio/v5/useEmissionLockStatus.ts:84`  
  EmissionLockProvider se monta en V5Root (V5Root.tsx:84) con enabled=true por defecto: cada pestaña abierta del escritorio golpea GET /api/emision/jobs cada 5 segundos, para siempre, aunque el proveedor de emisión sea mock y no haya ningún job corriendo. El endpoint no es barato: hace auth (requireAccountApiAccess), query de plan (planes_config) y query de locks por llamada. En Vercel son ~17.000 invocaciones/día por pestaña abierta — puro costo de función + DB sin valor para el 100% de usuarios que no está emitiendo en paralelo.  
  *Fix:* Pasar enabled solo cuando el proveedor es real (page.tsx ya calcula boletasProveedor) o cuando hay un job activo; además pausar el intervalo con document.hidden y subir el intervalo base (p. ej. 15-30s cuando no hay job propio).

- **DashboardHelpHarness fuerza layout + re-render cada 300ms durante toda la sesión (ON por defecto)** — `src/app/(app)/escritorio/v5/V5Root.tsx:212`  
  La ayuda de pasos está activa por defecto para todos los usuarios. Su harness corre setInterval(positionMarkers, 300) sin fin: cada tick llama getBoundingClientRect sobre ~5 elementos (forced layout) y hace setMarkers con un array NUEVO cada vez (identidad distinta aunque nada se movió) → re-render garantizado del overlay 3,3 veces por segundo, para siempre. Encima registra un listener global de mousemove (líneas 227-241) que hace hit-testing y setState en cada pixel de movimiento del mouse. Es un impuesto permanente de CPU/batería sobre un dashboard que ya tiene realtime + polls.  
  *Fix:* Eliminar el intervalo: reposicionar solo en resize/scroll (ya escuchados) + un ResizeObserver sobre los targets; en setMarkers comparar con el estado previo y no setear si las posiciones no cambiaron. El hit-test de mousemove puede vivir en los propios targets (ya tienen mouseenter/leave en líneas 196-201, el listener global es redundante).

- **Historial de búsqueda serializa 300 filas COMPLETAS (select * anidado) en el payload inicial de cada carga** — `src/app/(app)/escritorio/v5/page.tsx:126`  
  En cada render de la página se consultan 100 docs + 100 boletas + 100 propuestas — estas últimas con select('*',movimientos_raw(*),documentos_subidos(...)) — y searchData() mete la fila COMPLETA en el campo data de cada SearchItem (líneas 139/148/156). Todo viaja en el RSC payload inicial aunque el usuario nunca abra la búsqueda. SearchHistoryView solo lee un puñado de campos (estado, monto_total, fechas, movimientos_raw.monto/fecha). Son cientos de KB de transferencia y parseo en cada carga del escritorio.  
  *Fix:* Proyectar solo las columnas que SearchHistoryView consume (id, estado, monto_total, fecha_emision, created_at, movimientos_raw(monto,fecha,descripcion)) y/o cargar el historial con un server action lazy la primera vez que se abre la vista de búsqueda.

- **RCV renderiza hasta 1.000 boletas sin virtualizar (y las embarca en el payload inicial)** — `src/app/(app)/escritorio/v5/sections/BoletasMensualesView.tsx:126`  
  page.tsx:112-120 trae hasta 1.000 boletas del mes en el render inicial (siempre, se abra o no el RCV) y BoletasMensualesView las renderiza todas con displayed.map: cada fila son ~10 nodos + 2 componentes con estado (PreviewBoletaButton/DescargarBoletaButton). Para un emisor masivo —el mercado objetivo— abrir el RCV crea ~10.000+ nodos DOM de golpe, y cada tecla del buscador (línea 30-44) re-filtra y re-renderiza la lista completa. Contrasta con CartolaEditor, que sí virtualiza.  
  *Fix:* Virtualizar la tabla con @tanstack/react-virtual (ya es dependencia y hay patrón en CartolaEditor) o paginar en bloques como ConfianzaGroupSection; idealmente mover la carga de las 1.000 filas fuera del render inicial (el wrapper ya sabe hacer fetch por mes).


---

## ⚪ BAJAS


**Seguridad de API y autorización:**

- sii-local/reconcile acepta filas ilimitadas del cliente e inserta boletas 'aceptado' una a una — `src/app/api/sii-local/reconcile/route.ts:56` · *Aplicar un tope por request (p.ej. 500 filas → 400 si excede) y usar insert batch; opcionalmente marcar el origen 'reconciliacion_rcv' de forma visible para revisión.*

- removeEmpresaLogo sin gate de rol: cualquier miembro (viewer) puede borrar el logo de la empresa — `src/app/(app)/empresa/actions.ts:188` · *Seleccionar también rol y aplicar el mismo check ROLES_GESTION_MIEMBROS que las otras actions de configuración de empresa.*

- Mensajes de error internos de Postgres/sistema expuestos en 'detalle' de respuestas 500 — `src/app/api/intermediaria/emitir-lote/route.ts:503` · *En respuestas 5xx devolver solo el código de error genérico y loguear el mensaje real en ops_events/console; reservar 'detalle' para mensajes redactados orientados al usuario.*


**Pipeline de emisión (plata / SII):**

- Fallbacks de fecha de negocio en día UTC, no día chileno (y divergentes entre cola y route) — `src/app/api/intermediaria/emitir-lote/route.ts:238` · *Usar chileDateString() como fallback de 'hoy' y chileDateString(new Date(created_at)) para derivar el día de un timestamptz, unificando el mismo fallback en route, cola y fecha.ts.*

- emitir-boleta (única) no aplica el gate R4: permite boleta afecta con IVA $0 — `src/app/api/intermediaria/emitir-boleta/route.ts:88` · *Mover el gate R4 dentro de validarBoleta (o a un helper compartido) para que los tres puntos —lote, única y motor de decisión— lo apliquen desde una sola fuente.*


**Integridad de datos (operaciones destructivas):**

- claimJobs: la serialización por empresa es check-then-act — dos kicks concurrentes procesan dos docs de la misma empresa en paralelo — `src/lib/document-processing/queue.ts:191` · *Mover el claim a una función SQL con advisory lock por empresa (o un update condicionado a NOT EXISTS de otro job running de la misma empresa), en vez del count separado en JS.*

- deshacer/eliminar borran ia_uso: se pierde el registro del costo IA real ya incurrido — `src/app/api/eliminar-documento/route.ts:143` · *No borrar ia_uso: dejar que el FK documento_id (ON DELETE SET NULL en schema_base:283) desvincule la fila conservando el costo, o marcarla con un flag en vez de eliminarla.*


**Calidad del código React:**

- setState anidado dentro de updaters de setDrafts (updaters impuros con generación de ids) — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:814` · *Computar el draft nuevo fuera del updater (sobre el valor actual de drafts) y hacer las tres llamadas setState al mismo nivel del handler; el updater solo debe devolver la lista nueva.*

- Acciones por fila (✓ poner listo / ✕ rechazar / restaurar) sin guard de busy: doble-click dispara la mutación dos veces — `src/app/(app)/escritorio/v5/CartolaEditor.tsx:177` · *Mantener un Set de ids en vuelo (o busy por fila) que haga early-return y deshabilite el RowActionBtn mientras la promesa está pendiente.*

- DashboardHelpHarness re-renderiza cada 300ms para siempre (setInterval que setea un array siempre nuevo) — `src/app/(app)/escritorio/v5/V5Root.tsx:212` · *Comparar el resultado con markersRef.current (shallow/JSON) y solo setear si cambió, o reemplazar el interval por ResizeObserver + scroll/resize listeners que ya existen.*

- Creación de cliente falla en silencio dentro de 'Poner listo': la propuesta se stagea sin cliente y sin aviso — `src/app/(app)/escritorio/v5/revisar-shared.tsx:348` · *En la rama de error hacer toast con el detalle y abortar (o preguntar si continuar sin cliente) antes de llamar ponerListo.*

- Chequeo de duplicados sin AbortController: respuestas fuera de orden pueden pintar candidatos obsoletos — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:426` · *Crear un AbortController en el efecto, pasarle signal al fetch y llamar controller.abort() en el cleanup (ignorando el AbortError en el catch).*


**Higiene y fuente única de verdad:**

- El union de proveedores de emisión (mock | sii_local | simpleapi) re-declarado en 6+ archivos, con normalizadores duplicados — `src/lib/intermediario/client.ts:139` · *Consolidar en un módulo (p. ej. src/lib/emission/providers.ts) los types ProveedorBoletas/ProveedorFacturas/ProveedorReal y un único parseProvider(), y que locks/jobs/authorizations/routes/UI importen de ahí.*

- Formateador de pesos CLP definido localmente 6 veces con null-handling divergente, más ~13 toLocaleString("es-CL") inline en v5 — `src/app/(app)/escritorio/v5/FacturacionUsoPanel.tsx:13` · *Crear src/lib/format-clp.ts con un único fmtClp(n, { emptyText }) (Math.round + es-CL) y migrar las 6 definiciones; los inline de v5 se pueden migrar oportunistamente al tocar cada archivo.*

- Dos types exportados llamados TipoDTE con formas distintas (39|41|61 vs 39|41|null) — `src/lib/sii/clasificador-tipo.ts:27` · *Renombrar el del clasificador a TipoDteBoleta | null (o TipoDteSugerido) y reutilizar DteAfecto/DteExento de validation.ts; reemplazar los 39 | 41 inline por el alias compartido.*

- Nombre del bucket de Storage "documentos" como literal en 18 llamadas repartidas en 13 archivos — `src/app/api/intermediaria/boleta/[id]/pdf/route.ts:51` · *Definir export const BUCKET_DOCUMENTOS = "documentos" (p. ej. en src/lib/storage.ts, que ya existe) e importarlo en las 18 llamadas; deja un único punto de corte para la migración a R2.*


**UX de flujos:**

- Archivos sobre 10MB: rechazo sin alternativa — `src/app/(app)/escritorio/v5/DropzoneUpload.tsx:45` · *Ampliar el mensaje con la salida: "Supera 10MB — exporta la cartola por mes o en CSV y vuelve a subirla".*

- Estados desconocidos del worker SII se muestran en snake_case crudo — `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:1408` · *Fallback humano genérico ("Trabajando en el SII…") en vez del código crudo cuando el status no está en el mapa.*


**Consistencia visual:**

- Backdrops y radios de modales hermanos con cuatro recetas distintas (incluido uno sin blur) — `src/app/(app)/escritorio/v5/LeftQuickActions.tsx:38` · *Extraer un overlay compartido (una receta: p.ej. rgba(0,0,0,.55) + blur(12px)) y dos radios canónicos (20 para popups grandes, 16 para confirmaciones), y usarlo en los seis modales.*

- Pills flotantes del sistema con tres fondos oscuros hardcodeados distintos, uno café-cálido fuera de la paleta fría — `src/app/(app)/escritorio/v5/V5Root.tsx:131` · *Definir un token único de pill flotante (p.ej. --pill-bg basado en --surface con alpha, o rgba(22,24,29,.86) fijo si la decisión es pill siempre oscura) y usarlo en las tres.*

- SavedPulse (z 95) queda detrás del wizard de empresa (z 100): 'Empresa guardada' se dispara con el popup abierto y nunca se ve — `src/app/(app)/escritorio/v5/V5Root.tsx:146` · *Subir SavedPulse a la capa de feedback (z ≥ 120) o suprimir el pulse cuando hay popup abierto (el toast ya cubre ese caso), evitando el doble feedback bottom-center.*

- Icono 'cerrar' con dos lenguajes (glifo de texto '×' vs SVG trazado) — incluso mezclados en el mismo archivo — y tres librerías de íconos conviviendo en v5 — `src/app/(app)/escritorio/v5/VisualizarArchivo.tsx:117` · *Crear un componente CloseButton único con el SVG (M18 6 6 18...) y reemplazar los '×' de texto; a mediano plazo estandarizar en una sola fuente de íconos (los SVG inline ya son la mayoría).*


**Accesibilidad y usabilidad operable:**

- Escape inconsistente: los popups de Subir cartolas y Emisión Directa no cierran con teclado — `src/app/(app)/escritorio/v5/LeftQuickActions.tsx:282` · *Añadir el mismo useEffect de keydown Escape que usa el pre-vuelo (EmitirDirectaView.tsx:457-462) a MassDTEAction y EmisionDirectaAction mientras open sea true.*


**Rendimiento:**

- Cache de rangos de la mesa sin tope: cada día/semana/mes visitado retiene el payload completo en memoria — `src/app/(app)/escritorio/v5/MesaController.tsx:51` · *Convertirlo en LRU con tope chico (p. ej. 8-10 entradas): al insertar, si supera el tope, borrar la entrada más antigua (Map ya itera en orden de inserción).*

- EmitirDirectaView (1.630 líneas) y EmpresaPopup (834) van estáticos en el bundle inicial pese a vivir tras un click — `src/app/(app)/escritorio/v5/LeftQuickActions.tsx:5` · *Cargar ambos popups con next/dynamic({ ssr: false }) (o React.lazy + Suspense) y opcionalmente prefetch en el hover del botón, como ya se hace con prefetchPreview en MesaTab.*

- Cada expansión de fila en Check dispara un server action para pedir el mismo umbral UF — `src/app/(app)/escritorio/v5/revisar-shared.tsx:284` · *Cachear la promesa a nivel de módulo en el cliente (const umbralPromise = obtenerUmbralReceptorClp() compartida, con TTL de sesión) o resolver el umbral una vez en mesa-data.ts y pasarlo por props — ya llega hasta getPendientesEmision de todos modos.*


---

## ✅ Fortalezas verificadas (lo que está BIEN — no tocar)


**Seguridad de API y autorización:**

- Guard central requireAccountApiAccess (sesión + vetado + rol + tenancy vía cuenta_usuarios/cuenta_empresas + plan) aplicado consistentemente en las rutas de emisión, boletas y derechos — sin IDOR en boleta/[id], pdf, rcv ni folios (todo escopeado por guard.empresaId).

- Las server actions de /revisar escopean CADA update/delete con .eq("empresa_id", ctx.empresaId), usan allowlist explícita de columnas (nunca spread del payload) y verifican count para no mentirle a la UI optimista.

- Webhooks y crons con autenticación propia sólida: MercadoPago valida x-signature con HMAC + timingSafeEqual y confirma el recurso server-to-server; Telegram exige el secret header; todos los crons exigen Bearer CRON_SECRET.

- requireEmisionJob liga job→usuario→cuenta→empresa (provider, expiración, estado) y los proxies SimpleAPI validan reserva de folio por job y sanitizan las respuestas upstream ([redacted] para pfx/caf/password/token) antes de devolverlas al cliente.

- Servido de archivos unificado en /api/archivo/[id] con autorización por RLS y resolución del álbum por índice (sin superficie de path traversal), y logos con bloqueo de SVG tanto en subida como en servido (anti-XSS almacenado).


**Pipeline de emisión (plata / SII):**

- Doble emisión bloqueada a nivel de DB, no solo en app: índice único parcial idx_boletas_propuesta_unica_vigente (propuesta vigente) + UNIQUE(empresa_id, tipo_dte, folio) en boletas_emitidas.

- Asignación de folios robusta a concurrencia: consume_next_folio con FOR UPDATE atómico, y folio_reservas con índice único parcial (estado <> 'liberado') + retry sobre 23505.

- Matemática de IVA correcta por construcción: descomponerBruto garantiza neto+iva=total en pesos enteros, con validaciones de montos enteros y tolerancia ±1 documentada; regla R4 codificada con referencia normativa (Art. 14 DL 825).

- Metering honesto: la cuota masiva se cuenta post-hoc desde boletas_emitidas (los fallos no queman cupo) y el mes calendario chileno resuelve el DST correctamente (chileMonthUtcRange prueba 03:00/04:00 UTC).

- Carril real sii-local con principio 'el folio es la prueba': registra la boleta aunque falle el PDF (nunca se pierde por un adjunto) y tiene reconciliación idempotente contra el Resumen de Ventas del SII con dedup por empresa+tipo+folio.


**Integridad de datos (operaciones destructivas):**

- Cola durable bien diseñada: idempotency key por documento, claim atómico condicionado por status, backoff exponencial y watchdog con el invariante STALE_RUNNING_MS > maxDuration documentado y testeado (state.test.ts).

- Lock de emisión por cuenta sólido: unique constraint (código 23505 → EMISION_BLOQUEADA) + release garantizado en finally — dos tabs no pueden emitir a la vez (locks.ts + emitir-lote).

- Guard tributario server-side replicado en deshacer Y eliminar (boletas emitidas → 409), sin confiar solo en que la UI oculte los botones.

- eliminar-documento borra el archivo físico ANTES que la fila DB con la razón documentada (evitar PII infindable) y purga audit_chunks/parser_logs en el mismo orden que la purga ARCO.

- El pipeline IA no pierde filas en silencio: fallbacks cuando Mistral omite índices, cap de confianza 0.75 para lo no-determinístico, y reconciliación de dedup >50% emitida a ops_events.


**Calidad del código React:**

- Higiene de efectos consistente: prácticamente todos los listeners, timers y canales realtime tienen cleanup correcto (DocCardList, TeamBusinessPanel presence, useEmissionLockStatus, CalendarStrip, RightColumnView) — no se encontró ningún leak.

- Uso correcto de patrones React modernos: useEffectEvent para los handlers de mensajes de la extensión, 'ajustar estado durante render' en vez de efectos en cascada (GaleriaComprobante, SearchHistoryView), y canales Supabase únicos por instancia vía useId.

- CartolaEditor virtualiza bien una lista plana con headers y un rangeExtractor que mantiene montadas las filas expandidas para no perder lo que el usuario está tipeando.

- Acciones destructivas protegidas con confirmación inline de dos pasos con auto-desarme (DocCardList, MesaTab, VeredictoCartola) y UI optimista con revert en GlosaComunControl.

- La arquitectura de refresh de la mesa (reloadMesa por contexto + cache por rango + broadcast a slots estáticos + modo silent para no parpadear) está bien pensada y excepcionalmente bien documentada inline con el porqué de cada decisión.


**Higiene y fuente única de verdad:**

- emision-decision.ts es un motor puro único de reglas de emisión, testeado sin I/O — el patrón fuente-única correcto ya está instalado en la parte más crítica

- chile-date.ts y display-date.ts centralizan el timezone de Chile con tests, y casi todo el código los usa (las excepciones son contadas)

- src/lib/sii/validation.ts concentra RUT módulo 11, cálculo de IVA y validación de boleta con suite de tests dedicada — es la fuente única natural para absorber los duplicados

- La auditoría de cuenta tiene un solo punto de escritura (recordCuentaAudit) con union tipado CuentaAuditAction: imposible inventar una acción con typo

- intermediario/client.ts normaliza la config de proveedor en un punto (normalizeBoletasProvider/Facturas), fiel a la arquitectura 'cambiar mock→real toca un archivo'


**UX de flujos:**

- Confirmación pre-vuelo SIEMPRE antes de emitir, con badge inequívoco EMISIÓN REAL vs MODO PRUEBA y advertencia "no se puede deshacer" (EmitirDirectaView.tsx:1527-1546)

- Errores de emisión por ítem traducidos a lenguaje humano con próxima acción concreta (errorAmable + nextActionLabel + "Resolver en Check →" en EmitirTabContent.tsx:61-112,330)

- Acciones destructivas con confirmación inline de dos pasos ("¿Seguro? Eliminar todo") en vez de window.confirm, con desarme automático a los 4s (DocCardList.tsx:186-195, MesaTab.tsx:171-193)

- Detección proactiva de posibles boletas duplicadas mientras se escribe la boleta única, con detalle comparativo en hover (EmitirDirectaView.tsx:409-437,1464-1486)

- Educación tributaria en el punto exacto de decisión: "la boleta documenta el ingreso; el impuesto se declara aparte (F22) sobre la ganancia" + TermHints de afecta/exenta y umbral 135 UF con UF viva (EmitirDirectaView.tsx:1389, EmitirTabContent.tsx:447)


**Consistencia visual:**

- El sistema de tokens del v5 (--surface/--text/--green/--amber...) se usa con disciplina en casi todas las superficies: DocCardList, FacturacionUsoPanel, BoletaVisor y EmitirDirectaView mapean estados a tokens con par claro/oscuro correcto.

- Los invariantes de diseño están documentados en el propio código (Toast.tsx explica el porqué del z-120; RegistrosToggleCard comenta por qué atenúa con color-mix(var(--bg)) y no negro fijo) — hay intención, solo desalineación posterior.

- Los modales de confirmación de emisión y el modal legal comparten deliberadamente el mismo lenguaje visual (panel 440px, radius 16, misma estructura de copy) entre EmitirTabContent y EmitirDirectaView.

- El tema claro tiene overrides .dark explícitos donde importa el vidrio (page.tsx: .left-glass / .dark .left-glass), no un dark-mode de brocha gorda.

- Los fallbacks de var() en los componentes de empresa (var(--text3, #697080)) hacen que el wizard degrade con gracia si se monta fuera de V5Root.


**Accesibilidad y usabilidad operable:**

- Toast global con role="status" y aria-live="polite" a z-120 sobre cualquier modal (Toast.tsx:37): el feedback de guardado/errores sí llega a lectores de pantalla en toda la app.

- EmpresaPopup hace bien la base de diálogo: role="dialog" + aria-modal + aria-labelledby, foco inicial al botón Cerrar y Escape con guardado awaitable que no cierra si la validación falla (EmpresaPopup.tsx:49, 67, 625-627).

- EmisorForm tiene el patrón de foco correcto para replicar: .ef-input:focus-visible con borde accent + ring de 3px, y validación on-blur con estado touched en vez de castigar por keystroke (EmisorForm.tsx:186, 42-45).

- GlosaComunControl usa role="switch" con aria-label descriptivo (GlosaComunControl.tsx:60-62), y los sparkle buttons activan todos sus estados con :is(:hover,:focus-visible) — paridad total mouse/teclado en los CTAs principales.

- El equipo ya conoce y aplica prefers-reduced-motion donde lo pensó (CalendarStrip.tsx:87, VeredictoCartola.tsx:22): extender la cobertura es copiar un patrón propio, no aprender uno nuevo.


**Rendimiento:**

- Las 11 consultas date-dependientes de la mesa corren en un solo Promise.all (mesa-data.ts:118) y page.tsx también paraleliza sus lotes: la latencia es la de la query más lenta, no la suma.

- CartolaEditor virtualiza con @tanstack/react-virtual y un rangeExtractor que mantiene montadas las filas expandidas — la lista más pesada del producto está bien resuelta.

- jspdf se carga con import() dinámico solo al descargar un PDF (boleta-pdf.ts:40) y XLSX vive únicamente en código server — cero librerías pesadas en el bundle client inicial.

- MesaController cachea los rangos visitados y los reusa al togglear el calendario sin re-fetch, con recargas 'silent' que evitan el parpadeo (MesaController.tsx:50-91).

- El valor UF se cachea 12h en memoria del server con fallback referencial (uf.ts): la API externa mindicador.cl no se golpea por request y jamás bloquea la emisión.
