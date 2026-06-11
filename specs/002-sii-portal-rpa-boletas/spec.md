# Portal SII Local RPA Para Boletas

## Recomendacion

Construir la emision real de boletas como automatizacion local del Portal SII/MiPyme mediante una extension Chrome/Chromium no publicada. Mantener el producto sin dependencias de proveedores AGPL; BaseAPI queda solo como compatibilidad historica para boletas antiguas con PDF guardado.

La app web sigue viviendo en Vercel. La extension corre en el navegador del cliente, abre/controla `sii.cl`, usa la sesion local del contribuyente y devuelve a la app solo el resultado tributario: folio, PDF, estado y metadata. Las credenciales SII no deben pasar por nuestros servidores.

## Decision De Producto

- Lineas de emision activas: `mock`, `sii_local` y `simpleapi` con proxy efimero de generacion DTE.
- Proveedor principal para boletas 39/41: `sii_local` por defecto, con `simpleapi` como alternativa futura.
- Proveedor principal para facturas 33/34: `simpleapi` por defecto; el proxy actual cubre generacion DTE y queda pendiente el ciclo tributario completo.
- Modo inicial: RPA local asistido.
- Modo posterior: RPA local automatico beta, sin cloud de credenciales.
- `mock` queda para demo/desarrollo.
- `mock` debe mostrarse solo a usuarios con `dev_mode` o cuando ya venga seleccionado por datos legacy.
- BaseAPI queda fuera de la experiencia activa y solo se conserva para lectura historica de boletas antiguas.

## Contexto Critico

BaseAPI publica una oferta de Portal MiPyme automatizado: sin CAL, sin migracion, usando el sistema gratuito del SII y credenciales del contribuyente. Su documentacion publica cubre principalmente factura 33, factura exenta 34, guia 52 y NC/ND 61/56. Para boletas 39/41 recomienda usar el portal directamente o contactar ventas. Esto deja un espacio claro para automatizar solo boletas.

El cliente objetivo no es el microemisor con 2 boletas al mes. Es el chico/mediano con caos transaccional: muchas entradas en cartola, P2P, servicios, ventas por WhatsApp/Instagram, clientes repetidos y sin ERP. Excel sirve para pocos casos; deja de servir cuando hay que decidir que se boletea, evitar duplicados, validar receptor, emitir y guardar respaldo.

## Arquitectura Objetivo

```txt
App Vercel
  - Auth
  - Carga de cartolas
  - IA y reglas
  - Propuestas
  - Revision
  - Jobs de emision
  - Persistencia de folio/PDF/estado

Extension Chrome local
  - Recibe job firmado desde la app
  - Expone panel `options.html` como App Contable Motor Local
  - Separa modulos SII local y SimpleAPI/boveda local
  - Crea una ventana SII dedicada como worker local visible
  - Usuario inicia sesion directamente en SII
  - Automatiza formulario boleta 39/41
  - Emite automaticamente despues de sesion valida
  - Captura folio/PDF/estado
  - Devuelve resultado a la app
  - Expone estado de boveda SimpleAPI sin entregar secretos al frontend
```

## Modos De Emision

### RPA Local Automatico

- Usuario aprueba una boleta o lote en la app.
- La app envia un job a la extension.
- La extension crea o enfoca una ventana dedicada `sii_portal_local_worker` en `sii.cl`.
- El usuario inicia sesion manualmente en esa ventana con mouse y teclado habilitados.
- La extension detecta sesion activa.
- La extension activa bloqueo de interaccion accidental y muestra estado de trabajo.
- La extension rellena la boleta.
- La extension ejecuta la accion de emision por si sola.
- La extension captura folio, estado y respaldo disponible como PDF, XML, HTML o enlace equivalente.
- La extension devuelve el resultado a la app para que quede registrado igual que una emision backend.

### Sesion Local Y Controles SII

- No usar cloud de credenciales.
- Reutilizar sesion local del navegador si esta disponible.
- Si se guardan datos, deben quedar localmente en el navegador/equipo del cliente y cifrados con mecanismo local.
- Login, captcha, 2FA o seleccion de contribuyente siguen siendo interacciones humanas si SII las exige.
- Despues de una sesion valida, el flujo no debe requerir confirmacion manual final.

### Proveedores Permitidos

- `mock`: modo de prueba, sin validez tributaria y sin informar al SII.
- `sii_local`: emision real via extension local y Portal SII/e-Boleta del contribuyente.
- `simpleapi`: carril API para facturas 33/34 y opcionalmente boletas 39/41; usa `SIMPLEAPI_API_KEY` solo server-side y secretos del cliente transmitidos temporalmente desde la extension/boveda local.
- `baseapi`: valor legado solo para leer boletas antiguas; no aparece en UI ni puede seleccionarse.

### Modo Combinado

- `empresas.boletas_emision_proveedor` decide el carril de boletas 39/41: `mock`, `sii_local` o `simpleapi`.
- `empresas.facturas_emision_proveedor` decide el carril de facturas 33/34: `mock` o `simpleapi`.
- `empresas.emision_proveedor` queda como columna legacy durante la migracion y refleja el carril de boletas.
- El backend debe elegir proveedor efectivo por `tipo_dte`; nunca convertir boletas 39/41 a facturas 33/34 ni viceversa.
- Mientras Emision Directa/lote no puedan obtener PFX/CAF desde la boveda local, seleccionar `simpleapi` debe fallar con un error explicito de pendiente, no caer a `mock`.
- La extension debe mantener modulos separados: `sii-local` para Portal SII/e-Boleta y `simpleapi-vault` para estado/secretos SimpleAPI locales.
- La extension debe tener una UI local de configuracion con dos apartados claros: SII Local activo y SimpleAPI/boveda local.
- La extension debe tener un popup de accion solo para estado/resumen; la configuracion sensible debe permanecer en `options.html`.
- La app web puede abrir la UI local con `APP_CONTABLE_OPEN_EXTENSION_OPTIONS`, pero no debe pedir PFX/CAF/password en React.
- `/empresa` debe mostrar estado del Motor Local, estado por modulo y boton para abrir configuracion de extension cuando el handshake este disponible.
- La UI local de extension debe guardar PFX, CAF y password del certificado solo dentro de `chrome.storage.local`, cifrados con passphrase local mediante WebCrypto.
- El estado visible para la app debe seguir siendo solo metadata segura; no debe devolver ciphertext ni secretos a React.
- La extension puede desbloquear la boveda en memoria por una ventana corta; los secretos descifrados no deben persistirse.
- La extension puede guardar una boveda SII local opcional para RUT y Clave Tributaria, cifrada en `chrome.storage.local` con PIN local de 4 numeros, separada de la boveda SimpleAPI.
- El autologin SII debe ser un primer intento redundante: si falla por captcha, 2FA, cambio de clave o seleccion de contribuyente, la extension debe abrir SII para login humano y continuar despues de detectar sesion.
- La Clave Tributaria nunca debe salir de la extension local ni llegar a App Contable/Vercel; el backend solo recibe folio/PDF/estado cuando la extension termina.
- La app puede solicitar `APP_CONTABLE_SIMPLEAPI_DTE_GENERAR` solo cuando la boveda este desbloqueada; la extension arma el multipart y llama al proxy efimero.
- Emision Directa puede emitir facturas 33/34 via `APP_CONTABLE_SIMPLEAPI_DTE_EMITIR`, encadenando generacion, envio, consultas y PDF desde la extension.
- Aunque el ciclo SimpleAPI resulte aceptado, la app no debe marcar como emitido hasta que `/api/simpleapi/result` valide folio, track ID, XML DTE, PDF oficial y persistencia OK.
- El folio CAF usado por SimpleAPI debe avanzar y persistirse dentro de la boveda cifrada antes de responder exito a la app, para evitar reutilizacion si reinicia el service worker MV3.
- `/api/simpleapi/result` debe exigir aceptacion detectable de envio y DTE, XML DTE coherente con tipo/folio/total y PDF real antes de guardar `estado = aceptado`.
- El backend debe exponer proxies multipart allowlist para `envio/generar`, `envio/enviar`, `consulta/envio`, `consulta/dte` e `impresion/base64/carta/v2/cedible`, todos autenticados, rate-limited y sanitizados.
- El proxy `POST /api/simpleapi/dte/generar` debe usar `SIMPLEAPI_API_KEY` solo server-side con header `Authorization` y API key directa por defecto, sin prefijo `Bearer` salvo override explicito.
- El proxy SimpleAPI debe limitar trafico por empresa a 3 solicitudes DTE por segundo y 40 por minuto.
- El proxy SimpleAPI debe sanitizar respuestas upstream antes de devolverlas a la app para no ecoar PFX, CAF, password, certificado ni API keys.
- Copy obligatorio SimpleAPI: "Tus certificados y CAF quedan cifrados en este equipo. Durante una emisión SimpleAPI se transmiten temporalmente a App Contable para firmar y enviar el DTE. No los almacenamos en nuestros servidores."

## Seguridad Y Legal

- No prometer API oficial SII.
- No presentarse como facturador de mercado certificado.
- Posicionamiento correcto: herramienta local que automatiza acciones que el contribuyente puede realizar manualmente en su Portal SII/MiPyme.
- No saltar captcha ni 2FA.
- No leer ni enviar clave SII a Vercel.
- No enviar cookies ni HTML completo del SII a Vercel.
- La emision `sii_local` debe ser automatica despues de que el usuario haya iniciado sesion o resuelto controles SII requeridos.
- Limitar permisos de extension a nuestro dominio y dominios SII.
- Cada job debe tener `job_id`, expiracion corta y payload firmado/verificable.
- Guardar auditoria de usuario, fecha, tipo DTE, monto, folio, PDF/estado y proveedor.

## Limite De Confianza

La app y la extension no comparten secretos SII. El limite queda asi:

- App Vercel: genera propuestas, valida datos tributarios, crea jobs, recibe resultados y persiste auditoria.
- Extension local: opera una ventana SII dedicada, detecta sesion SII, rellena formularios, emite y captura resultado.
- Portal SII: sigue siendo el lugar donde el usuario autentica, pero la extension ejecuta el flujo operativo despues de la sesion valida.
- Supabase: guarda solo metadata tributaria necesaria y archivos/resultados propios de la app.

Datos que no deben salir del navegador/equipo del cliente:

- Clave tributaria.
- Certificado digital y clave de certificado.
- Cookies SII.
- HTML completo de paginas SII.
- Capturas de pantalla del portal con datos sensibles, salvo evidencia explicitamente aprobada para soporte.

## Contrato App-Extension

### Handshake

La app detecta la extension con `window.postMessage` desde el origen de la app. La extension responde solo si el origen es permitido.

Solicitud:

```json
{
  "source": "app-contable",
  "type": "APP_CONTABLE_EXTENSION_PING",
  "protocol_version": 1,
  "nonce": "random-client-nonce"
}
```

Respuesta:

```json
{
  "source": "app-contable-extension",
  "type": "APP_CONTABLE_EXTENSION_PONG",
  "protocol_version": 1,
  "extension_version": "0.1.0",
  "capabilities": ["sii_portal_boleta_39", "sii_portal_boleta_41", "auto_emit", "result_capture"],
  "nonce": "random-client-nonce"
}
```

Reglas:

- `nonce` debe coincidir para evitar respuestas viejas.
- La extension no debe responder a origenes no permitidos.
- La app debe tratar ausencia de respuesta como `extension_missing`.
- La version de protocolo inicial es `1`.

### Job De Emision

El job se crea desde una boleta validada en la app. En MVP se envia a la extension para ejecucion local; no se debe emitir desde el backend.

```json
{
  "source": "app-contable",
  "type": "APP_CONTABLE_SII_BOLETA_JOB",
  "protocol_version": 1,
  "job": {
    "job_id": "uuid",
    "expires_at": "2026-06-03T15:10:00.000Z",
    "empresa_id": "uuid",
    "tipo_dte": 39,
    "fecha_emision": "2026-06-03",
    "receptor": {
      "rut": "11111111-1",
      "razon_social": "Cliente de prueba",
      "direccion": "Opcional",
      "comuna": "Opcional"
    },
    "detalles": [
      { "nombre": "Servicio prestado", "cantidad": 1, "monto_total": 11900 }
    ],
    "totales": {
      "monto_total": 11900,
      "monto_neto": 10000,
      "iva": 1900,
      "monto_exento": 0
    },
    "auto_emit": true,
    "confirmation_required": false
  }
}
```

Campos minimos:

- `job_id`: idempotencia y auditoria.
- `expires_at`: vencimiento corto, recomendado 5 minutos.
- `empresa_id`: solo identificador interno; no autoriza acceso SII.
- `tipo_dte`: solo `39` o `41`.
- `fecha_emision`: fecha Chile ya calculada por backend/app.
- `detalles`: MVP un detalle; futuro hasta limite SII.
- `auto_emit`: siempre `true` para `sii_local`.
- `confirmation_required`: `false`; la extension no espera confirmacion manual final.

### Estados Del Job

Estados que la extension reporta a la app:

- `extension_missing`: app no detecta extension instalada.
- `extension_ready`: extension instalada y protocolo compatible.
- `opening_sii`: extension crea o enfoca la ventana dedicada SII.
- `waiting_sii_login`: usuario debe iniciar sesion en SII; mouse y teclado habilitados.
- `sii_captcha_or_2fa`: SII requiere captcha, 2FA u otra intervencion humana; mouse y teclado habilitados.
- `selecting_company`: extension espera/selecciona contribuyente si aplica.
- `navigating`: extension navega al formulario de boleta.
- `filling`: extension rellena campos.
- `submitting`: extension presiono `EMITIR` y espera resultado SII.
- `capturing_result`: extension captura folio, estado y respaldo disponible.
- `emitted`: resultado capturado y enviado a la app.
- `error`: error recuperable o no recuperable.
- `cancelled`: usuario cancelo el flujo.
- `expired`: `expires_at` vencio.

Evento de estado:

```json
{
  "source": "app-contable-extension",
  "type": "APP_CONTABLE_SII_JOB_STATUS",
  "protocol_version": 1,
  "job_id": "uuid",
  "status": "submitting",
  "message": "Emitiendo boleta en SII desde la extension local.",
  "recoverable": true
}
```

### Resultado De Emision

El resultado debe contener solo datos tributarios y archivos necesarios para respaldo.

```json
{
  "source": "app-contable-extension",
  "type": "APP_CONTABLE_SII_JOB_RESULT",
  "protocol_version": 1,
  "job_id": "uuid",
  "ok": true,
  "result": {
    "proveedor": "sii_portal_extension",
    "tipo_dte": 39,
    "folio": 123,
    "fecha_emision": "2026-06-03",
    "estado": "emitida",
    "monto_total": 11900,
    "pdf_base64": "optional-base64",
    "pdf_filename": "boleta-39-123.pdf",
    "sii_reference": "optional-reference"
  }
}
```

Errores esperados:

- `SII_LOGIN_REQUIRED`: usuario no ha iniciado sesion.
- `SII_COMPANY_REQUIRED`: falta seleccionar contribuyente.
- `SII_FORM_NOT_FOUND`: no se encontro formulario esperado.
- `SII_FIELD_NOT_FOUND`: cambio DOM o campo no localizado.
- `SII_USER_CANCELLED`: usuario cancelo.
- `SII_CAPTCHA_OR_2FA`: SII exige intervencion manual.
- `SII_FINAL_CONFIRMATION_REQUIRED`: flujo llego a punto irreversible y debe confirmar humano.
- `SII_WORKER_WINDOW_CLOSED`: usuario cerro la ventana dedicada.
- `SII_WORKER_NAVIGATED_AWAY`: ventana dedicada salio del dominio/pantalla esperada.
- `SII_USER_INTERACTION_PAUSED`: interaccion manual interrumpio una fase automatizada.
- `SII_EMISSION_FAILED`: SII rechazo o no entrego folio.
- `JOB_EXPIRED`: job vencido.
- `PROTOCOL_MISMATCH`: version incompatible.

### Persistencia En La App

Cuando el resultado sea `emitted`, la app debe persistir en `boletas_emitidas`:

- `emision_proveedor = "sii_portal_extension"`.
- `emision_sandbox = false`.
- `proveedor_respuesta` con metadata minima: `job_id`, `extension_version`, `sii_reference`, `captured_at`, `status_history` resumido.
- PDF en storage o payload equivalente si se decide guardar base64 temporalmente.
- Documento en `documentos_subidos` con origen `sii_portal_extension`.

El backend debe validar que el usuario autenticado pertenece a la empresa del job antes de persistir el resultado.

### Reglas De Idempotencia

- Un `job_id` solo puede cerrarse una vez como emitido.
- Si llega el mismo resultado dos veces con mismo folio/tipo/empresa, debe tratarse como reintento seguro.
- Si llega mismo `job_id` con folio distinto, se debe marcar conflicto y pedir revision manual.
- Antes de enviar job, la app mantiene chequeo de duplicados por monto, fecha, receptor y detalle.

### Escaneo Interno De Pagina SII

Antes de automatizar campos, la extension puede escanear internamente la pagina SII activa. Esta operacion es solo lectura: no hace clicks, no escribe y no emite. No debe exponerse como boton tecnico al usuario final.

El escaneo interno detecta URL, titulo, encabezados, formularios, controles y botones. Se usa para identificar selectores estables, textos de acciones y cambios de pantalla durante desarrollo. No debe guardarse como evidencia permanente si contiene datos sensibles.

## Verificacion E Historial

Cuando la boleta se emite desde Portal SII/MiPyme, el documento firmado queda registrado en el SII. Nuestra app debe guardar un historial propio basado en el resultado capturado por la extension, sin prometer que reemplaza el registro oficial del SII.

Niveles de verificacion:

- Confirmacion inmediata: la extension marca emitida solo si la pantalla final del SII muestra folio, tipo DTE, fecha y monto coherentes.
- Respaldo descargado: la extension descarga PDF si el portal lo permite y lo envia a la app para storage; si no puede, marca `pdf_pendiente`.
- Verificacion posterior: la extension puede reabrir la ventana local y buscar la boleta en consulta/historial SII por empresa, tipo, folio, fecha y monto.

Estados recomendados para la app:

- `emitida_capturada`: pantalla final SII mostro folio y datos coherentes.
- `emitida_confirmada`: consulta/historial SII confirmo posteriormente la boleta.
- `emitida_pendiente_pdf`: folio capturado, pero falta PDF.
- `verificacion_pendiente`: falta revisar contra consulta/historial SII.
- `error_verificacion`: no se pudo confirmar en consulta/historial SII.
- `conflicto`: folio, monto, tipo o fecha no calzan con lo esperado.

Reglas de historial en nuestra app:

- Insertar en `boletas_emitidas` solo si hay folio capturado desde SII o confirmacion equivalente.
- Guardar PDF en storage cuando este disponible; no depender solo de base64 en `proveedor_respuesta`.
- Mostrar en UI etiqueta clara: `Emitida en SII`, `Confirmada`, `Verificacion pendiente` o `PDF pendiente`.
- Boton `Descargar PDF` usa nuestro storage cuando el respaldo ya fue guardado.
- Boton `Verificar en SII` reabre la ventana worker local y busca esa boleta en el Portal SII.
- Si la verificacion posterior falla, no borrar la boleta automaticamente; marcar para revision manual.

## Extension No Publicada

La primera version puede distribuirse como extension no publicada:

- Cliente abre `chrome://extensions`.
- Activa `Modo desarrollador`.
- Usa `Cargar descomprimida`.
- Selecciona la carpeta entregada.

Esto evita Chrome Web Store, permite pruebas cerradas y mantiene el codigo fuera de una publicacion publica. Sirve para Chrome, Chrome Canary, Edge, Brave y Chromium.

## Ventana Dedicada SII

La extension no debe usar una pestana suelta mezclada con la navegacion normal del usuario. Debe crear una ventana popup dedicada que actua como worker local visible: no es un backend cloud, pero cumple el rol de motor local controlado por la app.

Nombre interno recomendado: `sii_portal_local_worker`.

Nombre para usuario: `Ventana segura de emision SII`.

Comportamiento esperado:

- Crear ventana con `chrome.windows.create({ type: "popup" })`.
- Guardar `windowId`, `tabId` y `job_id`.
- Usar esa ventana exclusivamente para el flujo SII del job activo.
- Mostrar instrucciones claras: `Esta ventana se usa para emitir en SII. No la cierres mientras trabajamos.`
- Permitir mouse y teclado mientras el estado sea `waiting_sii_login` o `sii_captcha_or_2fa`.
- Bloquear clicks, escritura y submits accidentales durante `navigating`, `filling` y `submitting`.
- Si el usuario cierra la ventana, marcar `cancelled` o `error` recuperable.
- Si la ventana navega fuera de dominios SII permitidos, pausar y pedir reintento.
- Si el DOM esperado cambia, pausar con error recuperable y no emitir.

Estados visuales de la ventana:

- `HUMAN_REQUIRED`: overlay liviano con instrucciones; interaccion permitida solo para login, captcha, 2FA o seleccion SII requerida.
- `LOCKED_AUTOMATION`: overlay bloqueante; la extension esta trabajando y el usuario no debe tocar la pagina.
- `PAUSED`: overlay con motivo, boton reintentar y boton cancelar.
- `DONE`: resultado capturado; la ventana puede cerrarse o mostrar resumen.

El bloqueo no debe intentar atrapar al usuario. El usuario siempre puede cancelar o cerrar la ventana. El objetivo es evitar escritura/click accidental, no impedir control del equipo.

## Permisos Esperados

```json
{
  "permissions": ["tabs", "scripting", "storage"],
  "host_permissions": [
    "https://www.sii.cl/*",
    "https://*.sii.cl/*",
    "https://app-contable-five.vercel.app/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ]
}
```

Evitar `<all_urls>`. Chrome match patterns no usan comodin de puerto; `http://localhost/*` cubre desarrollo local.

## Mapeo Pendiente Del Portal SII

- URL inicial para emision de boleta 39/41: `https://eboleta.sii.cl/emitir/`.
- Si 39 y 41 estan en formularios separados o selector unico.
- Campos de receptor, consumidor final, detalle, cantidad, monto, fecha y giro.
- Si el portal calcula IVA o pide precio bruto/neto.
- Si existe preview antes de emitir.
- Punto exacto de accion irreversible.
- Donde aparece folio despues de emitir.
- Como descargar PDF y si existe XML accesible.
- Como consultar boleta emitida posteriormente.
- Si hay captcha, 2FA o bloqueo de automatizacion.

## MVP Tecnico

Implementacion local esperada, con emision real automatica despues de sesion SII valida:

- Manifest V3 con content script y background service worker.
- Handshake `PING/PONG` desde app local y produccion.
- Boton en Emision Directa que indique si la extension esta instalada.
- Envio de job local desde la boleta manual.
- La extension crea ventana popup dedicada SII y reporta `waiting_sii_login`.
- Mientras no haya sesion SII, la ventana queda desbloqueada para login manual.
- Al detectar sesion activa, activar overlay `LOCKED_AUTOMATION` con mensaje de no cerrar/no tocar.
- Escaneo interno de pagina SII para detectar formulario/calculadora y resultado sin exponer controles tecnicos al usuario.
- Rellenar formulario/calculadora, hacer click en `EMITIR`, esperar respuesta SII y capturar folio/respaldo.
- Enviar `APP_CONTABLE_SII_JOB_RESULT` a la app con folio, estado, monto, fecha, tipo DTE y enlaces o archivos disponibles.

## Pricing Derivado

Si el Portal SII local funciona, no depender de un proveedor AGPL permite bajar precio para el segmento chico/mediano:

- Inicio: `$19.990/mes`, boleta local asistida con limite bajo.
  - Pro: `$34.990/mes`, cartola + IA + boletas automaticas/lotes pequenos.
- Automatico beta: `$59.990-$79.990/mes`, lotes, reglas, reutilizacion de sesion local y soporte prioritario.
- Setup asistido: `$49.990-$99.990` una vez.

## Proximo Paso Tecnico

Probar la extension Manifest V3 no publicada con una cuenta SII real controlada: abrir SII, esperar login/captcha si corresponde, cargar monto, presionar `EMITIR`, capturar folio y detectar PDF/XML/HTML o enlace de respaldo disponible.
