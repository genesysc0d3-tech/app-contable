# Plan: bajar el costo de Vercel (y hacer la app más rápida mientras se emite)

Fecha: 2026-09-28 · Estado: **PLAN, sin código** · Autor: sesión Claude con el fundador

## 1. Por qué

- 2026-09-27: Vercel Hobby llegó a 4 h 12 min / 4 h de Fluid Active CPU → riesgo de pausa. El fundador
  pasó a **Pro** (US$20/mes con US$20 de crédito) con su tarjeta personal. Presupuesto de Spend
  Management = **US$1 con PAUSA ON** → si el uso pasa de US$21 en el ciclo, **producción se pausa**.
- Builds ya no cuestan: todos los proyectos → máquina **Standard** + On-Demand Concurrent Builds
  **Disabled** (Elastic se cobraba ~US$8–17/mes con 566 deploys/mes).
- Medición real, primeras ~6,5 h de Pro (día pesado: LC + MH emitieron ~740 boletas):

| Concepto | Uso | Costo |
|---|---|---|
| Fast Origin Transfer | 1 GB | US$0,16 |
| Fluid Provisioned Memory | 9,07 GB-h | US$0,12 |
| Fluid Active CPU | 44 min | US$0,10 |
| Fast Data Transfer (CDN) | 638 MB | US$0,06 |
| Edge requests, invocaciones, storage | — | US$0,07 |
| Build CPU | 2 h | US$0,00 |
| **Total** | | **US$0,51** |

  Día así × 30 ≈ US$57/mes → pasaría el tope y se pausaría. Hay una revisión programada
  (scheduled task `revisar-gasto-vercel-pro`, 2026-09-30 10:00) con el promedio real.

- Observability (12 h, app-contable) — top por transferencia:

| Ruta | Requests | Salida | Active CPU |
|---|---|---|---|
| **/api/mesa** | 5.8K | **400 MB** (~69 kB/resp) | **13 min** |
| /api/sii-local/result | 1.2K | 0,2 MB (entrada 62 MB: PDF base64) | 2 min |
| /massdte (SSR) | 2.3K | 28 MB | 2 min |
| /api/sii-local/page-map | 2.3K | 0,16 MB (entrada 27 MB) | 21 s |
| /api/boletas/rcv | 1K | 17 MB | 59 s |
| /api/emision/jobs | 3.1K | 0,8 MB | 4 min |

  Memoria promedio por invocación: **436 MB**. Todo el gasto es del proyecto app-contable.

## 2. Hallazgos (4 agentes de código + 1 de datos, solo lectura, 2026-09-27/28)

Evidencia archivo:línea tal como la reportaron; **re-verificar contra el código antes de tocar**.

### A. Mesa: recarga completa por boleta (≈70 % de la transferencia)
- `mesa-data.ts:137` `propuestas_ia.select("*,movimientos_raw(*,documentos_subidos(...))")`, límite
  1000 (`:131`), + cola completa de Emitir (`pendientes-emision.ts:237-262`, ~25 campos/ítem), 50 docs
  con `progreso_ia`, calendario, guardarraíl. ~1,5 KB/propuesta + ~0,9 KB/pendiente → cartola de 500
  en vista mes ≈ 1–1,3 MB JSON sin comprimir.
- Por boleta: Realtime en `MesaController.tsx:287-292` (INSERT `boletas_emitidas` + `documentos_subidos`,
  que `sii-local/result/route.ts:1248-1258` toca en cada boleta) → `reloadMesa` borra toda la caché
  (`:124-134`) → el precalentador (`:104-120`) 1,5 s después pide las otras 2 vistas (siempre incluye mes).
- `EmitirTabContent.tsx:333-339` tiene OTRO canal Realtime a `propuestas_ia`/`boletas_emitidas` que
  también llama `reloadMesa` → doble recarga con la pestaña Emitir abierta. `reloadMesa` no deduplica
  llamadas en vuelo.
- `DocCardList.tsx:160-165` tiene su propio canal a `documentos_subidos` → `ctxReload` (`:150`).
- `EmitirTabContent.tsx:278-286`: en cada cambio de `data` re-pide `ultimaMiradaCartola` por cada
  cartola expandida (server action POST).
- Cuenta: ~3–4 `/api/mesa` por boleta por pestaña (×2 con Emitir abierta).

### B. DocCardList sondea cada 5 s sin mirar visibilidad
- `DocCardList.tsx:171-176`: mientras haya un doc en `procesando`/`subido`, `setInterval(fetchDocsAuto,
  5000)` → `ctxReload` → `reloadMesa` (+ precalentador). Hay varios DocCardList montados en Check (uno
  por origen, comentario `:155-157`). Sigue con pestaña oculta. Si un doc queda pegado en `subido`, no
  para nunca (no verificado). ≈ 720 recargas/h/pestaña.
- Mismo patrón que el incidente del 25-sep (`useEmissionLockStatus`, fix #539: `emission-lock-cadencia.ts`).

### C. /api/mesa carga librerías que no usa (memoria 436 MB)
- `src/app/api/mesa/route.ts:2` importa `drain.ts`, que importa estático `queue.ts` (`drain.ts:3`) →
  `parsers` → `orchestrator.ts:1` (`import * as XLSX`), `storage` → `r2.ts:1-2` (`@aws-sdk/client-s3` +
  presigner), `ai/processor`, `ai/ocr`, `lectura`.
- Arreglo: `after(async () => (await import("@/lib/document-processing/drain")).autoDrenajeSiHayAtascados())`
  o separar `hayJobsAtascados` en un archivo liviano.
- Posible memoria configurada 2 GB (se cobra lo configurado, no lo usado). `vercel.json` sin bloque
  `functions` → manda el panel (Settings → Functions). **No verificado**: mirar el panel.

### D. Auto-drenaje en cada carga de mesa + bucle de kicks sin progreso
- `api/mesa/route.ts:22` `after(autoDrenajeSiHayAtascados)`. En `drain.ts:148-153` el freno de 2 min
  solo se arma cuando SÍ hay atascados → si no hay, cada `/api/mesa` hace 2 `count: exact` globales sobre
  `document_processing_jobs` (`drain.ts:135-138`). Arreglo: marcar `ultimoAutoKick = now` antes de consultar.
- Bucle: `claimJobs` salta empresas con un job corriendo (`queue.ts:250`) y mira solo `limit*4`
  candidatos; `msHastaProximoJobPendiente` (`queue.ts:731-746`) no filtra si el job es tomable → devuelve 0
  → `quedaTrabajo=true` → encadena kick sin progreso hasta `MAX_CHAIN_DEPTH=40` (`drain.ts:196-203`).
  Cada eslabón puede dormir hasta 210 s con `setTimeout` (`drain.ts:188-194`) dentro de
  `/document-processing/kick` y `/cron` (maxDuration 300) → memoria × tiempo sin CPU.
  Arreglo: en `drainAndChain`, si `claimed===0` y nada completó ni se recuperó → no encadenar; y que
  `msHastaProximoJobPendiente` excluya empresas con job `running`. Mejor: próximo kick por
  `next_run_at`/cron en vez de dormir dentro de la función.
- Quién llama `/kick`: solo `iniciarDrenaje` (`subir-procesar:254`, `procesar-documento:145`,
  `telegram:550/1649`), la propia cadena y el rescate de `/api/mesa`. La mini NO (verificado en src y
  `~/.massdte-tools`).

### E. Doble autenticación por request (proxy + guard)
- Matcher `src/proxy.ts:51` deja pasar `/api/mesa`, `/api/emision/jobs`, `/api/boletas/rcv` y prefetch RSC.
  `lib/supabase/proxy.ts:32` `getUser()` (ida de red a Supabase Auth) + `:55` select `usuarios.ultimo_acceso`;
  luego el guard repite (`account-guard.ts:44,56`, `actions.ts:183` getUsuarioActivo). ~4 idas redundantes.
- Arreglo barato: sacar `api/` del matcher (las rutas ya validan sesión e inactividad, comentario
  `account-guard.ts:48`). **OJO SEGURIDAD**: verificar ruta por ruta que TODA `/api/*` tenga su propio
  guard antes de sacarla (webhooks públicos, crons con secreto, rutas de la extensión). Alternativa:
  `supabase.auth.getClaims()` (verifica local si hay llaves JWT asimétricas — no verificado).

### F. RCV del mes entero por boleta (crece cuadrático)
- `api/boletas/rcv/route.ts:23-30` trae el mes (≤1000 filas ~250 B). Se re-pide por cada evento
  `massdte:emitted` (`RcvViewWrapper.tsx:34-46`, `MesaController.tsx:283`). ~365 llamadas × ~100 KB.
- Arreglo: agregar la fila nueva al estado local (el evento Realtime ya trae el INSERT) o refrescar con
  debounce al terminar el lote.

### G. SSR /massdte pesado
- `page.tsx:104-141`: mesa completa (`fetchMesaDateDependent`) + RCV del mes (1000) + 100 docs + 100
  boletas + 100 propuestas; viaja 2 veces (HTML + payload RSC). ~1,5–3 MB por carga.
- No hay `router.refresh` en el flujo del lote. Sí en `EmitirDirectaView.tsx:768/821/1092` (emisión
  individual), `EmpresaPopup.tsx:63` (al montar → re-render RSC completo al abrir el popup), `EmpresaBrand`.
- Arreglo: no mandar el RCV en el SSR (la isla lo pide sola); mesa inicial en vista día; quitar el
  `router.refresh()` de montaje del popup (refrescar solo al guardar).

### H. Rutas por boleta con muchas idas secuenciales (tiempo = memoria)
- `POST /api/emision/jobs` (`route.ts:161-539`): ~15 awaits secuenciales (support, guard con getUser +
  usuarios ×2 + `validarAccesoCuenta` 3 seq en `entitlements.ts:88-106` + `puedeEmitir`, plan, config,
  pausa, empresa, autorización, luego prop/yaBoleta/enRevision/enVuelo/devRow `350-410` uno por uno).
  Arreglo: `Promise.all` de los independientes.
- `POST /api/sii-local/result`: ~20 awaits; N+1 propuesta→movimiento→documento (`1240-1258`);
  `rememberResult` (1284), `recordCuentaAudit` (1292), `recordOpsEvent` bloquean → pasarlos a `after()`.
  Recibe el PDF en base64 en el body (`309-312`): a futuro, subir directo a Storage con URL firmada.
- `mesa-data.ts:249` `getPendientesEmision` (~7 awaits seq) y luego `computeGuardarailEmision`
  (`:288` → `guardarail-emision.ts:30`) lo vuelve a calcular sin rango → `Promise.all` o sacar el
  guardarraíl de las recargas silenciosas.

### I. Menores
- `page-map`: la extensión lo manda en cada escaneo (`background.js:937-942` → `app-bridge.js:111`) y en
  prod el server lo descarta (`page-map/route.ts:13-15,64-66`). Apagarlo en la extensión (requiere
  publicar versión → juntarlo con el fix de "se frena cada ~20 boletas").
- Archivos/PDF pasan bytes por la función (`/api/archivo/[id]:68-73`, `boleta/[id]/pdf:52-55`,
  `pdf-personalizada`, `empresa/logo`) → 302 a URL firmada. Secundario.
- `useTeamChat.ts:35-38`: `onFocus` también dispara al ocultar → chequear visibilidad dentro.
- `src/app/shell/page.tsx:29`: `setInterval(reload, 5000)` si hay conexión (riesgo de loop SSR si el SW
  sirve el shell en línea — no verificado).
- Descartado: crons (4, diarios), MFA del proxy (local), caché de versión extensión y UF, SWR/React Query
  (no existe), suscripciones Realtime filtran por `empresa_id` y se desuscriben bien.

## 3. Plan de PRs (cada uno: adversarial antes → test que falle sin el cambio → medir antes/después)

Regla: **no publicar mientras una clienta está emitiendo un lote** (consultar `emision_jobs` en
`running` y `boletas_emitidas` recientes antes de hacer ship).

1. **PR 1 — Refrescos del navegador (A, B, F, parte de G)** — el de mayor ahorro.
   - `reloadMesa` con guard "en vuelo → marcar sucio → repetir 1 vez" + debounce.
   - Durante un lote: parche local de la fila emitida (id + folio) y 1 recarga al cerrar el lote; no
     borrar caché ni precalentar tras recargas por evento; el precalentador nunca pide la vista mes salvo
     navegación explícita.
   - Quitar el canal Realtime duplicado de `EmitirTabContent` (MesaController ya lo cubre).
   - `DocCardList`: un solo intervalo compartido, pausa si `document.visibilityState !== "visible"`,
     backoff 5→10→30→60 s y tope ~10 min.
   - `ultimaMiradaCartola`: re-pedir solo si cambió `documento_id` o sus conteos.
   - RCV: agregar la fila del evento al estado local; refresco completo con debounce al final del lote.
   - `EmpresaPopup`: sin `router.refresh()` al montar.
   - Riesgo principal: UI desactualizada (una boleta emitida que no se refleja, una propuesta que vuelve a
     aparecer como emitible) → nunca debilitar el candado de emisión; la verdad sigue siendo el servidor.
2. **PR 2 — Memoria (C)**: import dinámico del drenaje en `/api/mesa` (y revisar otros imports pesados en
   rutas calientes); revisar/fijar memoria de funciones en el panel (1 GB) — decisión del fundador.
3. **PR 3 — Idas redundantes (E, H)**: sacar `api/` del matcher del proxy SOLO tras inventario de guards
   por ruta; `Promise.all` en `emision/jobs` y `mesa-data`; auditoría/ops de `sii-local/result` a `after()`.
4. **PR 4 — Drenaje (D)**: freno de 2 min antes de consultar; no encadenar sin progreso; no dormir dentro
   de la función.
5. Después (con la extensión): page-map off en prod; PDF directo a Storage; archivos por URL firmada.

Medición: Vercel → Usage (Fast Origin Transfer, Memory, CPU, Invocations) y Observability → Fast Data
Transfer "Routes" y Functions (12 h) antes/después de cada PR, con un lote de emisión comparable.

## 4. Pendientes relacionados del mismo día (no son de costo)

- **Cuadre de cartola** (memoria `project_cuadre_cartola.md`): paso 1 en prod (#599/#600). Falta paso 2
  (héroe del visor: "Abonos $X · Cargos $Y", "500 de 500 ✓" / "Faltan N por $X (filas…)") y paso 3
  (botón "Agregarlos"). **LC: 2 abonos perdidos** (fila 320 $80.000 09-09, fila 439 $170.000 09-04, doc
  6c04c989 BCI hasta 25-09) → recuperar cuando LC termine de emitir.
- **Emisión que se frena cada ~20 boletas** ("Me detuve… no pude confirmar el folio"): la extensión
  (`background.js:896-910`, acción `close` con `finalEmitClicked && !resultPersisted`) → "Cerraste tras
  emitir y la boleta aún no se confirma guardada". Hoy: LC 3/310, MH 10/431, 0 duplicadas. Falta averiguar
  quién manda `close` y por qué antes de persistir (¿timeout de la app?). Juntar con page-map off en una
  versión nueva de la extensión (Chrome Web Store).
- **Boletas "a medias" a confirmar en el SII**: LC 2 (propuestas 0083fdf4 $60.000 y 93ef6f7e $176.100;
  folios probables 24133/24139); MH 4 (saltos 45815, 45839, 45840 + 1 sin salto). LC folios 24172–24173
  usados fuera de massDTE (probable emisión manual en el portal). Pedir a Matías/LC confirmar en el SII.
- Tarea spawneada: rechazar fechas imposibles ("32/13/2026") en el lector.
- Vercel: pasar el pago a tarjeta de la SpA (BCI Nace) y reembolsar al fundador; 2FA en la cuenta Vercel.

## 5. Revisión adversarial del PR 1 (2026-09-28) — CAMBIA el PR 1

Veredicto: el PR 1 no crea riesgo de doble emisión (lo frena el servidor), pero el plan original tenía
detalles que no calzan con el código. **El PR 1 se parte en sub-PRs a–g, en este orden:**

- **a) PRIMERO, seguridad (hueco que YA existe):** `emision/jobs/route.ts:366-399` revisa yaBoleta /
  a medias / en vuelo con `{ data }` sin mirar `error` → si la consulta falla, el control se salta
  (falla ABIERTA). Arreglo: error de consulta → rechazar (5xx/409, no crear job). Además repetir la
  revisión "ya emitida" DESPUÉS de tomar el candado (`:448`). Mapear `PROPUESTA_YA_EMITIDA` (409) a
  "saltada: ya emitida" en `useEmisionLote.ts:188` en vez de "No se pudo iniciar" (hoy pausa el lote
  pidiendo decisión humana boleta por boleta cuando 2 personas emiten la misma empresa: "Marge y yo").
  Otras garantías existentes: lote sobre foto de la lista (`EmitirLoteModal.tsx:66-72,128,150`),
  reanudar pide ítems frescos (`EmitirTabContent.tsx:744-748`), índice único por propuesta
  (`sii-local/result/route.ts:562-566`).
- **b) `reloadMesa` con guard + secuencia; quitar canales duplicados.** Guard "en vuelo → sucio → repetir
  1 vez" leyendo el rango desde un ref al repetir; número de secuencia para descartar respuestas de un
  rango viejo (hoy ya pasa en `MesaController.tsx:126-143`); liberar el flag en `finally` (`cargarMesa`
  se traga errores, `:32-34`). Quitar el canal de `EmitirTabContent.tsx:331-340` Y el de cada
  `DocCardList.tsx:156-167` (MesaController ya escucha `documentos_subidos` en `:293`;
  `sii-local/result:1258` inserta uno por boleta → N recargas extra). Debounce de `massdte:emitted`
  (`MesaController.tsx:285-288`, hoy hace parpadear "Cargando RCV…").
- **c) Cadencia de DocCardList** (`:170-176`): un solo intervalo en MesaController, pausa con pestaña
  oculta, refresco inmediato en `visibilitychange`, backoff 5→10→30→60 s **SIN tope duro** (ese poll es
  hoy el rescate de la cola vía `/api/mesa` → `autoDrenajeSiHayAtascados`; cartolas de ~1000 s existen;
  la vigilancia post-subida termina a los 210 s, `:226`).
- **d) Durante un lote: throttle, NO parche local de la mesa.** El parche dejaría mintiendo
  `totales.listas_emitir`, `docProgress` (`mesa-data.ts:245`), guardarraíl (`:288`), ventas y a_medias.
  → Recargar la mesa máx. 1 vez cada ~15 s mientras dura el lote + 1 recarga final en TODOS los cierres
  (onDone, onClose `EmitirTabContent.tsx:1064`, requiere_revision, detenida, pausada_remota, pausa humana,
  candado liberado). "Lote en curso" = lote propio O candado visible (`lockedByOther`). Caché de otras
  vistas: marcarla vieja y refrescar al navegar (no servirla como buena).
- **e) RCV incremental:** parche local SOLO aquí: agregar la fila del evento, dedup por id, filtrar por mes
  de `fecha_emision`, orden (fecha, folio); refresco completo con debounce al final del lote.
- **f) `ultimaMiradaCartola`** (`EmitirTabContent.tsx:278-286`, server action en fila): refrescar al final
  del lote o con clave (docId, emitidas).
- **g) `EmpresaPopup:63` al final y aparte:** guardar emisor sí refresca (`EmisorForm.tsx:236`), pero
  verificar cada paso del wizard (proveedor, CAF, facturación) antes de quitar el refresh de montaje
  (antecedente #548/#553).

**Tests** (vitest sin jsdom → extraer funciones puras, como `emission-lock-cadencia.ts`, y verlas fallar):
`recargador` (3 en vuelo → 2 cargas; la 2ª con params recientes; descarta rango viejo; error libera
flag), `cadenciaDocs` (oculta → null; 5→10→30→60, sin null por tiempo), `mergeRcv` (dedup, mes, orden),
`throttleLote` (100 eventos/60 s → ≤5 + 1 final; final también en detener/revisión/pausa remota),
servidor `emision/jobs` con error en "ya emitida" → no crea job, test de fuente: sin `supabase.channel`
de propuestas_ia/boletas_emitidas/documentos_subidos en EmitirTabContent y DocCardList.

## 6. Revisión adversarial PR 2-4 (2026-09-28) — CAMBIA PR 2, 3 y 4

### BLOQUEANTE (seguridad): NO sacar `api/` del matcher del proxy
- El proxy hace más que pedir sesión: cierre por inactividad con `signOut` (`lib/supabase/proxy.ts:49-67`),
  **exige MFA aal2** (`:70-93`) y refresca cookies (`:17-25`). **Ningún guard de API revisa MFA** (`grep aal`:
  solo proxy y dev; `account-guard.ts` no). Sacar `api/` = sesión aal1 (solo contraseña) podría emitir,
  exportar (`derechos/exportar`) y borrar → choca con Ley 21.719.
- Inactividad solo en proxy y `requireAccountApiAccess` (`src/lib/api/account-guard.ts:51-68`).
  `getUsuarioActivo` (`escritorio/v5/actions.ts:170-198`, el de `/api/mesa`) NO revisa inactividad.
- Inventario (68 rutas): (a) guard completo sin MFA: boletas/rcv, derechos/*, emision/authorizations,
  emision/jobs GET/POST, extension/*, intermediaria/{boleta-duplicados, boleta/[id]/*, folios-disponibles,
  pendientes-emision}, simpleapi/ultimo-folio. (b) públicas legítimas: crons con CRON_SECRET, pagos/webhook,
  telegram/webhook, pagos/flow/inscripcion, mcp (Bearer), oauth/*, sw-config. (c) SIN protección propia
  (dependen 100 % del proxy): `sii-mock/dte/recibir`, `sii-mock/dte/estado/[trackId]`. (c') solo sesión
  (pierden inactividad y MFA sin proxy): /api/mesa, cancelar/deshacer/eliminar-documento, documentos-estado,
  empresa/*, generar-template, guardar-formato, intermediaria/{emitir-boleta, emitir-lote, factura-unica},
  mcp/estado, ocr-comprobante, pagos/checkout, parser/*, preview-formato, procesar-documento, subir-*,
  simpleapi/{dte/generar, result, consulta/*, envio/*, impresion}, sii-mock/{caf, rcv},
  emision/jobs DELETE/PATCH (`:595`, `:690`), document-processing/retry.
- **Hueco que YA existe** (tarea aparte, seguridad): rutas excluidas del matcher (`sii-local/*`, `archivo/`,
  `extension/vault-key`) corren sin MFA.
- **PR 3 nuevo:** en el proxy cambiar `getUser()` (ida de red) por `getClaims()` (existe en auth-js 2.101.1;
  JWKS publica llave ES256 — no verificado que los tokens vigentes la usen por `kid`), MFA vía `claims.aal`,
  y MANTENER el chequeo de `ultimo_acceso` en DB (getClaims no ve sesiones revocadas hasta que el JWT expira).
  Alternativa larga: un solo guard con sesión + inactividad + MFA, migrar (c)/(c') y recién ahí excluir.

### PR 2 (memoria) corregido
- `import()` dinámico dentro de `after()` NO ahorra: `after()` corre en casi toda `/api/mesa`. Arreglo real:
  `hayJobsAtascados` + `autoDrenajeSiHayAtascados` + `encadenarKick` a un archivo liviano (solo supabase-js y
  fetch); `drain`/`queue` dinámicos solo en el fallback inline de `iniciarDrenaje` (`drain.ts:110`).
- `/api/mesa` arrastra también `actions.ts` entero (1533 líneas, mercadopago, uf). `sii-local/result` usa
  `@/lib/r2` por boleta (`:288`, justificado). Medir: nº de archivos en
  `.next/server/app/api/mesa/route.js.nft.json` antes/después + memoria pico por ruta en Observability.

### PR 4 (drenaje) corregido
- "Cortar si completados+yields+recuperados = 0" **reabre el incidente del 2026-08-22**: un job fallido que
  queda `retryable` con backoff no cuenta como progreso → se mata la espera (`drain.ts:191-197`) y la cartola
  queda colgada hasta el cron diario (12:45 UTC) o hasta abrir la mesa.
- Condición segura: encadenar solo si `presupuestoAgotado || yields>0 || msHastaProximoJobPendiente` devuelve
  un job TOMABLE (excluir empresas con job `running`, `queue.ts:731-746`).
- Quitar el `setTimeout` SOLO con reemplazo: en Pro, `document-processing/cron` cada 1-2 min con consulta
  barata primero. Sin eso, no tocarlo. Freno de 2 min antes de consultar: seguro (retrasa rescate ≤2 min).

### PR 3 (Promise.all / after) corregido
- `emision/jobs :346-410`: lecturas paralelizables, PERO guard y rate limit (`:169-176`) antes,
  `acquireCuentaEmissionLock` (~`:448`) fuera y después, y mantener la precedencia de códigos de error.
- `sii-local/result :1240-1258` es cadena dependiente → un select con join, no Promise.all.
- **NO mover a after() los `rememberResult` de ramas de falla** (`:809, 851, 891, 985, 1192`): son el STASH
  que usa `recover_latest` (`:725-745`) para rescatar el folio. Solo el de la rama feliz (`:1284`).
  `recordCuentaAudit` dejarlo síncrono (evidencia de compliance). `releaseCuentaEmissionLock` (`:1308`) síncrono.

## 7. Orden FINAL de ejecución
1. PR 1a — seguridad emisión: falla cerrada en `emision/jobs` + 409 "ya emitida" sin pausar el lote.
2. PR 1b — `reloadMesa` guard+secuencia + quitar canales Realtime duplicados + debounce `massdte:emitted`.
3. PR 1c — cadencia DocCardList (visibilidad, backoff sin tope, un intervalo).
4. PR 1d — throttle de la mesa durante el lote + recarga final en todos los cierres + caché vieja marcada.
5. PR 1e — RCV incremental. 6. PR 1f — ultimaMiradaCartola. 7. PR 1g — EmpresaPopup (verificar wizard).
8. PR 2 — archivo liviano del auto-drenaje (+ revisar memoria del panel Functions: decisión del fundador).
9. PR 4 — drenaje: condición "job tomable" (+ cron frecuente antes de quitar el sleep).
10. PR 3 — proxy getClaims con MFA + Promise.all en emision/jobs + join en sii-local/result.
Aparte (seguridad): MFA en rutas excluidas del matcher (`sii-local/*`, `archivo/`, `extension/vault-key`) y
proteger `sii-mock/dte/*`.

## 8. Ejecución (2026-09-28) — rama local `fix/costo-vercel` desde `dev`, SIN push

Flujo: paso → test que falla sin el arreglo → commit local → agente revisor → corrección → siguiente.

| Paso | Commits | Qué quedó |
|---|---|---|
| 1 (PR 1a) | `cb3b1ee` + `aff2758` | Candado anti-doble-folio FALLA CERRADA (`lib/emission/propuesta-emitible.ts`); re-chequeo con candado = ya emitida + lápida; `ya_emitida` no pausa el lote; verificación de emisión incierta con boleta ya registrada → `emitida` con su folio. |
| 2 (PR 1b–1g) | `31bfe73` + `7440d23` | `mesa-frescura.ts`: recargador único (1 en vuelo, descarta rango viejo, tope 45 s), espaciador (debounce 500 ms, 15 s; 60 s solo con lote PROPIO), un solo canal Realtime, un solo sondeo de docs (5→10→30→60 s, pausa oculta), caché "vieja" en vez de borrar (sin precarga tras cada recarga), RCV incremental, juzgadas al terminar el lote, vigilancia post-subida revivida (deps estables). |
| 3 (PR 2) | `463ab6c` | `document-processing/auto-drenaje.ts` liviano. **Medido** (build Turbopack, chunks que `/api/mesa` carga al arrancar): **1.233 kB → 577 kB** (19 → 11 chunks; fuera cola, xlsx, IA, parsers, pdf-parse, S3). `nft` igual (el `import()` dinámico se despliega pero no se evalúa). |
| 4 (PR 4) | `332c762` + `4052f8d` | Sonda del próximo job solo TOMABLE (`proximo-job.ts`), `claimJobs` filtra empresas ocupadas en la consulta, freno de 2 min del auto-drenaje ANTES de consultar. |
| 5 (PR 3) | `bf3cb10` | Chequeos del candado en paralelo (precedencia intacta), join propuesta→movimiento→documento en `sii-local/result` (verificado contra datos reales), `rememberResult` feliz a `after()`. |

**Desvíos del plan (decididos, con motivo):**
- **1g EmpresaPopup NO se tocó**: el refresh solo corre al abrir el popup (poco frecuente); riesgo #548/#553 > ahorro.
- **getClaims DESCARTADO en el proxy**: el MFA necesita los factores verificados del usuario y solo GET /user (getUser) los trae. En cambio se cerró un **hueco de MFA que ya existía**: `getAuthenticatorAssuranceLevel()` sin token leía `session.user.factors` de la COOKIE (editable) → ahora factores del servidor + aal del token validado (`lib/auth/mfa-proxy.ts`).
- **Sleep dentro del eslabón y cron frecuente: NO** (el plan exige el cron antes de quitar el sleep; se dejó igual).
- **§5 d distinto:** durante el lote la mesa recarga cada 60 s con lote PROPIO (modal delante) y 15 s con lote de
  OTRA persona; sin recarga extra en la "pausa humana" (el modal está delante). La recarga final va por `onDone` y
  por el fin del evento `massdte:lote`.
- **Memoria del panel Functions (§7 punto 8):** no se tocó; queda para decisión del fundador.
- **Riesgo aceptado (revisión final):** con la pestaña OCULTA el sondeo de docs se pausa (paso 2) y la cadena ya no
  encadena por empresas ocupadas (paso 4). Si un eslabón muere con el job `running`, el rescate parte al volver a la
  pestaña (recarga si hay docs en proceso) o con el cron diario. La red de verdad es el cron frecuente (pendiente).
- **Menor pendiente:** la verificación de una emisión incierta atribuye al intento propio cualquier boleta ya
  registrada de la propuesta (solo alcanzable si otro resultado llega >15 min tarde). Arreglo futuro: confirmar el
  folio contra `sii_local_resultados.job_id`.

**Pendiente (fuera de esta rama):** MFA en rutas excluidas del matcher (`sii-local/*`, `archivo/`, `extension/vault-key`) + proteger `sii-mock/dte/*`; medir en Vercel antes/después con un lote comparable tras el deploy; no publicar mientras LC/MH emiten.
