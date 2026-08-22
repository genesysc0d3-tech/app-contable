<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-context -->
# app-contable

App contable SaaS para Chile. IA procesa cartolas bancarias, clasifica movimientos y propone documentos tributarios.

---

## Setup rápido (para el compa)

```bash
git clone git@github.com:genesysc0d3-tech/app-contable.git
cd app-contable
git checkout dev
npm install
```

Crear `.env.local` con estas keys (pedírselas al compa):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
MISTRAL_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEEPSEEK_API_KEY=
```

Luego:
```bash
npm run dev
```

- **No necesita** Supabase CLI ni Vercel CLI para programar.
- **Solo modificar** archivos en `/v5` o componentes compartidos. No tocar `/escritorio` original.
- **EL LEGACY NO IMPORTA** (vale para todos los agentes): `/escritorio` v1-v4 y sus
  componentes son código muerto. No analizarlos, no fixearlos, no reportar sus errores.
  El producto es **/massdte** (alias de `escritorio/v5`) + el stack de emisión
  (`src/lib/emission/`, `src/app/api/simpleapi/`, `src/app/api/sii-local/`,
  `extensions/sii-portal-rpa/`). Objetivo actual: llevarlo a producción.

---

## Stack y servicios

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 + React 19 |
| Lenguaje | TypeScript |
| Estilos | Tailwind v4 + inline styles |
| Base de datos | Supabase (Postgres) |
| Auth | Supabase Auth |
| IA | Mistral AI (via API) + DeepSeek (API configurable) |
| Deploy | Vercel (producción) |

### URLs

| Recurso | URL |
|---|---|
| App (producción) | https://app.massdte.cl |
| GitHub repo | genesysc0d3-tech/app-contable (rama `dev`) |
| Supabase project | xncnfrwarcrzgldalkzz (us-east-1; viejo aluuuyecwifaakehvcam = respaldo hasta OK del fundador) |

---

## Reglas

- **Nunca** trabajar directo en `main` ni `dev`. Crear rama `feature/` o `fix/` desde `dev`:
  - `git checkout dev && git pull && git checkout -b feature/mi-feature`
- Las env vars están en `.env.local`. No leer `.env.setup` ni `.env.github`.
- Migraciones SQL en `supabase/migrations/` (respetar orden por fecha).
- Tipado de base de datos en `src/lib/database.types.ts`.
- Script de limpieza de datos de test: `scripts/limpiar-test.sql`. Conserva `parser_adapters`, `parser_logs`, `clasificacion_reglas`, `boletas_caf_mock`, `clientes`, `usuarios`, `empresas`, `propuestas_ia`, `movimientos_raw`, `documentos_subidos`. Borra solo `audit_chunks`, `ia_uso`, `creditos_uso`, `periodos_contables`.
- Supabase MCP usa token de CUENTA (sin --project-ref: ve ambos proyectos; prod real = `xncnfrwarcrzgldalkzz`, viejo `aluuuyecwifaakehvcam` = respaldo NO tocar): úsalo como fallback para migraciones, advisors y dry-runs SQL cuando el CLI/pooler o env vars locales bloqueen. El MCP no expone `SUPABASE_SERVICE_ROLE_KEY` ni borra objetos de Storage; para `scripts/limpiar-test-storage.mjs --commit` sigue siendo obligatorio exportar `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` sin leer `.env.local`.

---

## Arquitectura v5 (activo)

La versión activa del escritorio es `/v5`. Todo el trabajo nuevo va acá.

### Estructura de archivos clave

```
src/app/(app)/escritorio/v5/
├── V5Root.tsx                  ← 5 tabs wrapper + theme toggle + empresa button
├── page.tsx                    ← Server component, fetch de datos, dashboard HTML
├── GlowWrap.tsx                ← Wrapper con glow hover
├── TabsV5.tsx                  ← Tabs internos (Subidos/Revisar/Emitir/Boletas)
├── RevisarTabContent.tsx       ← Contenido del tab Revisar
├── EmitirTabContent.tsx        ← Contenido del tab Emitir (dashboard)
├── EmitirPanel.tsx             ← Panel izquierdo Emitir
├── DropzoneUpload.tsx          ← Subida de archivos
├── DocCardList.tsx             ← Cards de documentos con FieldMapper
├── EmpresaPopup.tsx            ← Popup de empresa (wizard 5 pasos)
└── sections/
    ├── SubidosView.tsx
    ├── SubidosFullView.tsx
    ├── RevisarFullView.tsx
    ├── EmitirFullView.tsx
    └── BoletasFullView.tsx

src/app/(app)/empresa/          ← Componentes de empresa compartidos
├── EmisorForm.tsx              ← Formulario datos del emisor
├── CertificadoToggle.tsx       ← Toggle certificado SII
├── CAFPanel.tsx                ← Panel de folios CAF
├── AiKeyConfig.tsx             ← Configuración API key
└── EmpresaFormatoCartola.tsx   ← Subir formato de cartola
```

### Las 5 tabs del dashboard

| Tab | Componente | Descripción |
|---|---|---|
| Dashboard | `page.tsx` (inline) | Réplica HTML: RCV card izq + calendario+tabs der |
| Subidos | `SubidosFullView.tsx` | Historial de documentos subidos |
| Revisar | `RevisarFullView.tsx` | Propuestas pendientes agrupadas por fecha |
| Emitir | `EmitirFullView.tsx` | Items listos para emitir |
| Boletas | `BoletasFullView.tsx` | Boletas emitidas |

### Decisiones técnicas tomadas

- **Glow hover**: box-shadow red accent en las 3 cards principales (`.ep-glow-card:hover`)
- **Tema claro/oscuro**: variables CSS `--surface`, `--text`, `--border` definidas en V5Root.tsx
- **Popup empresa**: wizard de 5 pasos con EmisorForm, Certificado, Formatos, CAF, IA
- **Colores acento**: `#E8553E` (naranja-rojo) en vez de morado
- **Estilos inline**: componentes convertidos a style={} para evitar problemas de compilación Tailwind

---

## <!-- MEMORY:START -->
## Memoria del proyecto

_Esta sección la actualiza la IA al final de cada sesión de trabajo._

### Memoria viva del producto

- Memoria viva del producto: leer `docs/MEMORIA.md` antes de tocar planes,
  cuenta pagadora, multiempresa, equipo Business, Telegram, extension SII,
  SimpleAPI local, facturacion, gating o realtime.
- Decision final completa y directa: leer `docs/DECISION_FINAL_PRODUCTO.txt`
  antes de implementar cambios relacionados. Ese archivo conserva la decision
  completa sin convertirla en resumen de sesion.
- Loop harness operativo: leer `loops/README.md` y el contrato del loop
  relevante en `loops/*/README.md` cuando se trabaje por dominio o se quiera
  dejar backlog/señales para otros agentes. Los artefactos durables viven en
  `artifacts/signals`, `artifacts/tasks`, `artifacts/docs` y `artifacts/runs`;
  despues de trabajo mayor agregar una linea en `loops/LOG.md`.
- Spec Kit local: leer `.specify/README.md` y
  `.specify/memory/constitution.md` antes de abrir o ejecutar una feature
  grande en `specs/NNN-nombre`. Los loops deciden que trabajo existe; Spec Kit
  define spec/plan/tasks antes de implementar.
- Referencia compliance Chile: considerar
  `https://github.com/Lelemon-studio/compliance-cl` cuando se trabaje
  privacidad, Ley 21.719, Ley 21.595, politicas, DPA, RAT, respuesta a
  brechas, modelo de prevencion de delitos o readiness legal/compliance. Es una
  skill/repo externo; no copiar codigo sin decision explicita, usarla como
  referencia o posible herramienta para una fase separada de compliance.

### Sesion actual (2026-06-15)

**Que se hizo:**
- Cuenta pagadora fase 1 quedo con jobs/locks reales para emision local:
  `POST /api/emision/jobs` crea `emision_jobs` + `emision_locks` por cuenta;
  `DELETE /api/emision/jobs` libera/cancela jobs propios.
- `EmitirDirectaView.tsx` dejo de crear `job_id` cliente para SII local y
  SimpleAPI; ahora pide job server-side antes de llamar a la extension.
- Extension Chrome preserva `job_id` en SII local y SimpleAPI multipart.
- `/api/sii-local/result` y `/api/simpleapi/result` guardan por `job.empresa_id`
  y liberan el lock al completar/fallar.
- SimpleAPI upstream se desbloqueo solo con job valido; sin job falla cerrado.
- `GET /api/emision/jobs` expone el lock activo de la cuenta con mensaje seguro:
  Business puede ver quien emite; Start/Pro reciben mensaje generico sin equipo.
- `EmitirDirectaView.tsx` consulta lock activo con polling liviano y bloquea solo
  la emision real cuando hay otro job activo.
- `useEmissionLockStatus` centraliza la consulta cliente de lock activo para v5.
- `LeftQuickActions.tsx` y `EmitirTabContent.tsx` bloquean las entradas de
  emision si otro usuario tiene un lock activo; Business muestra mensaje de
  equipo y Start/Pro mantienen mensaje generico.
- `V5Root.tsx` envuelve la app con `EmissionLockProvider`; ya no hay polling
  separado por cada entrada de emision.
- Business muestra un banner global compacto cuando otra persona de la cuenta
  esta emitiendo; Start/Pro no muestran nombre, equipo ni presencia.
- `EmpresaBrand.tsx` ahora actua como selector de empresa solo cuando la cuenta
  tiene multiempresa y mas de una empresa activa.
- `src/app/(app)/escritorio/v5/actions.ts` agrega `listarEmpresasSelector` y
  `cambiarEmpresaActiva`: valida cuenta, plan activo, empresa activa y
  multiempresa antes de actualizar `usuarios.empresa_id`.
- `TeamBusinessPanel.tsx` agrega panel Equipo solo Business en la columna
  izquierda, debajo de las acciones. Muestra maximo 5 circulitos, `+N`,
  conectados y mini panel con personas.
- La presencia basica usa Supabase Realtime en `presence:cuenta:{cuentaId}` y
  publica nombre, iniciales, empresa activa, ultima actividad y estado
  activo/inactivo. Start/Pro no ven panel ni teaser.
- `PATCH /api/emision/jobs` guarda heartbeat y `estado_visible` sin romper el
  `estado` tecnico del job; la UI reporta estados recibidos desde la extension.
- `scripts/supabase-local-token.sh` permite usar `.supabase/token` local sin
  imprimirlo y evita que el CLI lea `.env.local`.
- `UsageCountersPanel.tsx` agrega contador compacto "Uso del mes" en la columna
  izquierda: boletas desde cartolas, comprobantes por Telegram, empresas,
  personas y extras activos.
- `listarResumenCupos` calcula esos contadores server-side desde cuenta
  pagadora: boletas usa `estadoCuota`, Telegram cuenta propuestas utiles del
  mes nacidas de movimientos `origen = telegram`, y extras lee
  `cuenta_addons` activos del periodo.
- Telegram Business multiempresa ya pregunta empresa antes de descargar,
  guardar u OCR: `telegram_comprobante_pendientes` guarda solo `file_id`,
  opciones y expiracion; primer tap marca `OK?`, segundo tap confirma y recien
  ahi se descarga/procesa para la empresa elegida.
- SimpleAPI local ahora tiene reserva central de folios:
  `folio_reservas` reserva por `empresa_id + tipo_dte + job_id`, el job
  devuelve `reserved_folio`, la UI lo inyecta en el input, la extension valida
  que calce con el CAF local y el backend rechaza generar/guardar si el folio
  no coincide con la reserva. Al cerrar el job, la reserva queda `usado`,
  `liberado` o `fallido` segun corresponda.
- `/dev` quedo restringido al operador autenticado `genesysc0d3@gmail.com` y
  `usuarios.vetado != true`; `dev_mode` no bloquea esa cuenta especial. El panel permite abrir una empresa en modo
  soporte/cliente mediante cookie httpOnly de 4 horas. `/massdte` usa ese
  contexto solo para Genesys, muestra banner "Modo soporte Genesys", bloquea
  emision/carga y permite volver a `/dev` sin tocar la sesion ni
  `usuarios.empresa_id` del cliente.
- `/dev/cuentas` agrega Account 360 para Genesys: lista cuentas pagadoras,
  plan, estado de pago, cupos de empresas/personas, alertas y entrada a modo
  cliente. `/dev/cuentas/[cuentaId]` muestra detalle de funciones liberadas,
  empresas, personas, pagos/suscripciones, extras, locks/jobs de emision y
  reservas de folio sin exponer raw de pagos, documentos, XML, imagenes ni
  claves. Emails y RUTs se muestran enmascarados.
- `/dev` ahora redirige al panel nuevo `/dev/cuentas` y las acciones legacy de
  panel viejo quedan deshabilitadas salvo que se active explicitamente
  `MASSDTE_ENABLE_LEGACY_DEV=1`. `/dev/cuentas` suma busqueda server-side por
  cuenta, empresa, RUT, plan o correo sin exponer identificadores completos en
  resultados, mas filtros operativos: todas, alertas, bloqueadas, sin pago y
  sobre cupo. El detalle `/dev/cuentas/[cuentaId]` muestra primero prioridad:
  errores, advertencias y chequeos rapidos de plan, pago, cupos y emision.
- `/dev/cuentas` recibio una pasada de UX: filtros con conteo, linea
  "mostrando X de Y", filas con severidad visual (`ok`, `revisar`, `accion`),
  asunto principal visible y accion "Ver cliente" mas explicita. El detalle
  agrega chips de estado en el encabezado y "Siguiente paso" en prioridad.
- El detalle `/dev/cuentas/[cuentaId]` quedo mas compacto: las cuatro cards
  altas se reemplazaron por una franja de resumen operativo, los estados vacios
  de pagos/emision explican que revisar y la auditoria visible se limita para
  que entradas repetidas de modo soporte no dominen la pagina.
- Modo soporte/dev cliente quedo mas cerrado: el boton volver retorna a
  `/dev/cuentas`, entrada/salida quedan en auditoria de cuenta y las escrituras
  principales devuelven `DEV_SUPPORT_READ_ONLY` o "Modo soporte: solo lectura"
  en revisar, clientes, empresa/equipo, cambio de empresa desde la app, subida,
  pagos, emision, jobs y SimpleAPI.
- `cuenta_audit_events` agrega auditoria basica por cuenta: cambio de empresa
  activa, personas invitadas/agregadas, propuestas aprobadas, emisiones y
  fallos de emision. El Account 360 muestra los ultimos eventos sin metadata
  cruda ni datos sensibles.
- Se agrego un loop harness inicial: contratos en `loops/product`,
  `loops/engineering` y `loops/dev-operator`, log global en `loops/LOG.md`,
  reglas de artefactos en `artifacts/README.md`, tareas iniciales para cupos
  de equipo, smoke real de extension y reintento de Supabase lint, mas un
  signal de reglas de producto no negociables.
- Se agrego Spec Kit local para coordinar features grandes entre agentes:
  `.specify/README.md`, `.specify/memory/constitution.md`, templates locales,
  y `artifacts/docs/spec-kit-operating-model.md`. No es codigo runtime ni
  reemplaza loops; los complementa.
- Se creo `specs/006-dev-cuentas-unico` para formalizar que `/dev/cuentas`
  debe ser la superficie dev unica, con modo cliente read-only, auditoria,
  privacidad y retiro/redireccion futura de `/dev` legacy. No se implemento
  codigo de app en esta tarea.
- `ENG-002` quedo corregida/cerrada como bloqueo remoto de emision en la app,
  no como tarea de navegacion SII: backend bloquea por `cuenta_id`, frontend v5
  consume `useEmissionLockStatus`, Business puede mostrar mensaje de equipo y
  Start/Pro mantienen mensaje generico. `src/lib/emission/locks.test.ts`
  cubre bloqueo misma cuenta, cuentas distintas, expiracion y liberacion.
- `ENG-001` quedo cerrada como cupos de equipo/pago de persona adicional:
  solo la cuenta pagadora/titular puede invitar o comprar personas; una
  invitacion pendiente reserva cupo; cada `cuenta_addons.tipo =
  persona_adicional` activo suma un cupo; y una compra pendiente bloquea otro
  checkout antes de Mercado Pago para evitar doble cobro. La RPC se corrigio
  en `20260620113000_fix_team_invite_rpc_ambiguous.sql` por una referencia
  ambigua detectada por `db lint`.
- Las rutas `/dev` viven en `src/app/(dev)/dev`, no en `src/app/(app)/dev`,
  para no heredar el layout de cliente ni `BottomNav`.
- La matriz de roles Start/Pro/Business quedo automatizada con
  `scripts/audit-role-matrix.mjs` / `npm run audit:roles`. Produccion tiene
  fixtures Pro/Business marcados como `AUDIT ... FIXTURE` via migracion
  `20260621010000_role_matrix_audit_fixtures.sql`; no contienen documentos,
  pagos, XML ni credenciales.
- `requireAccountApiAccess` respeta modo soporte Genesys para lecturas de APIs
  compartidas; `/api/empresa/logo/[empresaId]` permite la empresa de soporte y
  devuelve 204 si no hay logo para evitar ruido de consola.
- `audit:app` ahora recorre modo soporte Start/Pro/Business en `/massdte`,
  `/empresa`, `/revisar`, `/subir`, `/clientes` y `/boletas/reportes`, con
  probes read-only para upload, checkout, jobs de emision y emision directa.
- `audit:locks` (`scripts/audit-emission-lock.mjs`) audita el lock remoto sin
  extension/SII: crea un job temporal si no hay lock previo, valida GET/PATCH/UI,
  cancela con DELETE y confirma `locked=false`.
- Modo soporte Genesys quedo app-wide para el grupo `(app)`: `getAppEmpresaContext`
  centraliza la empresa efectiva, el layout muestra banner global, las rutas
  auditadas leen la empresa soportada y `/api/sii-mock/rcv` respeta soporte.
- Readiness launch 2026-06-21: app web verde para beta controlada; no prometer
  emision tributaria end-to-end hasta cerrar `LAUNCH-001` smoke real
  extension/SII/CAF. `LAUNCH-002` cubre runbook de primera beta.
- Bloque 4-5 del TXT quedo reconciliado contra produccion: migraciones remotas
  alineadas, dry-run sin pendientes, lint remoto sin errores de schema y build
  Next/Vercel local OK. `DEV-001` quedo cerrado.

**Verificacion:**
- `rtk tsc --noEmit`: OK.
- `rtk npm run test -- src/lib/emission/lock-visibility.test.ts`: OK, 3 tests.
- `rtk npm run test -- src/lib/emission/locks.test.ts`: OK, 4 tests.
- `rtk npm run test -- src/lib/pagos/metering.test.ts`: OK, 17 tests.
- `rtk npm run test -- src/lib/telegram/deterministico.test.ts`: OK, 9 tests.
- `git diff --check -- src/app/(dev)/dev/cuentas/page.tsx
  src/app/(dev)/dev/cuentas/[cuentaId]/page.tsx`: OK.
- `git diff --check`: OK.
- `npm run build`: OK con Next 16.2.9; `/dev`, `/dev/cuentas`, `/massdte` y
  `/api/emision/jobs` incluidos en el build.
- `bash scripts/supabase-local-token.sh migration list`: OK; local/remoto
  alineados hasta `20260620113000`.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; remoto al dia.
- `bash scripts/supabase-local-token.sh db lint --linked`: OK, sin errores de
  schema.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; detecto solo
  `20260621010000_role_matrix_audit_fixtures.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; fixtures Pro/Business
  aplicados en Supabase remoto.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260621010000`.
- `npm run build`: OK con fixes de soporte de matriz de roles.
- Vercel produccion redeploy OK; alias `https://app.massdte.cl`
  actualizado.
- `npm run audit:roles -- --base-url=https://app.massdte.cl
  --state=/tmp/e2e-state-vercel.json` con `AUDIT_NONDEV_STATE` temporal:
  OK, 0 hallazgos. Business checked con Equipo visible y `business_mode=true`;
  Pro/Start checked con Equipo oculto y `business_mode=false`; no-dev no ve
  `/dev/cuentas`.
- `npm run build`: OK con soporte app-wide.
- Vercel produccion redeploy OK (`dpl_BpXBLWhKSDrdvMTRnEEUsA14HGcR`); alias
  `https://app.massdte.cl` actualizado.
- `AUDIT_NONDEV_STATE=/tmp/e2e-state-nondev.json npm run audit:app --
  --base-url=https://app.massdte.cl
  --state=/tmp/e2e-state-vercel.json --expect-dev`: OK, 0 hallazgos. Rutas
  soporte Start/Pro/Business 6/6, escrituras bloqueadas con
  `DEV_SUPPORT_READ_ONLY`, no-dev termina en login.
- `npm run audit:locks -- --base-url=https://app.massdte.cl
  --state=/tmp/e2e-state-vercel.json`: OK, 0 hallazgos. Creo job temporal
  `sii_local`, confirmo lock activo, `PATCH estado_visible=audit_probe`, UI de
  `/massdte` con bloqueo visible, `DELETE cancelled` y `locked=false` final.
- `bash scripts/supabase-local-token.sh inspect db locks`: OK; solo mostro la
  query de inspeccion activa.
- Inspecciones opcionales en paralelo (`long-running-queries`, `table-stats`)
  volvieron a disparar `ECIRCUITBREAKER` del pooler. No reintentar Supabase
  remote inspect de inmediato; esperar antes de nuevas conexiones remotas.
- `git diff --check -- .specify specs/006-dev-cuentas-unico
  artifacts/docs/spec-kit-operating-model.md loops/README.md loops/LOG.md
  AGENTS.md`: OK para el agregado local de Spec Kit.
- `git diff --check` sobre cambios de dev/read-only: OK.
- `curl -I http://localhost:3001/dev/cuentas`: OK; responde redirect a login
  sin sesion, no 404.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; detecto solo
  `20260618110000_cuenta_audit_events.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion
  `20260618110000_cuenta_audit_events.sql` aplicada en Supabase remoto.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260618110000`.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; detecto solo
  `20260620110000_team_invite_owner_lock.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion
  `20260620110000_team_invite_owner_lock.sql` aplicada en Supabase remoto.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260620110000`.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; detecto solo
  `20260620113000_fix_team_invite_rpc_ambiguous.sql`.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion correctiva
  `20260620113000_fix_team_invite_rpc_ambiguous.sql` aplicada en Supabase
  remoto.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260620113000`.
- `bash scripts/supabase-local-token.sh db lint --linked`: fallo por auth
  temporal del pooler (`cli_login_postgres`, `ECIRCUITBREAKER`) despues de
  aplicar la correccion; no relanzar de inmediato.
- `bash scripts/supabase-local-token.sh db lint --linked`: fallo por auth
  temporal del pooler (`cli_login_postgres` / `ECIRCUITBREAKER`); no relanzar
  de inmediato.
- `bash scripts/supabase-local-token.sh db push --dry-run`: OK; detecto solo
  `20260617193000_simpleapi_folio_reservas.sql` en la ultima continuacion.
- `bash scripts/supabase-local-token.sh db push`: OK; migracion aplicada en
  Supabase remoto.
- `bash scripts/supabase-local-token.sh migration list`: OK; remoto muestra
  `20260617193000`.
- `bash scripts/supabase-local-token.sh db lint --linked`: fallo por auth
  temporal del pooler (`cli_login_postgres` / `ECIRCUITBREAKER`), no por SQL.
- Spec Kit strict validate sobre `specs/005-cuenta-pagadora-fase-1`: OK.
  En la continuacion 2026-06-16 el script local fallo antes de validar porque
  no encontro `orchestrator.js` ni el loader `tsx` dentro del skill.
- En la continuacion 2026-06-17 el mismo validate devolvio exit 1 sin salida;
  TypeScript y tests puntuales quedaron OK.
- `bash scripts/supabase-local-token.sh db lint --linked`: OK, sin errores.
- Supabase remoto quedo migrado hasta `20260615160000_cuenta_pagadora_fase1`.
  Se agregaron placeholders locales para `20260613200938` y `20260613201107`,
  versiones que ya existian en remoto pero no en el repo.
- `bash scripts/supabase-local-token.sh db lint --linked`: OK despues de migrar.
- `inspect db table-stats` confirmo tablas remotas `cuentas`, `cuenta_empresas`,
  `cuenta_usuarios`, `cuenta_addons`, `emision_jobs` y `emision_locks`.
- Una verificacion posterior `db push --dry-run` fallo por auth temporal del
  pooler (`cli_login_postgres`, demasiados intentos); no relanzar de inmediato.

**Pendientes:**
- Probar flujo real con extension en navegador.
- Probar heartbeat/status persistido con la extension real.
- Probar SimpleAPI local con CAF real para confirmar que el folio reservado por
  backend esta dentro del rango CAF cargado en la extension.

### Última sesión (2026-05-24)

**Qué se hizo:**
- Ramas creadas y descartadas: `feature/v5-dte-unico-actividad-rcv`.
- Emisión Directa: formulario manual DTE único con endpoint `/api/intermediaria/emitir-boleta`.
  - Popup/pasos: tipo documento, receptor, detalle+monto, sidebar resumen.
  - Candado desbloqueable: tipo DTE bloqueado por empresa, desbloqueable para excepciones.
  - Advertencia si tipo DTE difiere del tipo de empresa.
- MassDTE: desplegable con carga masiva (`DropzoneUpload`), reemplaza visualmente `Subir documento`.
- Registro de Actividad: footer izquierdo, al clicar muestra actividad en card derecha vía `RightColumnView`.
- RCV nuevo estilo colega/nube en card superior izquierda.
- `ActividadView.tsx`, `RightColumnView.tsx`: contenidos de card derecha.
- **Animación Genie real del popup Emisión Directa** (sin dependencias):
  - Canvas scanlines por fila con easing cúbico (`eioC`/`eIn2`/`eOut2`) y glow radial.
  - Captura DOM → canvas vía SVG `<foreignObject>`: clona offscreen, inyecta CSS vars, serializa, carga como Image, dibuja en canvas.
  - Popup offscreen pre-renderizado; captura en `requestIdleCallback` al montar; botón deshabilitado hasta tener snapshot.
  - Apertura: canvas anima desde botón al centro, oculta canvas y muestra panel real con fade overlay.
  - Cierre: oculta panel real, muestra canvas y anima minimizando al botón.
  - `prefers-reduced-motion`: salta canvas, muestra overlay directo.

**Archivos modificados:**
- `src/app/(app)/escritorio/v5/LeftQuickActions.tsx`: reescrita completamente con Genie canvas.
- `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx`: formulario manual DTE único.
- `src/app/(app)/escritorio/v5/MassDTEPanel.tsx`: desplegable MassDTE.
- `src/app/(app)/escritorio/v5/page.tsx`: layout v5 con RCV, LeftQuickActions, RightColumnView.
- `src/app/(app)/escritorio/v5/ActividadView.tsx`, `RightColumnView.tsx`: feed actividad, alternador derecha.

**Decisiones:**
- Animación Genie sin instalar `html-to-image` ni `motion/react`: SVG foreignObject + canvas puro.
- No traer `origin/dev` completo (el compañero borró/reordenó); portar manualmente piezas.
- No tocar auth (`dal.ts`, `supabase/proxy.ts`) ni relajar validaciones tributarias.
- `Emisión Directa` usa exclusivamente `/api/intermediaria/emitir-boleta` (no pendientes ni emitir-lote).
- Botón deshabilitado hasta tener snapshot ready (~200ms idle).

**Próximos pasos:**
- Revisar visualmente popup empresa.
- Probar Genie en vivo con sesión real en `localhost:3002`.
### Sesión paralela del compa (2026-05-22)

**Qué se hizo:**
- Reset completo de BD (CB4W): `scripts/reset-completo.sql` + `scripts/reset-db.js` + script `npm run cb4w`
- Reemplazado estilo de pestañas superiores (V5Root.tsx) con el formato de TabsV5 (icono sobre texto, fondo activo `rgba(232,85,62,.1)`, sin sliding pill)

**Archivos modificados:**
- `scripts/reset-completo.sql` (nuevo) — SQL de reset total
- `scripts/reset-db.js` (nuevo) — script node para ejecutar reset vía Supabase
- `package.json` — agregado script `cb4w`
- `src/app/(app)/escritorio/v5/V5Root.tsx` — pestañas superiores ahora con estilo TabsV5 (icono sobre texto, fondo activo)
- `src/app/(app)/escritorio/v5/page.tsx` — eliminado TabsV5 del dashboard; las pestañas superiores controlan el flujo

**Decisiones:**
- CB4W = comando para limpiar base de trabajo y empezar desde 0
- Las pestañas inferiores (TabsV5) ahora tienen el mismo formato visual que las superiores

**Próximos pasos:**
- Continuar desarrollo del flujo de emisión
- Ajustar visual de las secciones
<!-- MEMORY:END -->

---

## Deploy

```bash
# La rama dev se deploya automáticamente en Vercel
git push origin dev
# O manual:
npx vercel --prod --yes
```

URL de producción: https://app.massdte.cl

<!-- END:project-context -->
