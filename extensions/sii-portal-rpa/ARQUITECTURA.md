# Motor Local SII — Arquitectura, contrato y mantenimiento

Extensión Chrome que **emite boletas electrónicas reales en el portal e-Boleta
del SII en nombre del contribuyente**, como una _delegación automatizada_ del
usuario. Es el mismo objetivo que una API REST (ej. BaseAPI/SimpleAPI): el
usuario delega la emisión y el sistema la ejecuta y la registra. La diferencia
es el _medio_: aquí se automatiza el portal oficial del SII (no hay API pública
de emisión de boletas para el contribuyente común), replicando exactamente los
clics que haría una persona, en una ventana visible y auditable.

> **Probado en producción real**: boletas exentas de $1 emitidas y aceptadas en
> el SII (folios 47 y 49, empresa 77.002.244-4, 2026-06-10).

---

## 1. Principio de confianza (lo más importante)

El cliente confía en que la app hace las cosas bien. La regla de oro:

> **Una boleta emitida en el SII SIEMPRE queda registrada en la app. Nunca se
> pierde un folio.**

Jerarquía de riesgo (de peor a mejor):

1. **PEOR — folio emitido en el SII pero invisible en la app.** El contribuyente
   le debe ese documento al SII y su sistema no lo sabe → descuadre, multa,
   pérdida de confianza. **Esto nunca debe pasar.**
2. Malo — boleta marcada en la app pero no emitida en el SII (falso positivo).
3. Correcto — emitida + registrada + PDF de respaldo.

Por eso: **el folio con evidencia fuerte ES la prueba de emisión y basta para
registrar la boleta.** El PDF es un respaldo adjuntable/reintentable, **nunca**
un requisito para reconocer la emisión. (Antes el PDF bloqueaba el registro: un
403 al bajar el PDF dejaba folios reales fuera del sistema — corregido.)

---

## 2. Flujo end-to-end

```
App (massdte / boleta única)
  │  window.postMessage  APP_CONTABLE_SII_BOLETA_JOB { tipo_dte, monto, glosa,
  │                       receptor?, payment_method, emisor_rut, ... }
  ▼
app-bridge.js (content script en la app, allowlist de origin/tipos)
  │  chrome.runtime.sendMessage
  ▼
background.js (service worker)
  │  abre ventana popup → eboleta.sii.cl  (SII_START_URL)
  ▼
sii-worker.js (content script en sii.cl) + sii-notif-suppress.js (MAIN world)
  │  1. autologin con la bóveda (PIN) — o login manual si hay captcha/2FA
  │  2. calculadora: teclea el monto
  │  3. abre modal "Emitir e-Boleta"
  │  4. selecciona Sucursal + Tipo (afecta/exenta) + Método de pago
  │  5. EMITIR final
  │  6. captura folio (+ PDF best-effort)
  ▼
background.js handleCapturedResult
  │  APP_CONTABLE_SII_JOB_RESULT { folio, evidencia, pdf? }
  ▼
app-bridge.js  →  POST /api/sii-local/result
  ▼
Supabase: boletas_emitidas (registro) + documentos_subidos + sii_local_resultados (log)
```

---

## 3. Capas de redundancia (por qué el cliente puede confiar)

Cada paso tiene un plan B; ninguna falla aislada pierde la boleta:

| Paso | Plan A (automático) | Plan B (redundancia) |
|---|---|---|
| Login SII | Autologin con bóveda cifrada (PIN) | Login manual en la ventana; el bot continúa solo al entrar a e-Boleta |
| Prompt notificaciones | `sii-notif-suppress.js` lo anula | `--deny-permission-prompts` (en pruebas) |
| Bóveda bloqueada | El usuario ingresa PIN → el bg **reanuda** el job (`resumeJobsAfterSiiUnlock`) | Login manual |
| Empresa equivocada en el portal | `assertEmisorRut` bloquea y avisa | El usuario cambia la empresa y reintenta |
| Sucursal/tipo/pago no seleccionados | El bot los elige (`selectVuetifyOption`, `selectFirstVuetifyOption`) | Si pago no se logra, aborta antes del EMITIR (no emite formulario inválido) |
| Captura de folio | Lee de la pantalla post-emisión y de `/reportes` | "Capturar folio" / "Guardar folio visible" manual en la app |
| Captura de PDF (403, etc.) | `capturePdfBytes` best-effort | Boleta igual se registra (`pdf_pendiente`); "Guardar último PDF SII" manual; reintento futuro |
| **Reconciliación final** | — | **Cross-check contra el Resumen de Ventas (RCV) del SII**: cualquier folio en el RCV que no esté en la app se detecta y respalda (ver §6). Es la red de seguridad definitiva. |

---

## 4. Seguridad de credenciales

- La **clave tributaria** y el **certificado** se guardan **cifrados localmente**
  (AES-GCM 256, clave derivada con PBKDF2-SHA256, 250k iteraciones) en
  `chrome.storage.local`. Nunca salen del equipo del usuario ni llegan a
  nuestros servidores.
- El desbloqueo (PIN para SII, passphrase ≥10 para SimpleAPI) vive **solo en
  memoria** con TTL de 10 min; se pierde al cerrar el navegador (por diseño).
- Bóveda SII: PIN 4–8 dígitos + **rate-limit** (5 intentos fallidos → 5 min de
  espera) contra fuerza bruta.
- `app-bridge.js` solo acepta mensajes de orígenes permitidos
  (`app-contable-five.vercel.app` o localhost) y un set cerrado de tipos.
- Guardar/desbloquear la bóveda solo se puede desde la página de opciones de la
  extensión (`sender.url` debe ser la propia extensión); una web nunca puede.

---

## 5. Qué actualizar si el SII cambia el portal (mantenimiento)

El portal e-Boleta es un SPA Vue/Vuetify. Si el SII cambia su HTML, los puntos a
revisar están **todos en `sii-worker.js`**, aislados en funciones pequeñas:

| Si cambia… | Función a ajustar |
|---|---|
| URL de inicio | `SII_START_URL` (en `modules/sii-local.js`) |
| Formulario de login (campos RUT/clave, botón) | `findRutInput`, `findPasswordInput`, `findLoginSubmit`, `attemptAutologin` |
| Detección de captcha/2FA | `hasHumanChallenge` (lista de palabras) |
| Botón EMITIR / teclado numérico de la calculadora | `scanWorkerPage` (detección `hasEmitButton`/`hasNumberPad`), `fillAndEmit` |
| Selects del modal (sucursal, tipo, método de pago) | `selectVuetifyOption`, `selectFirstVuetifyOption` (buscan por texto del slot + opción del `.v-menu__content`) |
| Toggles Receptor/Detalle | `setDialogToggle` / `findToggleRow` |
| Texto del folio ("BOLETA ELECTRÓNICA NÚMERO: N") | `captureExplicitFolio` (regex) |
| Tabla de `/reportes` (respaldo de folio) | `captureReportTableFolio`, `captureReportTextFolio` |
| URL del PDF (S3) | `capturePdfArtifactFolio`, `extractPdfUrl` (bg), `isAllowedSiiPdfUrl` (route) |
| Prompt de notificaciones | `sii-notif-suppress.js` |

**Estrategia anti-cambios**: la detección es por **texto visible y roles**
(no por selectores CSS frágiles) siempre que se puede. El "modo aprendizaje"
(`learn_only`) permite que la extensión observe el portal y envíe mapas
sanitizados de la página (`scanPage` → `/api/sii-local/page-map`) para
re-calibrar selectores sin emitir. **Úsalo primero cuando algo se rompa.**

### Cómo diagnosticar sin emitir
- `scripts/sii-modal-inspect.mjs [puerto] [PIN] [emisorRUT]` — abre el modal y
  vuelca su DOM real (botones, selects, inputs) **sin emitir**.
- `scripts/sii-verify.mjs` — abre el Resumen de Ventas (solo lectura) para
  confirmar qué se emitió de verdad.
- `scripts/sii-real-drive.mjs [puerto] [PIN] [emisorRUT]` — corre el flujo
  completo y registra toda la conversación app↔extensión.
- (El PIN/RUT van por argumento; no se guardan en los archivos.)

---

## 6. Reconciliación con el RCV (red de seguridad pendiente de cablear)

La defensa definitiva contra "folio emitido pero no registrado": leer
periódicamente el **Resumen de Ventas diarias** del SII (que la extensión ya
sabe abrir) y comparar contra `boletas_emitidas`. Cualquier folio presente en el
SII y ausente en la app se respalda automáticamente. Esto cubre:
- Boletas que el contador emitió a mano directo en el SII.
- Capturas que fallaron (folio quedó en el SII pero no llegó a la app).

Estado: la lectura del RCV existe (`sii-verify.mjs` la hace); falta el job de
conciliación automático que la compare y haga backfill.

---

## 7. MassDTE (escala)

La boleta única valida el flujo de a una. En modo masivo, la misma cola de jobs
emite N boletas secuencialmente en la ventana segura. Requisitos para escalar
con confianza:
- **Idempotencia**: cada job lleva `job_id`; `boletas_emitidas` deduplica por
  `(empresa, tipo_dte, folio)`. Reintentar un job no duplica.
- **Folios correlativos**: el SII asigna el folio; la app no lo inventa. El RCV
  es la fuente de verdad de qué folios existen.
- **Reconciliación RCV** (§6) corre al final del lote: garantiza que los N
  folios emitidos quedaron los N en la app.
- **Pausa segura**: ante captcha/2FA/empresa equivocada, el lote pausa y pide
  intervención; no sigue a ciegas.

---

## 8. Pendientes conocidos

- **PDF 403**: tras emitir, bajar el PDF desde `eboleta.s3.amazonaws.com` puede
  dar 403 (el PDF puede no estar listo hasta estado "Aceptada"). La boleta se
  registra igual (`pdf_pendiente: true`). Fix futuro: reintentar tras "Aceptada"
  o usar el botón "Descargar" del modal en vez del fetch crudo a S3.
- **Glosa (toggle Detalle)**: activar ese toggle bloquea el EMITIR de forma
  intermitente; desactivada por defecto (flag `job.write_glosa`). El método de
  pago sí funciona.
- **Reconciliación RCV automática** (§6): falta cablear el job.
