# Implementation Summary

## Estado Actual

Se documento la estrategia para seguir con emision real de boletas sin construir aun un motor DTE certificado/CAL ni depender de proveedores con riesgo/licencia AGPL. Tambien se creo una primera extension local no publicada y se conecto la UI de Emision Directa para detectar la extension y abrir una ventana SII dedicada sin emitir.

## Decision Guardada

- Usar extension Chrome/Chromium no publicada como primer camino.
- La app web en Vercel prepara datos, propuestas y jobs.
- La extension local automatiza Portal SII/MiPyme desde el navegador del cliente.
- Las credenciales SII no se guardan ni se envian a nuestros servidores.
- El flujo `sii_local` debe emitir automaticamente despues de una sesion SII valida.
- Login, captcha, 2FA o seleccion de contribuyente siguen siendo manuales si SII los exige; no se deben saltar.
- Mantener proveedores activos acotados a `mock` y `sii_local`.
- Usar protocolo app-extension version `1` con handshake `PING/PONG` por `window.postMessage`.
- Modelar estados explicitos: `extension_missing`, `waiting_sii_login`, `filling`, `submitting`, `capturing_result`, `emitted`, `error`, entre otros.
- Persistir resultados reales con proveedor `sii_portal_extension` y metadata minima en `proveedor_respuesta`.
- Operar SII en una ventana popup dedicada `sii_portal_local_worker`, no en una pestana suelta del navegador.
- Permitir mouse/teclado solo cuando el humano debe intervenir: login, captcha/2FA o seleccion SII requerida.
- Bloquear interaccion accidental despues del login y durante navegacion/relleno/envio con overlay visible.
- Mantener historial propio en la app con folio capturado, PDF si existe y verificacion posterior contra consulta/historial SII.

## Razonamiento

BaseAPI valida publicamente el modelo de Portal MiPyme automatizado sin CAL ni migracion, pero no expone boletas 39/41 como producto publico. La oportunidad es automatizar solo boletas 39/41 desde el Portal SII del contribuyente y evitar dependencias de proveedor/licencia que compliquen el producto.

## Riesgos

- Cambios del DOM del SII pueden romper la extension.
- Captcha/2FA pueden requerir intervencion manual.
- La extension no publicada exige onboarding manual.
- Hay que cuidar terminos, consentimiento y no presentarlo como API oficial SII.
- El backend debe ser idempotente al recibir resultados para evitar duplicar boletas por reintentos de la extension.
- Chrome/OS no impide al 100% que el usuario cierre la ventana worker; debe tratarse como cancelacion o pausa recuperable.
- Si se captura folio pero no PDF, la app debe mostrar `PDF pendiente` y permitir verificacion/descarga posterior.

## Contrato Definido

- Handshake: `APP_CONTABLE_EXTENSION_PING` -> `APP_CONTABLE_EXTENSION_PONG` con `nonce`, `protocol_version` y `capabilities`.
- Job: `APP_CONTABLE_SII_BOLETA_JOB` con `job_id`, `expires_at`, `tipo_dte`, `fecha_emision`, receptor, detalles, totales, `auto_emit: true` y `confirmation_required: false`.
- Estado: `APP_CONTABLE_SII_JOB_STATUS` con `job_id`, `status`, `message` y `recoverable`.
- Resultado: `APP_CONTABLE_SII_JOB_RESULT` con `folio`, `tipo_dte`, `fecha_emision`, `estado`, `monto_total`, PDF/XML/HTML/enlaces opcionales y referencia SII opcional.
- Errores esperados: login requerido, empresa requerida, formulario/campo no encontrado, captcha/2FA, cancelacion, expiracion y rechazo SII.
- Ventana worker: `opening_sii` crea/enfoca popup dedicada; `waiting_sii_login` queda desbloqueado; `filling`, `submitting` y `capturing_result` quedan bloqueados.
- Historial: `emitida_capturada`, `emitida_confirmada`, `emitida_pendiente_pdf`, `verificacion_pendiente`, `error_verificacion` y `conflicto`.

## Implementacion Local Agregada

- La configuracion de empresa ahora presenta dos lineas activas: `Modo de prueba` y `SII local`.
- BaseAPI ya no aparece como proveedor activo en UI; valores legados `baseapi` se conservan solo para lectura historica de PDFs/boletas antiguas.
- Emision Directa usa SII local solo cuando la empresa selecciona `sii_local`; en ese modo no llama al endpoint backend de emision.
- `extensions/sii-portal-rpa/manifest.json`: extension Manifest V3 no publicada con permisos acotados a App Contable y dominios SII.
- `extensions/sii-portal-rpa/app-bridge.js`: puente entre `window.postMessage` de la app y `chrome.runtime.sendMessage`.
- `extensions/sii-portal-rpa/background.js`: responde `PING/PONG`, valida jobs, crea ventana popup SII y reporta estados iniciales.
- `extensions/sii-portal-rpa/sii-worker.js`: overlay en paginas SII con modo `HUMAN_REQUIRED`, bloqueo de interaccion en `LOCKED_AUTOMATION` y scanner DOM solo lectura.
- Los overlays `PAUSED` y `DONE` ahora tienen acciones locales: `Reintentar`, `Cancelar` y `Cerrar ventana`. Si ya se presiono `EMITIR`, `Reintentar` vuelve a capturar resultado sin reemitir; antes de emitir vuelve a escanear y permite otro intento de llenado. `Cancelar` cierra la ventana worker y reporta cancelacion; `Cerrar ventana` limpia el job cuando el flujo ya termino.
- `extensions/sii-portal-rpa/README.md`: instrucciones para cargar extension descomprimida.
- `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx`: tarjeta SII simplificada con una sola accion visible, `Continuar en SII`; la deteccion de extension ocurre internamente.

La implementacion actual ya intenta emitir automaticamente desde la extension local cuando detecta la calculadora e-Boleta. Prueba comunicacion app-extension, creacion de ventana worker, escaneo DOM interno de solo lectura, carga automatica del monto, click en `EMITIR` y captura inicial de resultado. El punto inicial del worker es `https://eboleta.sii.cl/emitir/`.

Para aprender el flujo real sin nuevos falsos positivos, la app ahora envia jobs `learn_only: true` y `auto_emit: false`. En este modo la extension abre SII, permite que el usuario inicie sesion/navegue y reporta mapas DOM sanitizados periodicos; no presiona `EMITIR`. La app tampoco marca una boleta como emitida si `APP_CONTABLE_SII_JOB_RESULT` no trae folio.

Tambien se agrego `scripts/sii-explorer.mjs` y el comando `npm run sii:explore`. Este explorador abre un Chrome persistente local con Playwright, espera login humano, recorre solo `https://eboleta.sii.cl`, bloquea acciones peligrosas por texto (`EMITIR`, `ENVIAR`, `CONFIRMAR`, `FIRMAR`, `PAGAR`, `ELIMINAR`, `ACTUALIZAR CLAVE`, etc.) y guarda `site-map.json`/`site-map.md` en `artifacts/sii-explorer/<run-id>/`. No recibe claves, no rellena inputs y redacta RUT/email/tokens en los mapas.

El camino automatico queda como objetivo siguiente: con los mapas aprendidos, el worker debe reconocer la calculadora/formulario, cargar el monto, presionar `EMITIR`, esperar la respuesta SII y capturar folio mas PDF/XML/HTML o respaldo equivalente.

Actualizacion posterior: se confirmo que hay dos acciones llamadas `EMITIR`. La primera vive en la calculadora y solo abre el modal `Emitir e-Boleta`; la segunda dentro del modal es la emision final real. La extension ahora ejecuta dos fases: carga monto, usa el `EMITIR` de calculadora, selecciona `Boleta afecta` o `Boleta exenta` segun `tipo_dte`, selecciona metodo de pago `Efectivo` por defecto y solo entonces usa el `EMITIR` final cuando el job trae `allow_final_emit: true`. Si no encuentra folio en la pantalla final, navega a `/reportes` para buscar folio/respaldo.

Actualizacion de seguridad: la captura de folio ahora clasifica evidencia con `folio_confidence`. Solo `high` permite enviar `APP_CONTABLE_SII_JOB_RESULT` como emitido. Un folio encontrado por texto libre en `/reportes` queda como `medium` y se reporta `result_needs_review`; esto evita falsos positivos como capturar numeros desde un RUT o desde texto no asociado a una columna `Nro Folio`.

Actualizacion de flujo: se revisaron los mapas locales posteriores a una prueba fallida y se encontro que `/reportes` mostraba `Cantidad Emitida 0` y `No hemos encontrado datos`. La causa era que el worker podia caer a `document` cuando no encontraba `.v-dialog.v-dialog--active`, volver a encontrar el `EMITIR` de la calculadora y tratarlo como si fuera el boton final del modal. Ahora el flujo exige detectar explicitamente el modal `Emitir e-Boleta`; si no aparece, aborta con error y no intenta capturar resultado.

Actualizacion de bloqueo: una prueba visual mostro que la calculadora quedaba en `$0`; el overlay `LOCKED_AUTOMATION` estaba bloqueando tambien los eventos sinteticos disparados por el worker. Se agrego una bandera interna para permitir clicks de automatizacion mientras los clicks humanos siguen bloqueados.

Actualizacion de persistencia: la app no cambiaba estado porque el flujo SII local solo enviaba un mensaje en memoria a la UI y no insertaba la boleta real en Supabase. Se agrego `POST /api/sii-local/result`, llamado desde `app-bridge.js` al recibir `APP_CONTABLE_SII_JOB_RESULT`. El endpoint exige auth, `folio_confidence: high`, folio/tipo/fecha/monto validos, deduplica por `empresa_id + tipo_dte + folio` y registra la boleta con `emision_proveedor = sii_local` y evidencia resumida en `proveedor_respuesta`.

Actualizacion de captura manual: para casos donde SII si emitio pero la app no guardo, el overlay `PAUSED` ahora incluye `Capturar folio`, accion segura que solo vuelve a capturar el resultado de la pantalla actual y nunca reemite. Tambien se agrego `GET /api/sii-local/result` como log local de intentos de persistencia para depurar si fallo la captura o el insert.

Actualizacion de diagnostico: cuando la captura no tiene folio fuerte, el background ahora manda `APP_CONTABLE_SII_CAPTURE_DEBUG` y el bridge lo registra en `/api/sii-local/result` sin marcar la boleta como emitida. Tambien se extendio la espera post-emision antes de ir a reportes para no perder pantallas finales lentas.

Actualizacion de folio real: en pantalla final e-Boleta, SII muestra el folio como `BOLETA EXENTA ELECTRONICA NUMERO: 42` o equivalente, no necesariamente como `Folio`. Se agrego este patron como evidencia fuerte de folio.

Actualizacion de recuperacion manual: si la pantalla final ya esta visible pero el content script activo corria con un parser anterior, la UI de Emision Directa muestra un campo `Folio visible` cuando el estado queda en `result_needs_review`. Ese fallback llama a `/api/sii-local/result` con evidencia `manual_visible_receipt` para persistir la boleta sin reemitir.

Actualizacion PDF SII: la pantalla final tiene botones `IMPRIMIR`, `DESCARGAR` y `COMPARTIR`; los `artifact_links` ya incluyen el PDF SII (`boleta41_folio43_2026-06-05.pdf`). El backend ahora extrae folio desde esa URL cuando el texto visible no lo trae, descarga el PDF y lo sube al bucket `documentos`, guardando `proveedor_respuesta.pdf.storage_path`. Los botones Ver/Descargar de Boletas usan `/api/intermediaria/boleta/[id]/pdf` para servir el PDF guardado en la app.

Actualizacion de recuperacion por log: si la pestaña SII pierde conexion porque se recargo la extension, el overlay ya no revienta en `chrome.runtime.sendMessage`; muestra una indicacion para volver a la app. La UI de Emision Directa agrega `Guardar PDF SII detectado`, que llama a `/api/sii-local/result` con `recover_latest: true` para persistir el ultimo resultado diagnosticado con link PDF, sin tocar nuevamente SII.

Actualizacion UI recuperacion: `Guardar ultimo PDF SII` queda visible siempre en modo SII local cuando hay monto, no solo cuando el estado local es `result_needs_review`, para recuperar boletas emitidas aunque el estado del worker se haya perdido.

Actualizacion captura automatica PDF: se confirmo que el worker si ve los botones finales `IMPRIMIR`, `DESCARGAR` y `COMPARTIR`, y que `artifact_links` trae el PDF SII con nombre `boleta41_folioXX_YYYY-MM-DD.pdf`. El bug era que el worker no usaba ese link como evidencia fuerte. Ahora `sii-worker.js` extrae el folio desde el link PDF, lo marca con `folio_confidence: high` y `folio_evidence.source = "sii_pdf_download_link"`, por lo que `background.js` puede enviar `APP_CONTABLE_SII_JOB_RESULT` y persistir automaticamente sin pasar por recuperacion manual.

Actualizacion links temporales: `POST /api/sii-local/result` descarga el PDF SII inmediatamente en el mismo request y lo sube al bucket `documentos`; la app no depende de reabrir despues el link temporal del SII. Si hay link PDF pero no se puede subir a Supabase, el endpoint falla con `PDF_UPLOAD_FAILED` y no inserta una boleta nueva sin respaldo. Si la boleta ya existe, el endpoint intenta adjuntar/actualizar el PDF guardado antes de responder `already_exists`.

Actualizacion P0 auditoria Claude: se cambio el criterio de exito para que el folio fuerte no baste. El worker espera a que exista un artefacto PDF antes de retornar exito; el background descarga el PDF desde la extension con la sesion local (`pdf_byte_capture`) y adjunta `result.pdf.base64` al resultado. `POST /api/sii-local/result` valida que el payload sea un PDF real, lo sube a Supabase Storage y solo entonces inserta/actualiza la boleta como `aceptado`. Si el PDF no queda guardado, el endpoint devuelve `PDF_UPLOAD_FAILED`/`PDF_REQUIRED` y la UI queda en revision, no en emitida. Tambien se agrego allowlist para fallback por URL (`eboleta.s3.amazonaws.com` o `*.sii.cl`) y auth/filtro por usuario en los GET debug de `result` y `page-map`.

Actualizacion auditoria app contable: se corrigieron blockers de proveedores. `obtenerConfigEmision` ahora cae a `mock` si prod aun no tiene columnas de proveedor, en vez de romper toda emision. `setEmisionConfig` devuelve un error accionable si falta la migracion/check de proveedores. `emitir-lote` revalida server-side el clasificador `no_boletar` para no depender solo de la UI. `pendientes-emision` deja de usar service role para leer boletas emitidas y respeta RLS. Se agrego migracion idempotente `20260606120000_emission_provider_guardrails.sql` para asegurar columnas/checks iniciales de proveedor aunque las migraciones previas de junio se apliquen fuera de orden.

Actualizacion MassDTE canonico: `/massdte` queda como dashboard activo y el home autenticado redirige ahi. Las rutas legacy `/escritorio`, `/escritorio/v2`, `/escritorio/v3`, `/escritorio/v4` y `/escritorio/v5` redirigen a `/massdte`, con bypass local `?legacy=1` solo en desarrollo. La UI normal oculta certificado SII y acciones tecnicas de recuperacion SII local quedan bajo un disclosure.

Actualizacion bloqueos emitibles: `pendientes-emision` ahora devuelve `motivo_code` (`no_boletar`, `monto_invalido`, `falta_receptor`) junto a `motivo_no_listo`. Las vistas Emitir muestran una accion concreta para desbloquear cada caso sin cambiar la regla tributaria ni emitir automaticamente items bloqueados.

Actualizacion separacion de carriles y limpieza: `scripts/limpiar-test.sql` ahora es dry-run por defecto y preserva `parser_adapters`, `parser_logs`, `clasificacion_reglas`, `boletas_caf_mock`, `usuarios` y `empresas`, borrando solo datos operativos de prueba dentro de una transaccion que termina en `ROLLBACK`. Las boletas `mock` se limpian por separado y boletas reales/legacy quedan fuera del borrado automatico. La emision mock se movio a `src/lib/emission/mock.ts`; los endpoints de emision directa/lote quedan como router de proveedor y bloquean explicitamente `sii_local` sin fallback al modo de prueba.

Actualizacion multiusuario fase 1: se agrego la migracion `empresa_invitaciones` y un panel de miembros/invitaciones en `/empresa`. El modelo sigue usando `usuarios.empresa_id` para no introducir selector multiempresa todavia; owners/admins pueden crear links de invitacion y `/invitar/[token]` permite aceptarlos con sesion activa.

Actualizacion endurecimiento carriles: se agrego modulo explicito `src/lib/emission/sii-local.ts`, dejando `provider-guards.ts` como router comun de bloqueos sin fallback. `database.types.ts` incluye `empresa_invitaciones`, por lo que `/empresa` ya no necesita castear Supabase a `any` para listar invitaciones. `limpiar-test.sql` ahora lista `storage_path` de documentos/PDFs mock y agrega un resumen por `tipo_operacion_hint` antes del borrado, para transformar aprendizajes utiles en reglas antes de aplicar `COMMIT`.

Actualizacion auditoria Opus: se ejecutaron dos auditorias Claude Opus reales sobre el diff. Se corrigio el P0 de RLS en `empresa_invitaciones`: ahora usuarios autenticados solo tienen `SELECT` column-level sin `token_hash`, y no hay policies de `INSERT/UPDATE/DELETE`; las escrituras quedan en server actions con service role y validacion de rol. Se agrego indice unico parcial para invitaciones pendientes por empresa/email. `aceptarInvitacionEmpresa` ya no usa upsert que limpiaba `vetado` ni pisa rol de usuarios existentes; rechaza usuarios vetados y solo inserta usuarios nuevos. `/invitar/[token]` ahora muestra errores de aceptacion. `limpiar-test.sql` conserva la cadena `boletas_emitidas` no-mock -> `propuestas_ia` -> `movimientos_raw` -> `documentos_subidos` -> `clientes`, evitando perder trazabilidad real/legacy al limpiar pruebas. Mientras `/escritorio/v5` exista como legacy, las actions de empresa revalidan tambien esa ruta ademas de `/massdte`.

Actualizacion limpieza Storage y hardening multiusuario: se agrego `scripts/limpiar-test-storage.mjs` y el comando `npm run limpiar:test:storage`; el script lista objetos candidatos del bucket `documentos` en dry-run y solo borra con `--commit`, usando exclusivamente variables de entorno existentes. Tambien se corrigio `/api/empresa/logo/[empresaId]` para rechazar IDs de empresa distintos a la empresa del usuario autenticado, cerrando fuga de logos entre tenants.

Actualizacion post-auditoria final: `scripts/limpiar-test-storage.mjs` replica el criterio de preservacion del SQL y ya no propone borrar documentos enlazados a boletas no-mock por cadena `boleta -> propuesta -> movimiento -> documento`, por `progreso_ia.boleta_id` ni por paths PDF guardados en `proveedor_respuesta`. El listado Storage del SQL usa el mismo filtro. Las invitaciones ahora preservan `next=/invitar/<token>` durante login/registro/OAuth y el callback evita mandar a onboarding a un usuario nuevo que viene desde una invitacion pendiente. `aceptarInvitacionEmpresa` exige email confirmado, `/empresa` lista miembros/invitaciones con service role desde server component, el link de invitacion queda visible/copiar-recuperable si falla clipboard, y `.gitignore` excluye perfiles SII/debug/Excel locales.

Actualizacion Supabase MCP: se configuro y autentico el MCP remoto de Supabase para el proyecto `aluuuyecwifaakehvcam`. La migracion de `empresa_invitaciones` se aplico en remoto via MCP y quedo registrada como `20260607043303_20260606123000_empresa_invitaciones`. Luego se aplico un follow-up registrado como `20260607043353_20260607044500_empresa_invitaciones_advisor_fixes`, que agrega indices para `invited_by`/`accepted_by` y optimiza la policy de lectura usando `(SELECT auth.uid())`. Los advisors ya no muestran warnings nuevos de FK sin indice ni `auth_rls_initplan` para `empresa_invitaciones`; quedan solo avisos historicos o indices nuevos aun sin uso. Regla operativa guardada en `AGENTS.md`: usar MCP como fallback para migraciones, advisors y dry-runs SQL cuando CLI/pooler o env vars locales bloqueen; Storage real sigue requiriendo `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` exportadas porque el MCP no expone service role ni borra objetos del bucket.

Actualizacion historial migraciones: se elimino la migracion local corta `20260602_empresa_emision_provider.sql` porque el CLI la mostraba desalineada incluso al reparar y su efecto ya esta cubierto por `20260606120000_emission_provider_guardrails.sql`.

Actualizacion QA MassDTE: se corrigieron los hallazgos de la pasada Opus sobre `/massdte`. `EmitirTabContent` ahora muestra error y boton de reintento cuando `pendientes-emision` responde `ok: false`. `/masssdte` redirige a `/massdte`. `emitir-boleta` tiene captura top-level de errores no controlados. `BottomNav` debouncea eventos realtime. `V5Root` envuelve cada tab en un error boundary y limpia codigo muerto del toggle local de tema. Se elimino el cliente de emision BaseAPI no usado de `src/lib/intermediario/client.ts`; se conservan solo datos legacy `baseapi` y helpers PDF para boletas antiguas.

Actualizacion prueba funcional Playwright: se capturo una sesion autenticada en `artifacts/playwright-auth/storage-state.json` y se probaron rutas/interacciones en Chromium headless contra `http://localhost:3002`. El smoke test confirmo `/`, `/massdte`, `/masssdte`, `/escritorio/v5` y `/escritorio/v5?legacy=1` sin `console.error` ni `pageerror`. La prueba funcional encontro que `V5Root` tenia estado/refs para 5 tabs pero no renderizaba la barra top-level, dejando solo Dashboard accesible. Se restauro la barra sticky `Dashboard/Subidos/Revisar/Emitir/Boletas`; Playwright confirmo click y contenido de las 5 tabs, popup Empresa con proveedores y popup Emision Directa sin errores de consola.

Actualizacion auditoria 2026-06-07: se corrigio un bug de recuperacion en `POST /api/sii-local/result`. `recover_latest` guarda logs con PDF base64 redactado; el endpoint intentaba decodificar ese marcador antes de usar el link PDF SII, lo que podia terminar en `PDF_INVALID`. Ahora el backend ignora base64 redactado, extrae PDF tambien desde `pdf.source_url` y cae al enlace SII permitido para descargar/subir el respaldo. Verificaciones ejecutadas: `rtk tsc --noEmit`, lint focalizado, `rtk npm run build`, `node --check` para scripts/extension, validacion strict de spec, migraciones Supabase alineadas y smoke Playwright no autenticado sin errores de consola. Luego se regenero `artifacts/playwright-auth/storage-state.json` con login manual y el smoke autenticado confirmo rutas `/`, `/massdte`, `/masssdte`, `/escritorio/v5`, `/escritorio/v5?legacy=1`, los 5 tabs, popup Empresa/proveedores y popup Emision Directa sin errores de consola ni `pageerror`.

Actualizacion UI MassDTE: se quito la barra superior duplicada `Dashboard/Subidos/Revisar/Emitir/Boletas` de `V5Root`, porque esa navegacion ya existe dentro de la mesa del dashboard (`Agregados/Revisar/Emitir/Boletas`). El shell ahora renderiza directamente el dashboard y mantiene el popup Empresa, ayudas y errores. Verificado con `rtk tsc --noEmit`, lint focalizado, `rtk npm run build` y smoke Playwright autenticado: no aparece el boton top-level `Dashboard`, las tabs internas funcionan, popup Empresa abre/cierra y Emision Directa abre sin errores de consola.

Actualizacion Folios CAF: el panel de Folios CAF ahora recibe el proveedor de emision. Si la empresa esta en `SII local`, oculta las metricas/listado de CAF mock y muestra una explicacion simple: en e-Boleta/MiPyme el SII asigna automaticamente el folio real al finalizar la emision, y App Contable solo guarda ese folio y el PDF oficial. En `Modo de prueba`, el panel aclara que los folios son simulados y no se informan al SII.

Actualizacion actividad MassDTE: las boletas del feed de actividad, agregados sinteticos y explorer usan `created_at` como fecha de registro cuando existe, manteniendo `fecha_emision` como fecha tributaria. Asi una boleta SII local recien persistida aparece en la mesa aunque su fecha tributaria pertenezca a otro dia.

Actualizacion corte LibreDTE: se elimino LibreDTE de la UI, tipos, guards backend y configuracion de empresa por riesgo/licencia AGPL. Los proveedores activos quedan en `mock` y `sii_local`; una migracion nueva normaliza empresas/boletas con `emision_proveedor = 'libredte'` a `mock` y mantiene `baseapi` solo como compatibilidad historica de boletas antiguas.

Actualizacion modo combinado: se agrego la fase de proveedores separados por tipo documental. `usuarios.dev_mode` habilita herramientas mock visibles para desarrollo; `boletas_emision_proveedor` controla boletas 39/41 (`mock`, `sii_local`, `simpleapi`) y `facturas_emision_proveedor` controla facturas 33/34 (`mock`, `simpleapi`). `/empresa`, el popup de Empresa en MassDTE, Folios CAF y Emision Directa ya consumen esta forma. El backend usa `providerForTipoDte` para seleccionar carril efectivo por `tipo_dte`; `simpleapi` queda bloqueado con `SIMPLEAPI_PENDIENTE` hasta implementar el proxy efimero. La migracion quedo aplicada en Supabase remoto como `20260608202426_combined_emission_dev_mode` y el archivo local fue renombrado para evitar drift. Verificado con `rtk tsc --noEmit`, lint focalizado, validacion strict de spec y `rtk npm run build`.

Actualizacion proxy SimpleAPI: se agrego `src/lib/emission/simpleapi.ts` y `POST /api/simpleapi/dte/generar`. El endpoint exige sesion, empresa activa, `multipart/form-data`, `input` JSON, `files` PFX y `files2` CAF; valida tamaño, detecta `TipoDTE`, confirma que la empresa tenga `simpleapi` habilitado para ese tipo documental y reenvia a `https://api.simpleapi.cl/api/v1/dte/generar` con `SIMPLEAPI_API_KEY` solo desde backend. No almacena PFX/CAF/password ni persiste resultados. Emision Directa/lote siguen bloqueados para `simpleapi` hasta conectar la boveda local de la extension.

Actualizacion hardening proxy SimpleAPI: la auditoria de la coleccion Postman confirmo auth tipo API key con header `Authorization` y valor directo. El helper ya no agrega `Bearer` por defecto; `SIMPLEAPI_AUTH_PREFIX` queda solo como override explicito. `POST /api/simpleapi/dte/generar` ahora limita por empresa a 3 solicitudes por segundo y 40 por minuto, responde `SIMPLEAPI_RATE_LIMITED` con `Retry-After` y sanitiza respuestas upstream para no ecoar PFX, CAF, certificado, password, tokens ni API keys. El endpoint sigue siendo generacion DTE, no flujo tributario completo de envio/consulta/PDF.

Actualizacion extension modular: `background.js` paso a service worker MV3 tipo `module` y ahora importa `modules/core.js`, `modules/sii-local.js` y `modules/simpleapi-vault.js`. El flujo SII conserva el worker visible `sii-worker.js`, pero las capacidades/validacion SII quedaron separadas del contrato SimpleAPI. La boveda SimpleAPI inicial expone solo `APP_CONTABLE_SIMPLEAPI_VAULT_STATUS` y devuelve metadata segura (`configured`, `encrypted`, `has_pfx`, `has_caf`, `updated_at`); todavia no guarda ni transmite PFX/CAF/password.

Actualizacion UI extension: se agrego `options.html`, `options.css` y `options.js` como panel App Contable Motor Local. El panel muestra estado global, modulo SII Local activo y modulo SimpleAPI con estado de boveda local. `manifest.json` declara `options_page` y el bridge/background aceptan `APP_CONTABLE_OPEN_EXTENSION_OPTIONS` para abrir esa pantalla desde la app. Esta fase no captura secretos reales; solo prepara la experiencia local y mantiene PFX/CAF/password fuera de React.

Actualizacion integracion Empresa: `EmissionProviderConfig` ahora hace handshake con la extension desde `/empresa`, muestra estado del Motor Local, version, modulo SII Local y metadata segura de boveda SimpleAPI. Agrega acciones para actualizar estado y abrir `options.html` mediante `APP_CONTABLE_OPEN_EXTENSION_OPTIONS`. La web solo consume `APP_CONTABLE_SIMPLEAPI_VAULT_STATUS`; no renderiza inputs PFX/CAF/password.

Actualizacion boveda cifrada SimpleAPI: `options.html` ahora permite seleccionar PFX, ingresar password del certificado, seleccionar CAF XML y definir passphrase local. `modules/simpleapi-vault.js` valida tamaños maximos de 8 MB, deriva una clave con PBKDF2-SHA256 a 250000 iteraciones y cifra el paquete con AES-GCM antes de guardarlo en `chrome.storage.local`. El estado publico sigue limitado a metadata segura (`configured`, `encrypted`, `has_pfx`, `has_caf`, `updated_at`). Todavia no existe desbloqueo ni envio temporal al proxy SimpleAPI.

Actualizacion desbloqueo/proxy SimpleAPI: la boveda puede desbloquearse desde `options.html` por 10 minutos usando la passphrase local; los secretos descifrados quedan solo en memoria del service worker. Se agrego `APP_CONTABLE_SIMPLEAPI_DTE_GENERAR`: cuando la app lo use con la boveda desbloqueada, la extension arma `multipart/form-data` con `input`, PFX y CAF y llama a `/api/simpleapi/dte/generar` en el origen de App Contable. Falta conectar Emision Directa/facturas a este contrato.

Actualizacion Emision Directa SimpleAPI: `EmitirDirectaView` ahora recibe `facturasProveedor`, habilita facturas 33/34 cuando la empresa usa SimpleAPI para facturas y llama a `APP_CONTABLE_SIMPLEAPI_DTE_GENERAR` para generar el DTE desde la extension/boveda local. El resultado se muestra como `Generado`, con copy explicito de que falta envio, consulta SII y PDF oficial; no se persiste como emitido. El detector de duplicados de boletas no se ejecuta para facturas.

Actualizacion proxies ciclo SimpleAPI: la coleccion Postman confirmo que los endpoints posteriores tambien usan `multipart/form-data`. Se agrego `src/lib/emission/simpleapi-multipart-proxy.ts` y endpoints multipart autenticados/rate-limited/sanitizados para `envio/generar`, `envio/enviar`, `consulta/envio`, `consulta/dte` e `impresion/base64/carta/v2/cedible`. La extension expone `APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART` con allowlist para llamar esos proxies sin exponer `SIMPLEAPI_API_KEY`. Aun falta orquestar la secuencia completa y persistir solo con evidencia real.

Actualizacion orquestacion SimpleAPI: `options.html` ahora pide RUT del certificado, RUT emisor, fecha y numero de resolucion SII. La boveda parsea el CAF para obtener tipo/rango de folios e inyecta `Certificado` y `Folio` en el input antes de llamar `dte/generar`. Se agrego `APP_CONTABLE_SIMPLEAPI_DTE_EMITIR`, que encadena `dte/generar`, `envio/generar`, `envio/enviar`, `consulta/envio`, `consulta/dte` e impresion PDF base64. El resultado solo se muestra como aceptado/pendiente de persistencia; falta crear persistencia especifica de facturas emitidas con PDF oficial.

Actualizacion persistencia SimpleAPI: se agrego `POST /api/simpleapi/result` como cierre conservador del flujo de facturas 33/34. El endpoint exige sesion, empresa activa, `tipo_dte` 33/34, folio, fecha, total, track ID, XML DTE, PDF base64 con content type `application/pdf` y firma `%PDF`; sube el PDF al bucket `documentos`, deduplica por `empresa_id + tipo_dte + folio`, inserta/actualiza `boletas_emitidas` con `emision_proveedor = simpleapi` y registra un documento subido asociado. La extension ahora devuelve `dteXml` y `envioXml`; Emision Directa llama al endpoint inmediatamente despues de la aceptacion SimpleAPI/SII y solo muestra `Emitido y guardado` cuando la persistencia responde OK. Si SII acepto pero la app no pudo guardar, queda como `Aceptado sin guardar` y no se marca emitido.

Actualizacion popup extension: `manifest.json` ahora declara `action.default_popup = popup.html`. El popup muestra un resumen de salud del Motor Local: SII Local listo y SimpleAPI configurado/pendiente segun la boveda cifrada. Cuando la boveda tiene PFX, CAF y cifrado local, muestra `Todo correcto`; si falta algo, muestra `Falta configuracion`. El popup no pide ni muestra secretos y solo ofrece `Abrir configuracion`, que lleva a `options.html`, manteniendo la configuracion sensible en la pagina dedicada.

Actualizacion auditoria Opus SimpleAPI: se corrigieron tres riesgos criticos. `advanceVaultFolio` ahora re-cifra y persiste el `nextFolio` dentro de `chrome.storage.local` despues de avanzar el folio CAF, evitando volver al folio inicial si reinicia el service worker MV3. `/api/simpleapi/result` ya no guarda `estado = aceptado` solo por recibir payload: exige aceptacion detectable de envio (`EPR`) y DTE (`DOK`), valida que el XML DTE contenga `TipoDTE`, `Folio` y `MntTotal` coherentes, y mantiene la validacion de PDF real antes de insertar. Si falla el insert despues de subir PDF, intenta remover el objeto de Storage para reducir respaldos huerfanos. El popup cambio `SII Local Operativo` por `SII Local Disponible`, porque no comprueba sesion SII activa desde el popup.

Actualizacion explorador SII red: `scripts/sii-explorer.mjs` ahora acepta `SII_EXPLORER_NETWORK_SCAN=1` para capturar requests/responses permitidos durante la exploracion Playwright. Guarda `network-map.json` y `network-map.md` junto al mapa DOM, con headers sensibles redactados (`authorization`, `cookie`, `csrf`, tokens, claves), bodies sanitizados y captura de response body desactivada por defecto. Para investigar endpoints internos se puede activar `SII_EXPLORER_NETWORK_RESPONSE_BODY=1`, limitado a contenido texto/json/xml/html y cuerpos acotados. Esto permite evaluar si e-Boleta usa XHR/fetch aprovechables desde la extension local, sin mover cookies SII al backend.

Actualizacion boveda SII local: se agrego `modules/sii-vault.js` como boveda separada de SimpleAPI. Guarda RUT y Clave Tributaria cifrados localmente con PBKDF2-SHA256 y AES-GCM en `chrome.storage.local`, usando PIN local de 4 numeros no persistido y desbloqueo temporal en memoria por 10 minutos. `options.html` ahora incluye configuracion SII Local para guardar, desbloquear y eliminar esta boveda; el popup muestra estado de RUT/clave/cifrado/bloqueo. Esto prepara el autologin como capa opcional y redundante: si falla, el flujo debe abrir SII para login humano y continuar sin enviar credenciales SII a App Contable.

Actualizacion autologin SII local: el background ahora detecta pantallas de login SII desde el mapa DOM y, si la boveda SII esta desbloqueada en memoria, intenta un unico autologin local mediante `APP_CONTABLE_SII_ATTEMPT_AUTOLOGIN`. Las credenciales solo se envian al content script de la ventana SII; no pasan por la app ni backend. `sii-worker.js` detecta campos RUT/clave, rechaza pantallas con captcha, 2FA, token o cambio de clave, rellena el formulario y envia login. Si no hay boveda desbloqueada, no hay formulario compatible o SII pide verificacion humana, la extension enfoca la ventana SII, muestra `HUMAN_REQUIRED` y continua escaneando para retomar automaticamente cuando el usuario complete el login. `tabs.onUpdated` conserva `LOCKED_AUTOMATION` durante navegaciones automaticas para evitar que el mensaje de login humano pise el autologin en curso.

## Verificacion Pendiente

- Probar con cuenta de empresa vieja en Chrome Canary o Chrome normal.
- Confirmar que el flujo de boletas 39/41 del Portal SII es automatizable.
- Confirmar si se puede capturar PDF/folio de forma confiable.
- Implementar extension minima y probar handshake sin emitir.
- Confirmar si consulta/historial SII permite verificar posteriormente por folio/tipo/fecha/monto.
- Probar manualmente carga descomprimida en Chrome/Canary desde `extensions/sii-portal-rpa`.
