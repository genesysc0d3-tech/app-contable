# Runbook — «El SII cambió algo en el portal» (RPA boletas / facturas)

Meta: de síntoma a fix en MINUTOS. Este doc es la fuente; la memoria solo apunta acá.
Última verificación contra código: 2026-09-10 (ext 0.2.3 → 0.2.4, libreto schema v1).
Nació de 6 revisiones adversariales + el incidente «glosa muda» (280 boletas reales
sin el texto pedido; nos enteramos por un cliente, no por el sistema).

## Reglas de oro (no negociables)

- JAMÁS clickear el EMITIR final del modal e-Boleta ni «Firmar» en facturas a mano.
- Pruebas SIEMPRE bajo el emisor **MV INVERSIONES 77.155.156-4** (login SII 19427394-0,
  cuenta de Matías), montos chicos ($1.000). Nunca AlphaCode.
- La app puede estar bien y el bug ser 100 % del worker: mirar la **caja negra ANTES**
  de tocar código.
- Este runbook NO toca Supabase con DDL → no hace falta respaldo del mini ni SSH.
- No navegar el SII por automatización (WAF «Request Rejected»): el fundador abre la
  pestaña a mano; después se lee/inspecciona.
- Si hay pausa activa (kill switch), levantarla SOLO cuando §4/§5 esté verificado.

---

## 0. Síntoma → por dónde llega

| Llega por | Qué mirar primero |
|---|---|
| Queja de cliente («no emite», «sale sin detalle», «se queda pegado») | §1 Q1+Q2 con el nombre de su empresa |
| Panel `/dev/diagnostico`, bloque «Portal SII» | §1 Q1 — ya dice ancla / carril / versión / `code` |
| Alerta Telegram/correo «El portal del SII probablemente cambió» (≥2 empresas en 24 h) | §1 Q1 y salta a §2. Con la alerta puede venir una **pausa automática** del carril (2 h): revisar la tarjeta «Pausa de emisión» en /dev |
| Boleta emitida pero «muda» (glosa/receptor) | §1 Q3 (`GLOSA_OMITIDA` / `RECEPTOR_OMITIDO`) |

Mapa de la caja negra (dónde escribe cada cosa):

- `ops_events` source=`sii-local`, event=`sii_local_posible_cambio_ancla` ← ancla estructural
  que NO apareció, PRE-emit (worker → background → app-bridge → `api/sii-local/cambio-sii`).
  `metadata`: `ancla`, `portal`, `code`, `paso`, `error` (60c), `page_kind`, `mapa` (foto
  saneada del DOM, ≤2 KB), `libreto_version`, `extension_version`, `posible_cambio_sii`.
- `ops_events` source=`emision`, event=`emission_job_failed|revision_pendiente` ← motivo que
  PATCHea el cliente al cerrar (depende de que la pestaña de la app siga viva). También
  `emision_jobs.status_message`.
- `ops_events` source=`sii-local`, `GLOSA_OMITIDA` / `RECEPTOR_OMITIDO` (warn) ← boleta que
  SÍ salió pero sin el texto/receptor pedido. `sii_local_result_failed|warning|emisor_mismatch|
  doble_folio_propuesta` ← POST-emit.
- `ops_events` `emision_pausa_on/off` ← kill switch (manual o auto).
- `sii_local_resultados` (**se borra a los 7 días** por usuario): `status`, `error`, `folio`,
  `result.glosa_omitida`, `result.receptor_omitido`, `result.folio_confidence`.
  `result.page.excerpt` viene **CENSURADO** (`[redacted:N]`): no sirve para diagnosticar.
- page-map: **NO existe en prod** (memoria de instancia, apagado). No buscarlo.

---

## 1. DETECTAR en 2 minutos (queries a prod, solo lectura)

Setup (una vez por sesión; NUNCA imprimir el token; curl, no python — Cloudflare bloquea el UA):

```bash
cd /Users/take/Desktop/app-contable
TOKEN=$(cat .supabase/token)
q() { curl -s -X POST "https://api.supabase.com/v1/projects/xncnfrwarcrzgldalkzz/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "$(jq -cn --arg q "$1" '{query:$q}')"; }
```

### Q1 — ¿Qué ancla falló, en qué carril, desde cuándo, cuántas empresas? (48 h)

```bash
q "SELECT metadata->>'ancla' AS ancla, metadata->>'portal' AS carril, metadata->>'code' AS code,
          metadata->>'extension_version' AS ext, metadata->>'libreto_version' AS libreto,
          count(*) AS eventos, count(DISTINCT empresa_id) AS empresas,
          min(created_at) AS desde, max(created_at) AS ultimo,
          array_agg(DISTINCT left(metadata->>'error',60)) AS errores
   FROM ops_events
   WHERE event_name='sii_local_posible_cambio_ancla' AND created_at > now()-interval '48 hours'
   GROUP BY 1,2,3,4,5 ORDER BY ultimo DESC;"
```

Lectura: `ancla` = rol del libreto (tabla en §2). `empresas ≥ 2` con la misma ancla y la misma
`ext` = casi seguro el SII. `empresas = 1` = puede ser esa cuenta (sesión, permiso,
multiempresa). Si `ext` es distinta entre empresas y solo una falla → incompatibilidad de
versión, no el SII. Para ver la foto del DOM del último evento:
`q "SELECT metadata->'mapa' FROM ops_events WHERE event_name='sii_local_posible_cambio_ancla' ORDER BY created_at DESC LIMIT 1;"`

### Q2 — Fallos NO estructurales + jobs con lápida (48 h)

```bash
q "SELECT e.created_at, e.event_name, e.empresa_id, left(e.metadata->>'motivo',160) AS motivo,
          e.metadata->>'code' AS code, j.estado, left(j.status_message,160) AS status_message
   FROM ops_events e LEFT JOIN emision_jobs j ON j.job_id = e.resource_id
   WHERE e.source IN ('emision','sii-local')
     AND e.event_name IN ('emission_job_failed','emission_job_revision_pendiente',
                          'sii_local_result_failed','sii_local_emisor_mismatch','doble_folio_propuesta')
     AND e.created_at > now()-interval '48 hours'
   ORDER BY e.created_at DESC LIMIT 40;"
```

Acá salen los `siiError` sin ancla («Cliqué EMITIR pero el SII no confirmó…») y los
`human:true` de facturas (`EMISOR_NO_AUTORIZADO`, `GIRO_RECEPTOR_REQUERIDO`,
`FORMULARIO_INCOMPLETO`, `TOTAL_MISMATCH`). Si el motivo es de DATO del cliente, NO es
cambio del SII.

### Q3 — Emisiones que SÍ salieron pero mudas, y versión por empresa

```bash
q "SELECT created_at, empresa_id, event_name, metadata->>'folio' AS folio, metadata->>'tipo_dte' AS tipo
   FROM ops_events WHERE event_name IN ('GLOSA_OMITIDA','RECEPTOR_OMITIDO')
     AND created_at > now()-interval '7 days' ORDER BY created_at DESC LIMIT 40;"
q "SELECT id, rut, razon_social, ext_last_version, ext_last_seen_at FROM empresas
   WHERE razon_social ILIKE '%<nombre>%' OR rut ILIKE '77155156%' OR rut ILIKE '77.155.156%';"
q "SELECT folio, tipo_dte, fecha_emision, detalles->0->>'nombre' AS glosa
   FROM boletas_emitidas WHERE empresa_id='<uuid>' ORDER BY created_at DESC LIMIT 12;"
```

Si `boletas_emitidas.detalles` trae la glosa correcta → la APP hizo su parte; el bug es del
WORKER. Flota por versión: `/dev/diagnostico` → «Flota por versión» (o
`SELECT ext_last_version, count(*) FROM empresas WHERE ext_last_seen_at > now()-interval '30 days' GROUP BY 1`).

---

## 2. CLASIFICAR: ¿DATO (libreto) o MOTOR (extensión)?

Pregunta única: **¿el arreglo es cambiar un NOMBRE/TEXTO/SELECTOR/ESPERA, o cambiar CÓMO se hace?**

```
¿Q1 trae ancla?
 ├─ SÍ → ¿el ancla es un campo del libreto (tabla abajo)?
 │        ├─ SÍ y el portal muestra el MISMO control con OTRO nombre/texto/clase Vuetify
 │        │     → DATO → §4   (OJO: el valor nuevo debe pasar la whitelist de la extensión;
 │        │        si no pasa, es MOTOR aunque parezca dato)
 │        ├─ SÍ pero el control DESAPARECIÓ o cambió de lugar/flujo (paso nuevo, otro modal) → MOTOR → §5
 │        └─ «page_kind:unknown» / «botones.emitir» con code PANTALLA_SIN_EMITIR
 │              → el portal cambió de página; mirar el `mapa` del evento y el DOM (§3) y decidir
 └─ NO (falla silenciosa o motivo genérico en Q2/Q3)
          ├─ cambió un texto que el worker matchea → DATO si está en el libreto; MOTOR si es
          │    de los hardcodeados (lista abajo)
          └─ timing (el SII se puso lento, animación nueva) → `esperas.*` del libreto → DATO;
               loop fijo del worker → MOTOR
```

### Anclas de BOLETAS (`ANCLA_LABELS_BOLETA` en `src/lib/emission/sii-libreto.ts`)

| ancla | code (`siiError` en `sii-worker.js`) | campo del libreto |
|---|---|---|
| `botones.emitir` | `PANTALLA_NO_LISTA`, `PANTALLA_NO_LISTA_POST_EMISOR`, `SIN_BOTON_EMITIR_MODAL`, `PANTALLA_SIN_EMITIR` (background, 0.2.4) | `botones.emitir` |
| `selectores.emisor_select` | `SELECTOR_EMISOR_AUSENTE` | `selectores.emisor_select` (whitelist Vuetify) |
| `selectores.menu` | `LISTA_EMPRESAS_NO_ABRE` | `selectores.menu` |
| `selectores.dialogo_activo` / `modal.titulo` | `MODAL_NO_ABRE`, `MODAL_CERRADO_PRE_EMIT` | `selectores.dialogo_activo`, `modal.titulo` (0.2.4) |
| `slots.sucursal` | `SUCURSAL_NO_SELECCIONADA` (0.2.4) | `slots.sucursal` |
| `slots.tipo` | `TIPO_NO_CONFIRMADO` | `slots.tipo/tipo_afecta/tipo_exenta` (+ invariante en código: «EXENTA» ⇔ tipo 41) |
| `slots.metodo_pago` | `PAGO_NO_SELECCIONADO` | `slots.metodo_pago/_alt/_default` |
| `glosa` | `GLOSA_OMITIDA` en Q3 (no aborta) | `toggles.detalle`, `glosa.*` (0.2.4) |
| `receptor_campos.rut` | `RECEPTOR_NO_ESCRITO` (0.2.4, aborta pre-emit) | `receptor_campos.*` |

### Anclas de FACTURAS (`ANCLA_LABELS`)

| ancla | error (`facturas-worker.js`) | campo del libreto |
|---|---|---|
| `campos.emisor_select` | `SELECTOR_SIN_RUT_EMP` | `campos.emisor_select` |
| `selectores.submit_empresa` | `SELECTOR_SIN_SUBMIT` | `selectores.submit_empresa` |
| `campos.tipo_verif` | `TIPO_PORTAL_MISMATCH` con código vacío | (0.2.4: la compuerta lee `PTDC_CODIGO` FIJO en código; el libreto ya no manda ahí) |
| `campos.boton_validar` | `SIN_BOTON_VALIDAR` | `campos.boton_validar` |
| `page_kind:unknown` | `PAGINA_DESCONOCIDA` (0.2.4) | `forms.*` y `detectores.*` |

Ejemplos DATO (deploy, minutos): el SII renombra `Button_Update` → `btnValidar`; el toggle
pasa de «Detalle» a «Descripción»; el modal deja de decir «Boleta afecta» y dice «Afecta».

Ejemplos MOTOR (release): el SII agrega un paso nuevo (captcha, confirmación extra); cambia
el flujo de páginas de facturas; el contador «/ 80» desaparece del campo de glosa; la
confirmación post-emit ya no habilita IMPRIMIR/DESCARGAR; Vuetify cambia de clases fuera
de la whitelist (`modules/sii-local.js`).

**Se quedan como CÓDIGO sí o sí** (bajarlos al libreto = emitir mal con un typo): dónde se
lee el RUT emisor activo, el candado anti-doble-folio, `TOTAL_MISMATCH`/`tipo_verif` de
facturas, la evidencia del folio, el botón «SÍ» del monto alto, `hasHumanChallenge`
(captcha/2FA), el orden de pasos y los reintentos.

---

## 3. REPRODUCIR sin emitir (cuenta MV + perilla + pestaña)

Datos de prueba: login SII **19427394-0** → emisor en la barra gris **MV INVERSIONES
77.155.156-4**. En la app, la empresa ACTIVA debe tener `rut = 77.155.156-4` (verificar con
la query de §1) — si la empresa activa es AlphaCode, `assertEmisorRut` aborta fail-closed y
vas a creer que el bug es otro.

### Trampas del ENSAYO EN VIVO que costaron horas (2026-09-11) — LEER PRIMERO
- **El selector de empresa en la app es el LOGO** (clic en el logo arriba a la izquierda),
  NO un dropdown aparte. El header muestra "AlphaCode" como MARCA del producto aunque la
  empresa activa sea otra: **la verdad es `usuarios.empresa_id` en la base** (query de §1),
  no lo que se ve en el header.
- **eBoleta se entra con el RUT NATURAL** (persona, 19427394-0), y DENTRO se elige la
  empresa JURÍDICA que administras (MV) como emisor en la barra gris. El **receptor** es
  otra cosa (el cliente de la boleta).
- **Para verlo con MCP (los ojos de Claude): Claude abre la pestaña de `eboleta.sii.cl`
  en SU grupo MCP ANTES de disparar; el worker en modo pestaña la REUTILIZA** (bloque debug
  en `background.js openWorkerWindow`: `chrome.tabs.query({url})` engancha la abierta en vez
  de crear una nueva afuera del grupo). Requisito: `FACT_WORKER_EN_PESTANA = true` Y recargar
  la extensión DESPUÉS de ese cambio (recargar antes no toma el flag).
- **Confirmar el ensayo SIN ver la pestaña = la caja negra**: comparar el desenlace. Ej: un
  freno con falso positivo fallaba en ~30 s con su `code`; con el fix, el job corre minutos
  SIN ese `code`. `boletas_emitidas` en 0 es el candado.
- **Job pegado tras un ensayo**: con `allow_final_emit=false` el job queda `running`; la app
  avisa "emisión SII sin resolver" y ofrece **"cancelarla"** (link en el aviso) — cancelar
  antes de re-disparar. El lock (`locked_until`) expira solo a los ~5 min.

### ⚠️ PATRÓN RECURRENTE: el label flotante de Vuetify rompe los guards `controlText`
Vuetify FLOTA el label fuera del innerText cuando el campo TIENE VALOR. Cualquier guard que
haga `controlText(input).includes("...")` o busque un campo por su texto **DESPUÉS de
escribirle** falla. Ya mordió DOS veces: la **glosa muda** (2026-06→09) y el **receptor**
(`RECEPTOR_RUT_NO_ACEPTADO` falso, 2026-09-11, que abortaba TODA boleta con receptor). Regla:
**nunca re-buscar un campo Vuetify por texto tras escribirle — guardar la referencia del
elemento y releer `.value` de ESE elemento.** El fixture del test debe simular el flotado
(label ausente con valor) o el bug pasa en verde.

1. Rama: `git checkout dev && git pull && git checkout -b fix/sii-<ancla>`.
2. Dev server limpio con la sesión del fundador (puerto **3000**; el 3001 rebota a prod):
   `rm -rf .next && npm run dev` (Turbopack sirve bundle rancio si no).
3. Extensión UNPACKED cargada desde `extensions/sii-portal-rpa/` en `chrome://extensions`.
   La versión que muestra debe ser la de `manifest.json`.
4. Modo pestaña: en `background.js`, `const FACT_WORKER_EN_PESTANA = false;` → `true`.
   Luego `chrome://extensions` → ⟳ recargar (sin esto sigue en ventana invisible).
   **Hay un test que muerde si queda en `true`** (`background-flags.test.js`): revertir antes de commitear.
5. Perilla de ensayo en la pestaña de la app (localhost:3000), consola:
   - boletas: `localStorage.setItem("massdte:boleta-ensayo","1")` → `allow_final_emit=false`;
     el worker llena TODO (glosa/receptor incluidos) y frena en «Formulario listo. Falta
     autorización explícita».
   - facturas: `localStorage.setItem("massdte:fact-ensayo","1")` → `learn_only:true`; frena
     pre-Validar y pre-Firmar.
6. **CHECK OBLIGATORIO antes de apretar Emitir** (la vez pasada el bundle viejo emitió de
   verdad). En la MISMA consola de la app:
   ```js
   window.addEventListener("message", e => {
     const d = e.data; if (d?.source !== "app-contable" || !/JOB$/.test(d.type||"")) return;
     console.log("JOB →", d.type, "allow_final_emit =", d.job?.allow_final_emit,
                 "learn_only =", d.job?.learn_only, "libreto v", d.job?.libreto?.libreto_version);
   });
   ```
   Debe imprimir `allow_final_emit = false` (boletas) o `learn_only = true` (facturas). Si
   sale al revés: NO SIGAS — bundle rancio o perilla no aplicada; repite 2 y 5.
7. Montos $1.000 bajo MV. Si igual se emitiera, es una boleta chica de Matías (NC manual).
8. Emitir desde la app. El portal abre como pestaña → aparece en `tabs_context` del MCP →
   inspeccionar (leer no dispara el WAF; NO navegar por script).

Qué mirar en el DOM del modal e-Boleta (consola de la pestaña del worker):

```js
const dlg = [...document.querySelectorAll(".v-dialog.v-dialog--active")].find(d => /Emitir\s+e-Boleta/i.test(d.innerText));
dlg?.innerText                                                                            // título, labels
[...dlg.querySelectorAll(".v-input")].map(i => i.innerText.replace(/\s+/g," ").slice(0,80)) // la glosa muestra "0 / 80"
[...dlg.querySelectorAll("button")].map(b => [b.innerText.trim(), b.disabled])            // EMITIR final, IMPRIMIR/DESCARGAR
[...dlg.querySelectorAll(".v-input--selection-controls, .v-input--switch")].map(r => r.innerText.trim()) // toggles
```

Trampas: (1) probar con el campo VACÍO — con valor, Vuetify flota el label y sale del
innerText; (2) `normalizeSearchText` devuelve MAYÚSCULAS sin tildes: compara así; (3) los
v-menu se montan en el body, fuera del modal (`.v-menu__content`); (4) las funciones del
worker NO están en `window`: en DevTools cambia el contexto (selector arriba a la izquierda)
al de la extensión «MassDTE — Motor Local» y ahí sí existen `findGlosaInput()`,
`activeEmitDialog()`, `readActiveEmisorRut()`.

Facturas (HTML clásico): `document.forms` → `fPrmEmpPOP` / `VIEW_EFXP` / `PreViewDTE`;
`document.querySelector('form[name=VIEW_EFXP]').elements` → `name=` de campos (`EFXP_*`).

9. Al terminar: `localStorage.removeItem("massdte:boleta-ensayo")` / `fact-ensayo`; el job de
   ensayo queda vivo en `activeJobs`+stash (modal «EMITIENDO» pegado) — esperable, la base no
   se corrompe.

---

## 4. ARREGLAR por LIBRETO (dato → deploy, minutos)

1. Editar SOLO `src/lib/emission/sii-libreto.ts`. **Reglas duras** (están en el header del archivo):
   - NUNCA subir `libreto_version` ni quitar/renombrar claves: la extensión 0.2.1+ RECHAZA
     el job entero (`LIBRETO_SCHEMA_UNKNOWN` / `*_MISSING`) y apaga la flota. Solo AGREGAR.
   - Boletas: un selector nuevo debe pasar la whitelist Vuetify (`modules/sii-local.js`);
     facturas: un campo nuevo debe pasar `LIBRETO_CAMPO_RE` (`modules/facturas-portal.js`).
     Si no pasa → es MOTOR (§5).
   - `tipo_afecta` ≠ `tipo_exenta` y solo la exenta dice «EXENTA»; `limpiar_pad` sin dígitos;
     `forma_pago` = {1,2}. El validador de la extensión rechaza lo demás.
   - Si el ancla cambió de nombre, actualizar `ANCLA_LABELS*` para que /dev lo traduzca.
2. Tests que muerden:
   ```bash
   npx vitest run src/lib/emission extensions/sii-portal-rpa
   ```
   `libreto-compat-flota.test.ts` valida el libreto contra el validador de CADA versión
   publicada (`extensions/sii-portal-rpa/EXTENSION_RELEASES.json`). `boletas-sintetico` y
   `facturas-sintetico` tienen un MUERDE por ancla: si el DOM del SII cambió, ajustar el
   fixture (`fixtures/`) a lo visto en §3 — el test debe FALLAR con el libreto viejo y PASAR
   con el nuevo. Un test que no falla nunca no vale.
3. Reproducir en ensayo (§3) con el libreto nuevo (viaja en cada job; verlo en el check del paso 6).
4. Workflow: commit → PR a dev → merge → PR dev→main (merge commit) → esperar READY en Vercel.
   Commits firmados como genesysc0d3 (si va como clau queda BLOCKED).
5. Confirmar en caja negra (30-60 min después, o pidiéndole a un cliente que reintente):
   ```bash
   q "SELECT count(*) FILTER (WHERE created_at > '<hora deploy>') AS despues, count(*) AS total
      FROM ops_events WHERE event_name='sii_local_posible_cambio_ancla'
        AND metadata->>'ancla'='<ancla>' AND created_at > now()-interval '24 hours';"
   ```
   `despues = 0` y resultados `persisted` sin `GLOSA_OMITIDA` = los clientes ya emiten OK.
   Un deploy NO exige que el cliente actualice nada: el libreto viaja en cada job.
6. Si había pausa (kill switch): levantarla en /dev → «Pausa de emisión».

---

## 5. ARREGLAR por EXTENSIÓN (motor → release)

Solo si §2 dio MOTOR. La extensión es UNA (boletas Y facturas): todo lo pendiente sube junto
en una sola versión (Google bloquea la siguiente con `ITEM_NOT_UPDATABLE` mientras revisa).
Mientras tanto, si el carril está roto para todos: **activar la pausa** en /dev (con
`excepto_empresas` = MV para poder probar).

1. Fix en `sii-worker.js` / `facturas-worker.js` / `background.js` + test sintético que
   muerda (fixture con el DOM nuevo).
2. Revertir perillas: `FACT_WORKER_EN_PESTANA = false` (el test lo exige).
3. `npx vitest run` completo (`version-sync.test.js` obliga a sincronizar la versión en los
   4 archivos: `manifest.json`, `manifest.prod.json`, `modules/core.js`, `src/lib/extension.ts`).
4. **3 subagentes adversariales en paralelo**, asumiendo que el fix está mal: (1) correctness;
   (2) seguridad de emisión (no quemar/duplicar folio, candado `finalEmitClicked`, modo
   ventana); (3) regresión/release (no rompe el otro carril ni clientes con libreto viejo;
   test real, no tautología). Se publica solo con los 3 limpios.
5. Commit → PR → merge dev → promo main (la app debe tener `EXTENSION_VERSION_ACTUAL` nueva
   ANTES de que Chrome actualice).
6. Publicar: `bash scripts/publish-extension.sh X.Y.Z`. Credenciales en `.chromewebstore/credentials.json`.
7. Compuerta antes de publicar: `unzip -p dist/extension/*vX.Y.Z.zip background.js | grep FACT_WORKER_EN_PESTANA` debe decir `= false`.
8. Chrome actualiza a los clientes en ~5 h escalonado (o `chrome://extensions` → Actualizar).
   Si la versión vieja quedó inservible, subir `EXTENSION_VERSION_MINIMA` (`src/lib/extension.ts`) en PR aparte.
9. Confirmar: flota por versión en /dev + Q1 en cero después. Levantar la pausa.

---

## 6. CERRAR

1. Avisar al cliente afectado (afirmación, no pregunta): «Ya está arreglado, reintenta la
   emisión; si algún documento quedó a medias, dime el folio que ves en el SII» (rescate
   manual: `registrar_folio_manual` en `/api/sii-local/result`).
2. Jobs con lápida (`revision_pendiente`) del incidente: revisar con Q2; levantar solo con
   folio confirmado por el cliente.
3. Actualizar: este doc (fecha + qué cambió el SII), `CLAUDE_CONTEXT.md`, memoria
   `reference_rpa_debug_runbook` (una línea, no duplicar contenido).
4. Limpiar datos de prueba: decir «limpia» → counts → confirmar → borrar (nunca
   `clasificacion_reglas`, `parser_adapters`, auditoría). Folios reales emitidos bajo MV por
   accidente: NC manual de Matías.
5. Perillas: `localStorage` sin `massdte:*-ensayo`; `git diff extensions/` sin
   `FACT_WORKER_EN_PESTANA = true`.

---

## Checks anti-tropiezo (cada uno nació de una hora perdida)

1. **Bundle rancio**: `rm -rf .next` + el check del listener `message` (§3.6). Sin ese
   `false` en consola no se aprieta Emitir.
2. **Perilla no aplicada**: vive en `localStorage` de la pestaña de la app en :3000.
3. **AlphaCode ≠ MV**: manda el `rut` de la empresa ACTIVA en la app.
4. **Extensión sin recargar** tras editar `background.js`.
5. **Unpacked vs Store**: si el cliente reporta con 0.2.x, mirar `ext_last_version` antes de
   asumir que corre tu código.
6. **Mini/SSH**: no se toca para el RPA (solo para DDL en Supabase). Si hace falta y el mini no
   responde: revisar que el Mac esté logueado en Tailscale (`tailscale status`).
7. **`source='emision'` no es el RPA**: la señal estructural es `sii_local_posible_cambio_ancla`.
8. **`page.excerpt` censurado y page-map inexistente en prod**: no gastar minutos ahí.
9. **7 días**: `sii_local_resultados` se borra; los `GLOSA_OMITIDA` sí persisten en `ops_events`.
10. **Whitelist**: un selector que no pase `esSelectorPermitido` se rechaza en la extensión y
    crees que el deploy no hizo nada.
11. **`libreto_version` no se bumpea** para un cambio de nombres: es versión de SCHEMA.
12. **Funciones del worker**: contexto de la extensión en DevTools, no `window`.
13. **Release parcial**: nunca «solo boletas»; nunca dos versiones seguidas.
14. **Kill switch olvidado**: tiene `hasta` (auto-expira) y /dev lo marca en rojo si lleva
    horas; igual revisarlo al cerrar.
