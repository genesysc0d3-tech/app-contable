# CLAUDE_CONTEXT.md
> Contexto completo del proyecto para Claude Code.
> Leer SIEMPRE antes de escribir cualquier línea de código.

---

## REGLA: ACTUALIZAR ESTE ARCHIVO

Después de cada merge a `dev`, actualizar este archivo con lo que se construyó y commitear directo en `dev` con mensaje `docs: actualizar contexto`.

---

## REGLA CRÍTICA — SIEMPRE TRABAJAR EN RAMAS

**NUNCA trabajar directamente en `main` ni en `dev`** (excepto commits `docs:` de este archivo).

Antes de cualquier tarea, crear una rama desde `dev`:

```bash
git checkout dev
git pull origin dev
git checkout -b feature/nombre-descriptivo
```

Al terminar, hacer PR a `dev`. Solo después de revisión se mergea.

**Convención:** `feature/nombre` o `fix/nombre`, siempre desde `dev`.

---

## Proyecto

App contable SaaS para Chile orientada a vendedores P2P, operadores de crypto/forex y pequeñas empresas que manejan documentación caótica (cartolas bancarias, screenshots, WhatsApp, Excel). La IA procesa los documentos, clasifica cada movimiento y propone documentos tributarios. El usuario revisa y aprueba con 1 clic.

Esta es la v3 del proyecto. Las versiones anteriores fallaron por acoplamiento frágil con n8n. En esta versión n8n se usa solo para automatizaciones periféricas — nunca como núcleo de la lógica de negocio.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS |
| Base de datos + Auth | Supabase (PostgreSQL + RLS + Storage) |
| Automatizaciones | n8n en Railway |
| IA procesamiento docs | Mistral API (Small) |
| Iconos | @phosphor-icons/react |
| PDF export | jsPDF (import dinámico) |
| Deploy | Vercel (preview en dev, prod en main) |
| Control de versiones | GitHub (holaavisoapp-del/app-contable) |
| Herramienta de desarrollo | Claude Code |

- **URL n8n Railway:** `https://n8n-production-47ecb.up.railway.app`
- **Supabase project ID:** `nbvcngvwgbktjpxmuoto`
- **Vercel project ID:** `prj_ILQxTy1z7SJEct8T05kfNiUtrWwg`
- **Vercel team ID:** `team_SqCcEnlXE3TF0H55OjDhXnUi`

---

## MCPs en Claude Code

| MCP | Uso |
|---|---|
| `n8n-mcp` | Conectado a Railway vía HTTP |
| `n8n-mcp-docs` | Documentación y creación de workflows |
| `supabase` | Conectado al proyecto Supabase |
| `vercel` | Deploy y logs del proyecto |

---

## Ramas Git

| Rama | Uso |
|---|---|
| `main` | Producción — solo tiene Initial commit (no se ha mergeado dev aún) |
| `dev` | Integración — contiene PRs #1 al #45, toda la funcionalidad |

**PRs mergeados a dev:**

| PR | Rama | Descripción |
|---|---|---|
| #1 | feature/supabase-setup | Setup base: Supabase, auth, Mistral AI, bandeja propuestas |
| #2 | feature/realtime-duplicados | Realtime progreso + detección duplicados |
| #3 | feature/crm-clientes | CRM clientes con CRUD, RUT, alertas SII |
| #4 | feature/revisar-mejoras | Clientes automáticos por RUT + /revisar agrupado por documento |
| #5 | feature/resumen-f29 | Resumen mensual con métricas, histórico, F29, PDF |
| #6 | feature/revisar-confianza | Grupos por confianza en /revisar (alta/media/baja) |
| #7 | feature/editar-propuesta-p2p | Formulario edición P2P/crypto con categorías tributarias |
| #8 | feature/prompt-mistral | System prompt optimizado para clasificación P2P/crypto/forex |
| #9 | fix/procesamiento-vercel | Fix: after() para que Vercel no mate el procesamiento IA |
| #10 | feature/ui-rediseno | Rediseño UI: tema claro, acento coral, cards blancas |
| #11 | feature/ui-polish | Phosphor icons, animaciones, toast, toggle dark/light |
| #12 | feature/loading-states | Skeleton loaders en todas las rutas |
| #13 | feature/subir-ocr-imagenes | Rediseño /subir con OCR imágenes, cola, badges de grupo |
| #14 | feature/fix-clasificacion-documentos | Fix: clasificar Excel/CSV por filas reales, no solo tamaño |
| #15 | fix/null-movimientos | Fix: filtrar movimientos con descripcion null antes del insert |
| #16 | feature/fix-duplicados-ui | Visor de duplicados con detalle de origen y forzar inserción |
| #17 | fix/criterio-duplicados | Criterio duplicados por N° documento + motivo + warning + deshacer |
| #18 | fix/duplicados-mensaje | 6 tipos de duplicado con motivos específicos e íconos por severidad |
| #19 | fix/propuestas-invalid-input | Fix: sanitizar "null" string en campos numéricos de Mistral |
| #20 | fix/ndoc-ia-deteccion | Clasificar n_documento con Mistral IA: ID transacción vs RUT |
| #21 | fix/aprobar-todas | Fix: botón Aprobar todas no funcionaba por button anidado |
| #22 | fix/aprobar-todas-bd | Fix: aprobarTodas en batches de 50 — 659 UUIDs excedía PostgREST |
| #23 | fix/resumen-montos | Fix: montos inflados — Mistral extraía saldo como transacción |
| #24 | feature/fix-resumen-montos | Fix: resumen filtra solo aprobados + limpieza saldos y datos prueba |
| #25 | feature/fix-saldos-corruptos | Fix: descartar saldos bancarios >50% total abonos en processor |
| #26 | feature/fix-omitidos-ui | Fix: omitido desaparece de lista al agregar + limpieza duplicados BD |
| #27 | feature/omitidos-seleccion-multiple | Selección múltiple en visor de omitidos para agregar en lote |
| #28 | feature/fix-forzar-movimiento | Fix: forzar-movimiento crea propuesta_ia aprobada + limpieza huérfanos |
| #29 | feature/fix-omitido-persiste | Fix: forzar-movimiento idempotente + remueve omitido de progreso_ia |
| #30 | feature/omitidos-flujo-mejorado | Omitidos van a /revisar como pendientes + botón ocultar/recuperar |
| #31 | feature/revisar-omitidos-anidados | Omitidos anidados en /revisar con aprobar/ignorar/devolver |
| #32 | feature/fix-idempotente-omitidos | Fix: check idempotente bloqueaba omitidos legítimos |
| #33 | feature/fix-omitido-card-duplicado | Fix: omitidos no inflan contadores ni aparecen en Aprobar todo |
| #34 | feature/revisar-omitidos-visual | Card con borde amber + badge "9 +1" para omitidos anidados |
| #35 | feature/ui-improvements | Sticky header, skeleton shimmer, hover lift, completion burst |
| #36 | feature/fade-navigation | Fade-in navigation reemplaza skeleton loaders entre pestañas |
| #37 | feature/ui-polish-v2 | Gráfico Chart.js premium + transición slide entre pestañas |
| #38 | feature/client-cache | Caché Zustand para navegación instantánea entre pestañas |
| #39 | feature/n8n-processing | Migrar procesamiento de cartolas a n8n webhook |
| #40 | fix/revert-vercel-processing | Revertir a Vercel con after() — n8n era más lento (secuencial) |
| #41 | fix/faster-processing | CHUNK_SIZE 50→100, MAX_CONCURRENT 3→7 para procesamiento 4x más rápido |
| #42 | fix/remove-ndoc-classifier | Heurística regex reemplaza clasificarNDocs (Mistral) — elimina timeout |
| #43 | fix/normalize-tipo-propuesto | Normalizar tipo_propuesto con fallback — evita check constraint |
| #44 | fix/progress-animation | Progreso realtime con fases y barra animada en /subir |
| #45 | feature/audit-logging | Audit logging — chunk input + Mistral response por chunk |

---

## Diseño UI (actual)

- **Tema dual:** claro (default) + oscuro (toggle Sun/Moon en header)
- **Claro:** fondo #F5F5F3, cards blancas, texto #111, acento coral #E8553E
- **Oscuro:** glassmorphism iOS Tahoe, fondo #0a0a0a, cards glass
- **CSS variables:** --background, --foreground, --accent, --accent-light, --card, --border, --muted, --surface
- **Iconos:** @phosphor-icons/react (tree-shakeable)
- **Cards:** rounded-[20px], shadow sutil, border variable
- **Navegación bottom:** 72px, iconos Phosphor 28px, bounce activo
- **Animaciones:** fade-in-up, slide-out-right, bounce-icon, btn-press
- **Toast:** notificaciones 2s con CheckCircle/XCircle
- **Skeleton loaders:** loading.tsx en cada ruta

---

## Estructura de archivos (actualizada)

```
src/
  proxy.ts                              # Auth proxy (Next.js 16)
  lib/
    supabase.ts                         # Re-export browser client
    supabase/client.ts                  # Browser client (@supabase/ssr)
    supabase/server.ts                  # Server client con cookies
    supabase/proxy.ts                   # Proxy client para refresh tokens
    database.types.ts                   # Tipos generados desde Supabase
    dal.ts                              # Data Access Layer (auth checks)
    upload.ts                           # Upload a Storage + registro BD
    parsers.ts                          # Excel parser (xlsx → TSV)
    file-classifier.ts                  # Clasifica archivos: grande/chico/imagen + colores badge
    rut.ts                              # Validación y formateo RUT chileno
    ai/types.ts                         # Interfaces AI provider
    ai/provider.ts                      # Factory de proveedores
    ai/prompt.ts                        # System prompt P2P/crypto optimizado
    ai/fecha.ts                         # Parser de fechas chilenas
    ai/ocr.ts                           # Mistral OCR (mistral-ocr-latest) + agrupación imágenes
    ai/ndoc-classifier.ts               # Clasificar n_documento: ID transacción vs RUT (cache por patrón)
    ai/processor.ts                     # Orquestador: chunking, paralelo, retry, duplicados, auto-clientes
    ai/providers/mistral.ts             # Implementacion Mistral
  app/
    layout.tsx                          # Root layout (ToastProvider, anti-FOUT script)
    page.tsx                            # Smart redirect segun auth state
    globals.css                         # CSS variables dual theme + keyframes
    bloqueado/page.tsx                  # Pantalla usuario vetado
    api/procesar-documento/route.ts     # API con after() para Vercel
    (auth)/auth/
      actions.ts                        # signIn, signUp, signOut, signInWithGoogle
      callback/route.ts                 # OAuth callback handler
      login/page.tsx
      registro/page.tsx
    (onboarding)/onboarding/
      actions.ts                        # crearEmpresa (service role)
      page.tsx
    (paywall)/planes/
      actions.ts                        # activarPlan + creditos
      page.tsx
    (app)/
      layout.tsx                        # requireActiveEmpresa + BottomNav + ThemeToggle
      subir/page.tsx                    # Server wrapper
      subir/SubirClient.tsx             # Cola de subida + grupos + realtime
      subir/loading.tsx                 # Skeleton loader
      revisar/page.tsx                  # Server: propuestas + clientes + documentos
      revisar/RevisarClient.tsx         # Agrupado por documento + confianza
      revisar/actions.ts                # aprobar (con cliente_id), editar, descartar
      revisar/loading.tsx               # Skeleton loader
      clientes/page.tsx                 # Server: clientes con count movimientos
      clientes/ClientesClient.tsx       # CRUD, buscador, avatares, alertas SII
      clientes/actions.ts               # crear, editar, eliminar cliente
      clientes/loading.tsx              # Skeleton loader
      resumen/page.tsx                  # Server: resumen + historico
      resumen/ResumenClient.tsx         # Métricas, gráfico, histórico, F29, PDF
      resumen/actions.ts                # getResumenMes, getHistorico, getPropuestas
      resumen/loading.tsx               # Skeleton loader
  components/
    ThemeToggle.tsx                      # Sun/Moon toggle con localStorage
    Toast.tsx                           # ToastProvider + useToast hook
    SkeletonCard.tsx                    # Card placeholder pulsante
    layout/BottomNav.tsx                # Nav con Phosphor icons + badge realtime
    upload/FileUpload.tsx               # Zona drop única + cola + badges grupo 1-5
    upload/DocumentList.tsx             # Historial con iconos por tipo
    propuestas/PropuestaCard.tsx        # Card con categorías tributarias P2P/crypto
```

---

## Esquema de base de datos (Supabase) — actualizado

### Tablas con columnas nuevas (desde sesión 1):

**`clientes`** — agregadas: `telefono text`, `notas text`

**`propuestas_ia`** — agregadas:
- `cliente_id uuid FK → clientes` (vinculación automática y manual)
- `moneda_origen text DEFAULT 'CLP'`
- `monto_moneda_origen numeric`
- `tipo_propuesto` ahora acepta: boleta, factura, gasto, registro_crypto, ignorar, boleta_honorarios, factura_afecta, compraventa_crypto, transferencia_p2p, operacion_forex, gasto_egreso, no_comercial

### RLS
Todas las tablas con `empresa_id` tienen policy:
```sql
USING (empresa_id = (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
```

---

## Lógica tributaria chilena (7 categorías)

| Categoría | IVA | Declara en | Norma |
|---|---|---|---|
| boleta_honorarios | 19% | F29 | — |
| factura_afecta | 19% | F29 | — |
| compraventa_crypto | Sin IVA | F22 | SII Oficio 963-2018 |
| transferencia_p2p | Sin IVA | F22 | Ley Cumplimiento 2024 (50 tx) |
| operacion_forex | Sin IVA | F22 | Diferencia de cambio |
| gasto_egreso | Crédito fiscal | F29 | — |
| no_comercial | N/A | N/A | Ignorar |

**Regla de los 50:** alertar cuando >= 40 (warning) y >= 50 (danger).

---

## Flujo principal (actualizado)

```
1. Usuario arrastra archivos en /subir → clasificación grande/chico/imagen
      ↓
2. Badge de grupo 1-5 para agrupar chicos/imágenes (nombre editable)
      ↓
3. "Subir todo" → Supabase Storage + registro BD
      ↓
4. POST /api/procesar-documento → webhook a n8n en Railway
      ↓
5. n8n descarga archivo de Storage, parsea Excel/CSV
   Si imagen → Mistral OCR (mistral-ocr-latest) → texto estructurado
      ↓
6. n8n: Mistral Small extrae movimientos (chunking 50, retry 3)
      ↓
7. Detección de duplicados (fecha+monto+descripción)
      ↓
8. Auto-detección de clientes por RUT en descripciones
      ↓
9. Propuestas con 7 categorías tributarias + confianza
      ↓
10. Progreso realtime via Supabase (in-place update, sin refetch)
      ↓
11. /revisar: agrupado por documento → por confianza (alta/media/baja)
      ↓
12. Usuario aprueba (con cliente) / edita / descarta
      ↓
13. /resumen: métricas, gráfico, F29, exportar PDF
```

---

## Deploy (Vercel)

- **Production (main):** `app-contable-rho.vercel.app` — solo Initial commit
- **Preview (dev):** se genera automáticamente en cada push a dev
- **Procesamiento:** Vercel con after() + Promise.all (CHUNK_SIZE=100, MAX_CONCURRENT=7)
- **n8n workflow ID:** rZoZmdAAW8csRrjU (desactivado, guardado para futuro)
- **Webhook n8n:** https://n8n-production-47ecb.up.railway.app/webhook/procesar-documento
- **Env var Vercel:** N8N_WEBHOOK_URL (configurada, no en uso actualmente)

---

## Pendiente

- [ ] Configurar Google OAuth en Supabase Dashboard + Google Cloud Console
- [ ] Mergear dev → main para deploy a producción
- [ ] Integración SII (emisión real de DTEs)
- [x] OCR para imágenes (Mistral OCR + agrupación inteligente)
- [ ] Integración de pagos real (actualmente se activa plan sin cobro)
- [ ] n8n webhooks: recordatorio F29, resumen semanal por email
- [ ] PWA: manifest.json, service worker, iconos
- [x] Para cartolas 1000+ tx: migrar procesamiento a n8n webhook

---

## Equipo

Dos desarrolladores. El socio es contador — consultar con él decisiones de lógica tributaria.
Canal de colaboración: Slack workspace `app-contable` con `@Claude`.

---

## Notas de integración n8n (aprendizajes)

### Headers para Supabase con `sb_secret_` keys (nuevo formato)
- PostgREST y Storage: `apikey` + `Authorization: Bearer` con el mismo valor
- Las legacy JWT keys (`eyJ...`) funcionan igual pero están deprecadas

### Normalización de datos de Mistral en n8n
- `tipo_flujo`: Mistral puede devolver "Abono"/"Cargo" → normalizar a "entrada"/"salida"
- `confianza`: puede venir como "alta"/"media"/"baja" → normalizar a número
- Siempre sanitizar antes de insertar en Supabase

### n8n Code nodes
- `require()` bloqueado para módulos externos — usar nodos nativos (extractFromFile para Excel)
- Para HTTP: usar `this.helpers.httpRequest()` con `json: true`
- No interpolar texto en JSON literal — usar `JSON.stringify()` programático

### Credenciales — REGLA ABSOLUTA
- NUNCA commitear claves en código, contexto, ni logs
- Variables de entorno: Railway (n8n), Vercel (app), .env.local (local)
- n8n: `$env.VARIABLE` para leer de Railway
- Railway: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` para permitir `$env`

---

*Última actualización: 6 Abril 2026 · rama `dev` · PRs #1-#54 mergeados · n8n workflow desactivado (guardado)*

**PR #54** — parser: soporte layout `single_col` + reglas ampliadas. Nuevo layout en la heurística para cartolas con 1 columna Monto + 1 columna Tipo (Abono/Cargo) en vez de 2 mutuamente exclusivas. `AdapterConfig.layout` + `columns.monto/tipo_flujo_col` opcionales. `countEquationMatches()` usa `saldo[i] = saldo[i-1] ± monto[i]` para discriminar monto vs saldo de forma matemática (evita heurísticas de rango). `REQUIRED_CONSECUTIVE` bajado a 3 para cartolas chicas. Migración expand_global_rules: TRANSFERENCIA|TRANSFER RECIBIDA/ENVIADA, tipo_flujo_match=NULL en boletas/facturas, patrones COMPRA/PAGO/marketplaces/gateways, crypto prioridad 70 (gana sobre forex en USDT), forex regex con word boundaries. Validado contra cartola_prueba_10mov.xlsx: 10/10 extraídas con monto correcto, 100% clasificadas por reglas, cero Mistral.

**PR #53** — classifier determinístico por reglas antes de Mistral. Tabla `clasificacion_reglas` con `empresa_id` nullable (NULL = global). Columns `fuente_clasificacion` + `regla_id` en `propuestas_ia` para trazabilidad SII. 15 reglas globales pre-cargadas cubriendo patrones chilenos: TRANSFER DE/A (p2p), ABONO POR TRF, CARGO POR TRANSF (gasto_egreso), crypto/forex, boletas/facturas, servicios (luz/agua/gas/internet), arriendo, remuneraciones, comisiones, impuestos SII, previsional. Processor bypass path: rules-first → Mistral fallback con confianza cap 0.75 (nunca auto-aprueba). Validación local: Cartola N°02 alcanza 100% de cobertura por reglas (675/675), cero llamadas a Mistral, tipos 650 p2p + 23 gasto_egreso + 2 crypto. Garantiza bit-exactitud repetible en clasificación.

**PR #52** — chore: ESLint 0 errores 0 warnings. 14 issues heredados arreglados: (1) setState-in-effect en ThemeToggle reemplazado por lazy useState, (2) disable comments justificados en PropuestaCard/SubirClient/ResumenClient para casos legítimos de fetch-on-deps y autocomplete desde datos externos, (3) import Image → ImageIcon en FileUpload (falso positivo jsx-a11y/alt-text), (4) remove unused vars en DocumentList, processor, ResumenClient. Parser validado: sigue dando 675/636/39 exactos.

**PR #51** — fix bugs de UI en /subir: (A) botón "Reprocesar" parpadeaba al subir archivo porque estado="subido" quedaba visible antes del cambio a "procesando" en after(). Fix: update síncrono en la route antes de retornar. (B) UI se quedaba en "Procesando" cuando el realtime perdía el UPDATE final. Fix: polling backup cada 3s mientras haya docs en procesando/subido + refetch al window focus. Zero cost cuando no hay docs procesándose.

**PR #50** — fix: saltar dedup intra-archivo en bypass mode. RUN 13 perdió 14 salidas legítimas: la cartola tiene múltiples cargos reales a SKIPO el mismo día con mismo monto, y el n_documento de esas filas es el RUT del destinatario (932758405), que isRutPattern no reconoce por falta de guión. En bypass mode skipeamos intra-batch dedup porque el parser garantiza 1 fila = 1 movimiento. Cross-file dedup se mantiene intacto.

**PR #49** — bypass de Mistral extraction. Cierra el último bug del audit: Mistral dropeando movimientos incluso con input pre-parseado. Nuevo método `AIProvider.classifyMovimientos()` + prompt clasificación-solo. `parseExcel` devuelve `{content, preExtracted, capa_usada}`. `procesarDocumento` acepta `preExtracted` opcional: si está presente, chunks la lista directamente y llama a `classifyChunkWithRetry` que echoa los movs (nunca los modifica) y fuerza `total=monto`. Fallback neutral si Mistral no devuelve propuesta para algún índice → zero pérdida. Skip saldo-filter en bypass (parser ya filtró). Garantiza 636/39/$50.2M/$51.7M exactos para Cartola N°02; variabilidad residual solo en campos clasificatorios (tipo_propuesto, receptor, confianza). Flujo no-cartola intacto.

**PR #48** — parser por capas con adapter cache + heurística universal. Reemplaza parseo monolítico de Excel por orchestrator con 4 capas: (0) cache por fingerprint estructural, (2) heurística universal sin nombres, (3) named matching, (4) legacy fallback. Validador con 6 checks bloqueantes (min_rows, fechas, montos>0, max_monto anti-saldo, max_rows, saldo_monotonía matemática) + 2 warnings. Cache global multi-tenant (`parser_adapters` sin empresa_id, zero leak — solo índices de columna) con health tracking (confianza 0-1, auto-disable <0.5). Auditoría en `parser_logs` por documento. Validado contra Cartola N°02: parse 1 capa 2 → 675/636/39 (\$50.206.203/\$51.715.000, match exacto); parse 2 capa 0 cache hit (4x más rápido). Capa 1 (Mistral structural analyzer) diferida a próximo PR.

**PR #47** — parser: pre-parseo determinístico de cartolas chilenas. Detecta header real (Fecha, Descripción, Cheques/Cargos, Abonos/Depósitos), salta metadata (Resumen del Período, Retenciones), descarta columna Saldo diario, y emite líneas auto-descriptivas `TIPO|FECHA|MONTO|DESCRIPCION|NDOC` con tipo_flujo pre-calculado. Validado contra Cartola real: match exacto con banco (636 abonos $50.206.203 / 39 cargos $51.715.000). Resuelve bugs del audit 10 runs: saldo corrupto (8/10) e inversión tipo_flujo. Fallback a sheet_to_csv genérico para Excels no-cartola.

**PR #46** — audit: capturar `finish_reason`, `response_full_length` y `tokens_output` en `audit_chunks` para diagnosticar truncation de Mistral por max_tokens. Motivado por RUN 7 chunk 2 que devolvió 18 movs vs ~100 esperados. Migración: `ALTER TABLE audit_chunks ADD COLUMN finish_reason/response_full_length/tokens_output`. Provider Mistral retorna `finishReason` del choice y largo del JSON crudo.
