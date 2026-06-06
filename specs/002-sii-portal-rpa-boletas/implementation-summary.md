# Implementation Summary

## Estado Actual

Se documento la estrategia para seguir con emision real de boletas sin depender del piso de costo de LibreDTE y sin construir aun un motor DTE certificado/CAL. Tambien se creo una primera extension local no publicada y se conecto la UI de Emision Directa para detectar la extension y abrir una ventana SII dedicada sin emitir.

## Decision Guardada

- Usar extension Chrome/Chromium no publicada como primer camino.
- La app web en Vercel prepara datos, propuestas y jobs.
- La extension local automatiza Portal SII/MiPyme desde el navegador del cliente.
- Las credenciales SII no se guardan ni se envian a nuestros servidores.
- El flujo `sii_local` debe emitir automaticamente despues de una sesion SII valida.
- Login, captcha, 2FA o seleccion de contribuyente siguen siendo manuales si SII los exige; no se deben saltar.
- Mantener LibreDTE como fallback real.
- Usar protocolo app-extension version `1` con handshake `PING/PONG` por `window.postMessage`.
- Modelar estados explicitos: `extension_missing`, `waiting_sii_login`, `filling`, `submitting`, `capturing_result`, `emitted`, `error`, entre otros.
- Persistir resultados reales con proveedor `sii_portal_extension` y metadata minima en `proveedor_respuesta`.
- Operar SII en una ventana popup dedicada `sii_portal_local_worker`, no en una pestana suelta del navegador.
- Permitir mouse/teclado solo cuando el humano debe intervenir: login, captcha/2FA o seleccion SII requerida.
- Bloquear interaccion accidental despues del login y durante navegacion/relleno/envio con overlay visible.
- Mantener historial propio en la app con folio capturado, PDF si existe y verificacion posterior contra consulta/historial SII.

## Razonamiento

LibreDTE valida la emision real, pero su piso de `40.000 + IVA/mes` puede matar el segmento chico/mediano. BaseAPI valida publicamente el modelo de Portal MiPyme automatizado sin CAL ni migracion, pero no expone boletas 39/41 como producto publico. La oportunidad es automatizar solo boletas 39/41 desde el Portal SII del contribuyente.

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

- La configuracion de empresa ahora presenta tres lineas separadas: `Mock local`, `LibreDTE` y `SII local`.
- BaseAPI ya no aparece como proveedor activo en UI; valores legados `baseapi` se mapean a `libredte`.
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

Actualizacion auditoria app contable: se corrigieron blockers no relacionados con implementar LibreDTE. `obtenerConfigEmision` ahora cae a `mock` si prod aun no tiene columnas de proveedor, en vez de romper toda emision. `setEmisionConfig` devuelve un error accionable si falta la migracion/check de proveedores. El home autenticado ahora entra a `/escritorio/v5`. `emitir-lote` revalida server-side el clasificador `no_boletar` para no depender solo de la UI. `pendientes-emision` deja de usar service role para leer boletas emitidas y respeta RLS. Se agrego migracion idempotente `20260606120000_emission_provider_guardrails.sql` para asegurar columnas/checks `mock/libredte/sii_local` en `empresas` y `boletas_emitidas` aunque las migraciones previas de junio se apliquen fuera de orden. LibreDTE queda visible como pendiente/deshabilitado hasta conectar su backend real.

## Verificacion Pendiente

- Probar con cuenta de empresa vieja en Chrome Canary o Chrome normal.
- Confirmar que el flujo de boletas 39/41 del Portal SII es automatizable.
- Confirmar si se puede capturar PDF/folio de forma confiable.
- Implementar extension minima y probar handshake sin emitir.
- Confirmar si consulta/historial SII permite verificar posteriormente por folio/tipo/fecha/monto.
- Probar manualmente carga descomprimida en Chrome/Canary desde `extensions/sii-portal-rpa`.
