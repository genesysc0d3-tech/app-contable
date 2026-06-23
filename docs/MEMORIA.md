# Memoria Del Producto MassDTE

Este archivo es la memoria viva del producto. Debe leerse antes de tocar planes,
cuentas, multiempresa, equipo, Telegram, emision SII local, extension Chrome,
facturacion o gating.

No es una bitacora corta. Es contexto operativo y de producto para no volver a
decidir desde cero.

## 0. Referencias Compliance / Legal

Referencia externa a considerar para una fase separada de compliance chileno:
`https://github.com/Lelemon-studio/compliance-cl`.

Segun su README, `compliance-cl` es una skill para auditar SaaS chilenos contra
Ley 21.719 de datos personales y Ley 21.595 de delitos economicos, usando texto
oficial versionado. Promete generar inventario, diagnostico tecnico y documentos
como RAT, politica de privacidad, DPA, plan de brechas, modelo de prevencion de
delitos, codigo de etica y matriz de riesgos en `.compliance/`.

Uso recomendado para MassDTE: evaluarla como insumo/herramienta cuando se abra
la fase de privacidad, datos personales, retencion de documentos tributarios,
transferencias a proveedores (Supabase, Vercel, IA, Telegram, Mercado Pago),
respuesta a brechas, derechos ARCO, contratos/DPA y readiness legal antes de
beta pagada o lanzamiento abierto. No instalar ni copiar codigo del repo externo
sin decision explicita.

### Sesion 2026-06-22 - Plan preauditoria 9.3

**Decision guardada:**
- La siguiente fase apunta a dejar MassDTE en 9.2-9.4/10 tecnico/compliance
  antes de pagar auditoria externa. El 10/10 no se autodeclara; se prepara
  evidencia para que abogado/auditor lo valide.
- Se creo el memo durable
  `artifacts/docs/compliance/massdte-preauditoria-9-plan-y-contexto-2026-06-22.md`
  como contexto completo para reinicios o cambio de IA.
- Postura producto/legal: MassDTE es herramienta de automatizacion asistida.
  El usuario autorizado revisa, aprueba y ordena la emision; la extension
  ejecuta acciones equivalentes a teclado/mouse sobre una sesion SII/proveedor
  configurada por el usuario. MassDTE responde por seguridad, autorizacion,
  trazabilidad, prevencion razonable, soporte y correccion asistida.
- Soporte contable asistido: si usuario o app detectan un problema, soporte
  contacta al cliente, el contador interno revisa, el cliente autoriza cualquier
  correccion tributaria real y se cierra con evidencia sanitizada.

**Plan conciliado:**
- Crear aceptacion versionada antes de emision real y bloquear
  `allow_final_emit` si no existe autorizacion vigente por usuario, empresa,
  proveedor y version legal.
- Endurecer extension: migrar boveda SII desde PIN 4-8 a passphrase fuerte en
  produccion, agregar lockout a SimpleAPI vault, separar manifest dev/prod sin
  localhost en produccion y actualizar README/arquitectura.
- Apagar `page-map` en produccion por defecto; si se activa, sanitizar antes de
  salir de la extension. Evitar `body_excerpt`, RUT/email, montos largos, URLs
  completas y formularios crudos.
- Sanear `sii_local_resultados` y drafts de emision: no retener PDF base64,
  XML completo, page excerpts crudos ni datos tributarios sensibles en
  `localStorage`.
- Performance: `DashboardSafeSnapshot` server-side, cache allowlist y primer
  render de `/massdte` solo con snapshot, top 20 visibles, contadores,
  calendario agregado y locks frescos. RCV 24 meses, search/history y
  pendientes completos deben pasar a carga bajo demanda.
- Compliance v2: RAT por flujo, matriz de bases legales, DPA/proveedores,
  transferencias, retencion, ARCO, brechas, EIPD IA/OCR, MPD proporcional y
  conclusion Ley 21.663.

**No hacer:**
- No guardar claves SII en backend.
- No abrir `<all_urls>` en la extension.
- No usar "todo cifrado en localStorage" como solucion.
- No cachear localmente PDFs, XML, cartolas, OCR crudo, prompts IA, RUT/email
  completos, CAF, certificados, tokens ni pagos raw.

### Sesion 2026-06-23 - Aplicacion hardening preauditoria 9

**Que se aplico en `feature/preaudit-9-hardening`:**
- Se agrego `emission_authorizations` con autorizacion versionada por cuenta,
  empresa, usuario, proveedor y version legal. La tabla no guarda XML, PDFs,
  claves ni payload tributario.
- `/api/emision/authorizations` permite consultar/registrar la aceptacion de
  emision real; registra evento `emision_autorizacion_aceptada` en auditoria
  de cuenta con metadata allowlist.
- `/api/emision/jobs` ahora falla cerrado con
  `EMISSION_AUTHORIZATION_REQUIRED` si no existe autorizacion vigente para
  `sii_local` o `simpleapi` antes de crear locks/jobs.
- `EmitirDirectaView` confirma explicitamente autorizacion de emision asistida
  antes de pedir job y guarda drafts de emision en `sessionStorage` con TTL de
  12 horas en vez de `localStorage` durable.
- Extension SII: la boveda dejo de aceptar PIN numerico 4-8 y exige
  passphrase local de al menos 12 caracteres que no sea solo numerica; textos
  de opciones/background quedaron alineados.
- Extension SimpleAPI: la boveda ahora tiene lockout persistido tras fallos de
  passphrase y limpia el lock al guardar/desbloquear correctamente.
- Se agrego `extensions/sii-portal-rpa/manifest.prod.json` sin permisos a
  `localhost`/`127.0.0.1`; `manifest.json` queda como dev/local.
- `/api/sii-local/page-map` queda apagado por defecto en produccion salvo
  `MASSDTE_ENABLE_SII_PAGE_MAP=1`; aun activado, sanitiza URLs, RUTs, emails,
  secretos y longitud antes de guardar en memoria.
- `sii_local_resultados` sanea logs de resultado: redacted para base64,
  XML/HTML, certificados, tokens/clave/cookies y excerpts de pagina.
- RCV de `/massdte` deja de hidratar hasta 5000 boletas en primer render:
  SSR carga solo mes inicial y `RcvViewWrapper` trae meses bajo demanda desde
  `/api/boletas/rcv`.
- `scripts/audit-emission-lock.mjs` fue actualizado para registrar/validar
  autorizacion de emision antes de crear el job temporal del audit de locks.

**Pendiente de esta linea de trabajo:**
- La migracion `20260623100000_emission_authorizations.sql` fue aplicada en
  Supabase remoto el 2026-06-23. `migration list` confirmo local/remoto
  alineados hasta `20260623100000`; `db push --dry-run` y `db lint --linked`
  posteriores quedaron bloqueados por `ECIRCUITBREAKER`/auth temporal del
  pooler, no por SQL.
- Produccion quedo redeployada en Vercel con deployment
  `dpl_DNdgdoUDKHmwSCDQfYo5bWgcwq5y`; alias
  `https://app-contable-five.vercel.app`.
- `npm run build`: OK local antes del deploy y OK en Vercel.
- `audit:roles` produccion 2026-06-23: OK, 0 hallazgos.
  Reporte: `artifacts/runs/2026-06-23-massdte-role-matrix-audit.md`.
- `audit:app` produccion 2026-06-23: OK, 0 hallazgos despues de clasificar
  aborts de logo de empresa como cancelacion esperada de navegacion.
  Reporte: `artifacts/runs/2026-06-23-massdte-dev-audit-2026-06-23T05-55-21-300Z.md`.
- `audit:locks` produccion 2026-06-23: OK, 0 hallazgos; registro
  autorizacion de emision, creo lock temporal, hizo heartbeat, valido UI y
  limpio el job. Reporte:
  `artifacts/runs/2026-06-23-massdte-emission-lock-audit.md`.

**Pendiente de esta linea de trabajo:**
- Probar en navegador con extension recargada, passphrase nueva y emision real
  controlada.
- Lighthouse autenticado post-deploy.

### Sesion 2026-06-21 - Cola durable OCR/IA y compliance 8 beta

**Que se hizo:**
- Se implemento la cola durable base para documentos/OCR/IA en la rama
  `feature/durable-document-processing-compliance`.
- Nueva tabla `document_processing_jobs` con RLS deny-by-default, idempotencia
  por documento/version de pipeline, estados `queued/running/retryable/
  completed/failed/cancelled`, reintentos con backoff, locks, watchdog de jobs
  atascados y metadata operacional sin contenido crudo.
- `/api/subir-procesar` ya no depende de background volatil para hacer parseo,
  OCR o IA: guarda archivo en Storage, crea job durable, marca el documento
  como encolado y solo dispara un kick oportunista. Si Storage o la cola fallan,
  responde error y deja evento ops sanitizado.
- `/api/procesar-documento` queda como reproceso durable: valida propiedad,
  rechaza documentos solo en memoria, soporta imagenes agrupadas y reusa jobs
  completados sin duplicar procesamiento.
- Se agregaron worker y endpoints internos: `processDocumentQueue`,
  `/api/document-processing/cron` protegido por `CRON_SECRET` y
  `/api/document-processing/retry` solo para operador Genesys con auditoria.
- `/dev/diagnostico` ahora muestra cola docs lista/corriendo/fallida 24h/
  atascada, y el snapshot operacional levanta hallazgos para jobs fallidos o
  running viejos.
- Se agregaron paginas publicas `/legal`, `/legal/privacidad`,
  `/legal/terminos` y `/legal/seguridad` como base conservadora para beta.
- `COMPLIANCE-001` queda `done_beta`: se versiono paquete RAT/DPA/brechas/
  retencion/MPD y un reporte de readiness para apuntar a 8/10 en compliance
  chileno beta controlada. No reemplaza revision legal externa.

**Verificacion:**
- `git diff --check`: OK.
- `npm run test -- src/lib/document-processing/queue.test.ts`: OK, 4 tests.
- `rtk tsc --noEmit`: OK.
- `npm run lint`: OK.
- `npm run test`: OK, 14 archivos, 93 tests.
- `npm run build`: OK con `/api/document-processing/cron`,
  `/api/document-processing/retry` y `/legal/*`.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; solo
  `20260621223000_document_processing_jobs.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion aplicada.
- `bash scripts/supabase-local-token.sh db lint --linked`: OK, sin errores.
- `bash scripts/supabase-local-token.sh migration list`: fallo despues por
  auth temporal del pooler (`cli_login_postgres` / `ECIRCUITBREAKER`) tras
  aplicar la migracion; no reintentar de inmediato.

**Pendientes criticos:**
- Configurar/verificar `CRON_SECRET` en Vercel antes de depender del cron de
  documentos; en Hobby queda diario, para beta conviene scheduler externo o
  Vercel Pro si se requiere frecuencia subdiaria.
- Probar con un Excel, PDF e imagen reales en produccion y revisar
  `/dev/diagnostico` despues del primer procesamiento.
- Revision legal externa antes de lanzamiento abierto; el estado actual es
  readiness tecnico/legal beta, no opinion legal final.

### Sesion 2026-06-21 - Observabilidad operacional

**Que se hizo:**
- Se implemento la primera capa real de observabilidad operacional en la rama
  `observability/ops-events`.
- Se agrego `ops_events` con RLS deny-by-default para eventos internos
  sanitizados: severidad, fuente, evento, cuenta/empresa/usuario opcionales,
  recurso, resumen y metadata segura. La migracion
  `20260621190000_ops_events.sql` quedo aplicada en Supabase remoto.
- Se agrego sanitizador de metadata ops: redacta tokens, claves, cookies,
  certificados, PDFs/XML/base64/payloads/prompts/raw, enmascara emails/RUTs y
  limita largo/profundidad.
- Se agrego `recordOpsEvent` / `recordOpsError` y snapshot operacional para
  detectar documentos atascados, locks expirados, jobs de emision fallidos y
  eventos ops error/critical en 24h.
- Se agrego `GET /api/ops/cron` protegido por `CRON_SECRET`, programado diario
  en `vercel.json` por limite Hobby de Vercel, con alerta opcional via
  `OPS_ALERT_WEBHOOK_URL`. En Pro o con scheduler externo se puede subir la
  frecuencia a 30 minutos.
- `/dev/diagnostico` ahora muestra salud operacional segura para Genesys:
  contadores, hallazgos activos y ultimos eventos ops sin payloads ni secretos.
- Se instrumentaron fallos/bloqueos en upload/IA/OCR, pagos checkout/webhook/
  cron, emision jobs, SII local y SimpleAPI result. No se toca extension/SII.

**Verificacion:**
- `npm run test -- src/lib/ops/sanitize.test.ts`: OK, 3 tests.
- `rtk tsc --noEmit`: OK.
- `npm run lint`: OK.
- `npm run build`: OK con `/api/ops/cron` y `/dev/diagnostico`.
- `npm run test`: OK, 13 archivos, 89 tests.
- `git diff --check`: OK.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; solo
  `20260621190000_ops_events.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion aplicada.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260621190000`.
- `bash scripts/supabase-local-token.sh db lint --linked`: OK, sin errores.

**Pendientes criticos:**
- Implementar `ENG-003` cola durable para OCR/IA/documentos con worker/cron,
  idempotencia, reintentos y recuperacion de jobs atascados.
- Configurar `OPS_ALERT_WEBHOOK_URL` si se quiere alerta externa inmediata.
- Extender Lighthouse autenticado a `/massdte` y `/dev/cuentas` con storage
  state seguro.
- Continuar paquete compliance/legal antes de beta pagada abierta.

### Sesion 2026-06-21 - LAUNCH-001, rate limits y arquitectura durable

**Que se hizo:**
- `LAUNCH-001` queda cerrado por smoke manual informado por el usuario:
  extension/SII/CAF emite en flujo real controlado. La evidencia versionada se
  limita a resumen no sensible en
  `artifacts/runs/2026-06-21-launch-001-user-smoke.md`.
- Se agrego rate limit inicial in-memory en `src/lib/security/rate-limit.ts` y
  se aplico a endpoints caros/sensibles: `/api/subir-procesar`,
  `/api/ocr-comprobante`, `/api/pagos/checkout` y `POST/DELETE/PATCH`
  `/api/emision/jobs`.
- Se creo `ENG-003` como contrato de cola durable para documentos/OCR/IA. No se
  implementa una cola incompleta sin worker; el siguiente cierre real requiere
  tabla de jobs, worker/cron, idempotencia, reintentos y deteccion de jobs
  atascados.
- Se agrego Lighthouse CI en `.github/workflows/lighthouse.yml` con
  `treosh/lighthouse-ci-action@v12`, build local de Next, `next start` en
  `127.0.0.1:3000` y auditoria de rutas publicas sin sesion:
  `/auth/login`, `/auth/registro` y `/bloqueado`. Los reportes quedan como
  artifacts privados de GitHub Actions, sin `temporaryPublicStorage`.
- El reporte CTO queda actualizado a 74/100 post-LAUNCH-001 + hardening
  inicial. La beta controlada puede incluir emision real con soporte presente,
  pero el lanzamiento abierto sigue bloqueado por observabilidad, cola durable
  y compliance/legal.

**Verificacion:**
- `npm run test -- src/lib/security/rate-limit.test.ts`: OK, 3 tests.
- `npm run lint`: OK.
- `git diff --check`: OK.
- `npm run test`: OK, 12 archivos, 86 tests.
- `npm audit --audit-level=moderate`: OK, 0 vulnerabilidades.
- `npm run build`: OK con Next 16.2.9.
- `node -e "JSON.parse(...lighthouserc.json...)"`: OK.
- `next start` local con permiso ampliado + `curl -fsSI` a `/auth/login`,
  `/auth/registro` y `/bloqueado`: OK, HTTP 200.

**Pendientes criticos:**
- Observabilidad/alertas para emision, upload, IA, pagos, locks y webhooks.
- Implementar `ENG-003` cola durable para procesamiento pesado.
- Extender Lighthouse a `/massdte` y `/dev/cuentas` con storage state
  controlado, sin publicar reportes con datos sensibles.
- Validar runbook beta con primera cuenta controlada.
- Revision legal externa y bajada producto de `COMPLIANCE-001`.

### Sesion 2026-06-21 - Readiness tecnico/compliance

**Que se hizo:**
- Se implemento un sprint de readiness en la rama
  `chore/production-readiness-compliance`.
- Lint quedo verde y se agrego CI en GitHub Actions con install, lint, test,
  build y audit production.
- Se agregaron headers base en `next.config.ts`: HSTS, nosniff,
  Referrer-Policy, Permissions-Policy, X-Frame-Options y CSP minima.
- `VisualizarArchivo` dejo de usar `XLSX.utils.sheet_to_html` y
  `dangerouslySetInnerHTML`; ahora renderiza celdas como React desde datos
  estructurados.
- `/api/subir-procesar` valida base64 antes de `Buffer.from`, limite decoded
  10 MiB, tipo/MIME/extension permitidos y nombre sanitizado.
- `npm audit` quedo en 0 vulnerabilidades con updates no destructivos y override
  de `postcss`.
- Se creo runbook de primera beta controlada:
  `artifacts/docs/first-beta-runbook-2026-06-21.md`.
- Se creo paquete compliance minimo:
  `artifacts/docs/compliance/massdte-compliance-minimo-2026-06-21.md`.
- `LAUNCH-002` y `COMPLIANCE-001` quedan `in_progress`, no cerrados: falta
  validacion post-deploy, revision legal externa y bajada a flujos producto.

**Verificacion:**
- `npm run lint`: OK.
- `npm run test`: OK, 11 archivos, 83 tests.
- `npm run build`: OK.
- `npm audit --audit-level=moderate`: OK, 0 vulnerabilidades.
- `git diff --check`: OK.

**Estado posterior:**
- `LAUNCH-001` fue cerrado despues por smoke manual informado por el usuario.
  Ver la sesion "LAUNCH-001, rate limits y arquitectura durable" en este mismo
  archivo.

## 1. Cliente Objetivo

MassDTE no se vende principalmente a contadores. Se vende a personas que no
quieren pagar un contador para tareas repetitivas, pero tampoco quieren perder
tiempo aprendiendo contabilidad o digitando boletas.

El cliente objetivo quiere:

- Subir cartolas y que salgan boletas.
- Emitir boletas manuales cuando lo necesita.
- Enviar comprobantes por Telegram y evitar digitar.
- Ver su historial sin pedirle todo al contador.
- Manejar mas de una empresa si tiene varios RUTs.
- Agregar personas al equipo sin aprender permisos complejos.

La comunicacion comercial debe ser simple. Evitar jerga como DTE, API,
entitlements, multi-RUT, cuota_masivas, endpoints o tecnicismos tributarios en
la pagina de compra. Usar palabras como empresa, boletas desde cartolas,
boletas manuales, comprobantes por Telegram, equipo, historial y reportes.

## 2. Planes Comerciales

Los planes base son Start, Pro y Business.

| Plan | Precio base | Empresas incluidas | Personas incluidas | Boletas desde cartolas | Telegram | Equipo | Multiempresa |
|---|---:|---:|---:|---:|---:|---:|---:|
| Start | 0,5 UF/mes | 1 | 1 | 300/mes | No | No | No |
| Pro | 1 UF/mes | 1 | 1 | 1.000/mes | 100 comprobantes/mes | No | No |
| Business | 2 UF/mes | 1 | 1 | 3.000/mes | 500 comprobantes/mes | Si | Si |

Business no regala empresas ni personas ilimitadas. Business desbloquea la
capacidad de tener empresas adicionales y personas adicionales, pero esas
unidades se cobran como add-ons.

## 3. Add-ons

| Add-on | Precio propuesto | Disponible en |
|---|---:|---|
| Empresa adicional | +0,5 UF/mes | Business |
| Persona de equipo adicional | +0,2 UF/mes | Business |
| +500 boletas desde cartolas | Pago unico mensual | Todos |
| Telegram extra | Pack mensual | Pro/Business |

Regla comercial: Start y Pro son de una empresa y una persona. Business habilita
varias empresas y equipo, pero cada empresa adicional y cada persona adicional
se paga.

## 4. Cuenta Pagadora

La arquitectura debe girar alrededor de una cuenta pagadora.

| Capa | Significado |
|---|---|
| cuentas | Cliente que paga |
| empresas | Cada empresa/RUT/dashboard |
| usuarios | Personas que entran a la app |
| cuenta_empresas | Empresas asociadas a la cuenta |
| cuenta_usuarios | Personas del equipo asociadas a la cuenta |
| usuarios.empresa_id | Dashboard activo actual |

Cada empresa sigue aislada por empresa_id. Cambiar de empresa no mezcla datos:
solo cambia el dashboard activo.

usuarios.empresa_id sigue siendo la empresa activa. Esto ya calza con la app
actual porque casi todos los endpoints y pantallas filtran por empresa_id.

La pieza que falta para que los planes calcen con el producto es cuentas como
pagador central. No conviene seguir extendiendo empresas.plan como si cada
empresa fuera una cuenta independiente cuando Business puede tener varias
empresas y varias personas bajo el mismo pago.

## 5. Empresas Y Dashboards

Multiempresa significa: una cuenta puede manejar varias empresas propias.

No es principalmente un sistema de invitaciones. Es una forma de que un mismo
dueno/correo opere varios dashboards.

Regla:

- Cada empresa es un dashboard separado.
- Cada empresa tiene sus documentos, boletas, clientes, CAF, Telegram,
  propuestas, historial y configuracion.
- El usuario cambia entre empresas desde el logo/nombre de empresa arriba a la
  izquierda.
- Al elegir una empresa se actualiza usuarios.empresa_id y se refresca /massdte.

UX del selector:

```text
Cambiar empresa
ALPHA CODE SPA
BETA MARKET SPA
GAMMA SPA
```

No cambiar todas las RLS a multiempresa desde el primer paso. Mantener el
aislamiento por empresa activa al inicio es mas seguro. El switch debe validar
en backend que el usuario pertenece a la cuenta y que la empresa esta activa.

## 6. Equipo Business

Equipo solo existe en Business. En Start y Pro no debe aparecer panel, teaser ni
circulitos de equipo.

No hay roles visibles. Todos los usuarios del equipo tienen control total.

La UI no debe hablar de owner, admin, contador, viewer ni permisos. El cliente
solo ve Equipo, personas y estado de conexion.

Regla:

- Si una persona esta en el equipo, puede usar todo.
- Personas adicionales se cobran como add-on mensual.
- Si no esta pagada, no debe entrar al dashboard.
- Si se desactiva el pago, se bloquea el acceso sin borrar datos.

El panel Equipo va abajo de las cards de la columna izquierda. Es compacto, no
un panel grande.

Visual:

```text
Equipo

TA  JP  MR  +2
3 conectados
```

Estados:

| Color | Estado |
|---|---|
| Verde | Conectado y activo |
| Amarillo | Conectado, pero inactivo |
| Gris | Desconectado |

Cada circulito muestra iniciales o foto, con un punto de estado. Maximo 5
visibles y luego +N.

Click en la card Equipo abre mini panel con personas y boton Agregar persona.

## 7. Presencia Y Tiempo Real

Business necesita presencia y realtime. Si hay equipo, la app debe sentirse viva
y evitar que dos personas se pisen en emision.

Presencia sugerida:

```text
presence:cuenta:{cuentaId}
```

Cada usuario publica:

- nombre visible
- iniciales
- empresa activa
- ultima actividad
- estado activo/inactivo

Ya existe realtime parcial para documentos. Falta completar realtime para:

| Area | Realtime requerido |
|---|---|
| Documentos | Ya parcial, reforzar |
| Propuestas | Si |
| Boletas emitidas | Si |
| Equipo conectado | Si |
| Cambio de empresa activa | Si |
| Estados de procesamiento | Si |
| Estados de emision local | Si |

Como todos los miembros del equipo tienen control total, debe existir auditoria
basica:

```text
Juan emitio boleta #123
Maria aprobo una propuesta
Take cambio de empresa activa
Ana agrego una persona al equipo
```

La auditoria no es para permisos, sino para trazabilidad.

## 8. Boletas Desde Cartolas

La cuota principal mide boletas desde cartolas, no operaciones procesadas.

Regla actual correcta de consumo:

```text
boletas_emitidas.propuesta_id IS NOT NULL
```

Eso representa boletas nacidas del pipeline de cartolas/MassDTE.

No consumen cuota:

- Boletas manuales/directas.
- Comprobantes Telegram.
- Documentos subidos sin emitir.
- Propuestas pendientes.
- Duplicados.
- Salidas/no comerciales.
- Errores de lectura.

La app debe bloquear preventivamente cuando el lote no cabe.

Ejemplo:

- Plan de 100 boletas desde cartolas.
- Usuario ya uso 89.
- Quedan 11.
- Sube una cartola que parece traer 30 boletas emitibles.
- La app bloquea antes de procesar o antes de emitir, con mensaje claro.

Para Excel/CSV se puede estimar antes. Para PDF/imagen puede requerir OCR antes
de saber. En cualquier caso, el gate final de emision debe mantenerse siempre en
backend.

## 9. Boletas Manuales

Las boletas manuales/directas son gratis e ilimitadas.

No consumen cuota de boletas desde cartolas. Se consideran digitadas por el
usuario o prellenadas desde un flujo individual, no emision masiva.

## 10. Telegram

Telegram tiene cupo propio y no consume la cuota de boletas desde cartolas.

Producto: Captura automatica por Telegram.

No venderlo como bot ni como API. Venderlo como:

```text
Envias comprobantes por Telegram y MassDTE prepara la boleta sin digitar.
```

Cuenta contra cupo Telegram:

- Comprobantes utiles por Telegram.
- Comprobante que termina en propuesta de ingreso lista para revisar.
- Comprobante aceptado manualmente como ingreso.

No cuentan:

- Imagen ilegible.
- Duplicado.
- Salida marcada como No es ingreso.
- Mensaje que no es comprobante.
- Comprobante ambiguo sin confirmar.
- Error de procesamiento.

En Business multiempresa:

- Si la cuenta tiene una sola empresa, procesa directo.
- Si tiene dos o mas empresas, al recibir imagen pregunta empresa antes de
  procesar.

Flujo:

```text
Recibi el comprobante.
Para que empresa lo cargo?

76.xxx.xxx-x - ALPHA CODE
77.xxx.xxx-x - BETA SPA
78.xxx.xxx-x - GAMMA SPA
```

Primer tap cambia solo el boton seleccionado visualmente:

```text
OK? 76.xxx.xxx-x - ALPHA CODE
77.xxx.xxx-x - BETA SPA
78.xxx.xxx-x - GAMMA SPA
```

Segundo tap confirma y recien ahi procesa.

No se debe crear documento, descargar imagen, hacer OCR ni consumir cupo hasta
que el usuario confirme la empresa.

## 11. Extension SII Y SimpleAPI Local

La extension es una pieza critica y distinta al resto del sistema.

La app es multiusuario y multiempresa en la nube. La extension vive localmente
en el navegador de cada persona.

Reglas:

- La extension no se comparte entre usuarios.
- Cada persona del equipo configura su propia extension local si va a emitir
  desde su computador.
- La app no guarda ni reparte claves SII/certificados entre usuarios.
- Si un usuario no tiene extension configurada, puede seguir usando dashboard,
  revisar, subir, editar, etc., pero no puede emitir con proveedor local desde
  su maquina.

Estado a mostrar por empresa activa:

| Estado | UI |
|---|---|
| Instalada y lista | Verde: Extension lista |
| Instalada pero bloqueada | Amarillo: Desbloquea la extension |
| RUT no coincide | Configura esta empresa |
| No instalada | Instalar extension |
| Otro usuario emitiendo | Juan esta emitiendo |

Riesgo actual detectado:

Los endpoints /api/sii-local/result y /api/simpleapi/result guardan usando la
empresa activa actual del usuario. En multiempresa esto es riesgoso. Si el
usuario inicia una emision en ALPHA, cambia a BETA y luego llega el resultado,
podria guardarse bajo BETA. Eso debe corregirse antes de activar multiempresa
con extension.

Solucion:

Crear jobs de emision amarrados a empresa, cuenta y usuario.

```text
emision_jobs
- job_id
- cuenta_id
- empresa_id
- usuario_id
- proveedor
- origen
- estado
- emisor_rut_esperado
- propuesta_id / boleta_origen_id
- created_at
- expires_at
```

La app crea el job antes de llamar a la extension. La extension devuelve job_id.
El backend guarda el resultado usando job.empresa_id, nunca usando la empresa
activa actual.

## 12. Restriccion SII: Una Emision Real A La Vez

Restriccion critica: el SII puede bloquear o exigir validaciones si se emite al
mismo tiempo desde distintas IPs o computadores.

Regla final:

```text
Una emision SII real activa a la vez por cuenta pagadora.
```

Cuando una persona inicia una emision real con extension, el boton Emitir se
bloquea para todos los usuarios de la cuenta hasta que esa emision termine,
falle o expire.

El equipo puede seguir:

- Subiendo documentos.
- Revisando propuestas.
- Editando clientes.
- Navegando dashboard.
- Preparando lotes.
- Usando historial.

El equipo no puede:

- Iniciar otra emision real.
- Emitir desde otro computador.
- Emitir desde otra sesion del equipo.

Alcance del bloqueo para MVP:

```text
1 emision activa por cuenta pagadora completa.
```

No solo por empresa. Esto es mas conservador y protege contra bloqueos del SII.
Despues se puede optimizar a 1 emision activa por credencial SII, pero no en el
MVP.

UI cuando esta bloqueado:

```text
Juan esta emitiendo desde su computador.
Puedes seguir revisando, pero la emision esta bloqueada hasta que termine.
```

Boton:

```text
Emitir bloqueado
```

Estados a propagar por realtime:

| Estado | Texto |
|---|---|
| Iniciando | Juan esta abriendo SII |
| Esperando PIN/login | Juan debe desbloquear la extension |
| Emitiendo | Juan esta emitiendo |
| Guardando resultado | Guardando folio en MassDTE |
| Terminado | Se libera boton |
| Fallo | Se libera boton con aviso |
| Expiro | Se libera automaticamente |

Arquitectura del candado:

```text
emision_locks
- cuenta_id
- empresa_id
- usuario_id
- job_id
- proveedor
- estado
- started_at
- heartbeat_at
- expires_at
```

El backend debe bloquear. La UI sola no basta. Si alguien intenta emitir por API
mientras hay lock activo, responder:

```json
{
  "error": "EMISION_BLOQUEADA",
  "detalle": "Juan esta emitiendo desde otro computador. Intenta cuando termine."
}
```

La extension debe mandar estados/heartbeat mientras trabaja. Si no hay heartbeat
por varios minutos, mostrar emision posiblemente detenida y liberar solo con
vencimiento seguro.

## 13. SimpleAPI Local Y Folios CAF

SimpleAPI local es mas delicado porque la extension guarda certificado, CAF,
RUT emisor y folios locales.

En multiusuario, dos personas podrian tener el mismo CAF cargado en dos
computadores. Si emiten al mismo tiempo o si una extension tiene contador local
desactualizado, puede haber choque de folios.

Regla:

- SimpleAPI local tambien debe respetar el lock global de emision por cuenta.
- A futuro debe existir reserva central de folios.

Tabla sugerida:

```text
folio_reservas
- empresa_id
- tipo_dte
- folio
- job_id
- estado
```

La app reserva folio antes de generar XML. La extension usa ese folio reservado.
Nunca se debe decidir el folio solo desde chrome.storage cuando hay equipo o
multiempresa.

## 14. Entitlements Y Gating

Debe existir una capa central src/lib/entitlements.ts.

Debe resolver desde cuenta pagadora:

- Plan activo.
- Empresas incluidas.
- Personas incluidas.
- Add-ons activos.
- Cupo de boletas desde cartolas.
- Cupo Telegram.
- Si puede usar Business features.
- Si puede agregar empresa.
- Si puede agregar persona.
- Si puede usar equipo.
- Si puede usar Telegram.
- Si puede emitir.

Gating importante debe ser backend. La UI puede ocultar botones, pero no puede
ser la unica barrera.

Bloquear server-side:

- Agregar empresa.
- Agregar persona.
- Procesar Telegram si no tiene cupo.
- Emitir desde cartolas si no tiene cuota.
- Iniciar emision real si hay lock activo.
- Entrar a empresa inactiva/no pagada.
- Reportes Business si no corresponde.

## 15. Pagina De Planes

La pagina de planes debe vender a personas que no quieren contador ni perder
tiempo.

No usar en pagina publica:

- DTE
- API
- multi-RUT
- boletas masivas
- entitlements
- cuota_masivas
- endpoints
- jerga tributaria

Usar:

- Empresa
- Boletas desde cartolas
- Boletas manuales
- Comprobantes por Telegram
- Equipo
- Historial
- Reportes

Cards publicas:

| Start | Pro | Business |
|---|---|---|
| Para probar | Para negocios que emiten seguido | Para varias empresas o equipo |
| 1 empresa | 1 empresa | 1 empresa |
| 1 persona | 1 persona | 1 persona |
| 300 boletas desde cartolas | 1.000 boletas desde cartolas | 3.000 boletas desde cartolas |
| Boletas manuales ilimitadas | Boletas manuales ilimitadas | Boletas manuales ilimitadas |
| Historial basico | Historial completo | Historial completo |
| Sin Telegram | 100 comprobantes por Telegram | 500 comprobantes por Telegram |
| Sin equipo | Sin equipo | Equipo en tiempo real |
| Sin multiempresa | Sin multiempresa | Empresas extra disponibles |

## 16. Orden De Implementacion

Orden recomendado:

1. Crear cuentas, cuenta_empresas, cuenta_usuarios y cuenta_addons.
2. Backfill desde datos actuales.
3. Crear entitlements.ts.
4. Adaptar billing para leer desde cuenta pagadora.
5. Mantener compatibilidad con empresas.plan durante migracion.
6. Crear selector de empresa arriba izquierda.
7. Crear server action cambiarEmpresaActiva(empresaId).
8. Agregar contadores de boletas desde cartolas y Telegram.
9. Agregar gating server-side por plan/add-ons.
10. Crear panel Equipo solo Business en columna izquierda.
11. Agregar presencia realtime.
12. Crear emision_jobs.
13. Crear emision_locks global por cuenta.
14. Adaptar /api/sii-local/result y /api/simpleapi/result para usar job.empresa_id.
15. Adaptar extension/app bridge para preservar job_id y estados.
16. Agregar bloqueo realtime de emision para todo el equipo.
17. Adaptar Telegram Business multiempresa con pregunta de empresa antes de OCR.
18. Agregar reserva central de folios para SimpleAPI local.

## 17. Principios Que No Deben Romperse

- Boleta manual es gratis e ilimitada.
- Telegram no consume cuota de boletas desde cartolas.
- Business no regala empresas/personas extra si seran add-ons.
- Equipo no muestra roles visibles.
- Todos los miembros del equipo tienen control total.
- El panel Equipo solo aparece en Business.
- Una emision SII real a la vez por cuenta.
- El resultado de extension se guarda por job_id, no por empresa activa actual.
- No compartir claves SII ni certificados entre usuarios desde nuestros servidores.
- El backend siempre debe validar plan, acceso, cupo y locks.
- Cada empresa sigue siendo su mundo.
