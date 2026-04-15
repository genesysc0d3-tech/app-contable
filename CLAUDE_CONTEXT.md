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

*Última actualización: 15 Abril 2026 · rama `dev` · PRs #1-#85 mergeados · n8n workflow desactivado (guardado)*

**PR #85** — feat(upload): mapeo visual de campos para Excel. MVP del visual field mapper pedido por el contador. Usuario ve su Excel como grid, asigna roles a columnas, se guarda como adapter con `source: "manual"` indexado por fingerprint. Próximo archivo con el mismo fingerprint lo toma automático via Layer 0 del orchestrator (cero IA). **Backend**: **(1)** `lib/parsers/adapter-store.ts`: nueva `upsertManualAdapter` que UPDATE por fingerprint existente o INSERT nuevo, siempre con `source: "manual"`, `confianza: 1.0`, `disabled_until: null`. Pisa heuristic/named porque es palabra del usuario. **(2)** `POST /api/parser/preview`: descarga Excel via service client de Supabase Storage, usa XLSX, devuelve primeras 30 filas como `string[][]` + fingerprint + dimensiones + lista de hojas. **(3)** `POST /api/parser/save-mapping`: valida config mínimo (fecha, descripcion), upsertea adapter, si `reprocess=true` llama internamente a `/api/procesar-documento` pasando las cookies del request. **Frontend**: **(4)** `components/upload/FieldMapper.tsx` (modal overlay 100vh max-w-5xl): grid de 30 filas × N cols, cada col un `<select>` de roles (ignorar, fecha, descripción, n_documento, cargo, abono, monto, tipo_flujo, saldo). Roles únicos auto-limpian otros al asignarse. Controles: `header_row`, `first_data_row`, `date_format`, `layout` (two_cols / single_col / transactions_log), `default_tipo_flujo` condicional. Fila header resaltada en amarillo, primera fila de datos en accent claro. Dos CTAs: "Guardar solo" y "Guardar y reprocesar". **(5)** `DocumentList.tsx`: botón "Mapear campos" (ícono MagicWand, text-[#E8553E]) visible para Excel en `procesado`/`error`, dispara el modal.

**PR #84** — fix(revisar): scrollbar oculto en tab strip + botón "Aprobar bloque". **(1)** PR #83 usaba `className="scrollbar-none"` que no existe en Tailwind → scrollbar nativo asomaba feo bajo la tira de bloques. Agrego utility `.no-scrollbar` en `globals.css` (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`). **(2)** Focus ring azul default del browser salía en el tab activo. `focus:outline-none` + `focus-visible:ring-2 focus-visible:ring-[#E8553E]/40` para mantener a11y sin ruido visual. **(3)** Nuevo botón "Aprobar bloque (N)" al lado de "Aprobar todas" del grupo alta confianza cuando `useBlocks=true`. Ejecuta `aprobarTodas` solo sobre los IDs del bloque activo. Wrapper div con `onClick={(e) => e.stopPropagation()}` para que clickear el botón no colapse el grupo.

**PR #83** — feat(revisar): bloques como pestañas en escritorio. Feedback: los dividers verticales de PR #82 obligaban a scrollear infinito. Reemplazados por **tab strip horizontal**. **(1)** `ConfianzaGroup` suma state `activeBlock`. Cuando `useBlocks=true`, arma chunks de 10 y renderiza tabs clickeables con `overflow-x-auto` arriba del listado. **(2)** Tab activo: `bg-[#E8553E]`, `text-white`, sombra sutil `shadow-[0_1px_3px_rgba(232,85,62,0.3)]`. Inactivos: `border border-[var(--border)]` + `text-[var(--muted)]` con hover. Cada tab muestra "Bloque N" + contador compacto. **(3)** `safeBlock = Math.min(activeBlock, blocks.length - 1)` clampa el índice si queda fuera de rango después de procesar todos los items del último bloque. **(4)** Solo el bloque activo renderiza sus items → no hay scroll largo. Mobile `/revisar` sin cambios.

**PR #82** — feat(revisar): bloques de 10 en escritorio. Pedido del usuario: al mandar propuestas a revisar, agrupar visualmente de a 10 para trabajar por bloques sin que un straggler se mezcle con el siguiente batch. **(1)** `RevisarClient` acepta nuevo prop `layout?: "mobile" | "desktop"` (default `"mobile"`). Se thread-ea a `DocumentSection` y `ConfianzaGroup`. **(2)** `ConfianzaGroup`: cuando `layout === "desktop"` y `sorted.length > 10` y `tipo !== "ocultas"`, inserta un divisor cada 10 items con label "Bloque N" + línea + contador "X pend.". Tipo ocultas no lleva bloques (rara vez tiene volumen alto). **(3)** Secondary sort estable por `id.localeCompare` para que el orden (y por tanto la asignación a bloque) sea consistente entre refreshes. **(4)** `/escritorio` pasa `layout="desktop"`. Mobile `/revisar` no pasa nada → comportamiento actual intacto. **(5)** Usa `Fragment` para que cada divisor sea sibling del item-div y reciba el `space-y-3` del contenedor.

**PR #81** — feat: rediseño `/escritorio` (sidebar+main) + ocultar Resumen en ambas UIs. **Diagnóstico** (con `frontend-design`): el escritorio reusaba Clients mobile con sus h1 de 28px dentro de paneles sin chrome, layout 2-col se desbalanceaba al sacar paneles, CSS hack frágil (`> div.flex-1`), chrome caro sin densidad. **Rediseño**: **(1)** `TopBar` sticky `h-14` con dot naranja + razón social + fecha inline, `backdrop-blur-xl bg-background/80`, reemplaza el header grande. **(2)** Grid `lg:grid-cols-12`: sidebar `col-span-4 xl:col-span-3` con Subir, main `col-span-8 xl:col-span-9` con Revisar. Revisar es "spotlight" con `shadow-[0_8px_32px_-12px_rgba(232,85,62,0.18)]` para marcarlo como flujo principal. **(3)** Componente `Panel` con header propio (icon 8x8 rounded-lg + label 13px UPPERCASE bold + hint 11px muted). **(4)** CSS overrides scopeados ahora ocultan `.escritorio-col h1` y neutralizan el sticky interno (padding colapsado, fondo transparente) → no hay títulos duplicados. Removido el card styling frágil anterior; el Panel provee el chrome. **(5)** Resumen oculto en ambas UIs (mismo patrón que PR #80 Clientes): `BottomNav` queda con 2 entradas (Subir, Revisar); `/escritorio` elimina `ResumenPanel` e imports. Ruta `/resumen` y `ResumenClient` preservados.

**PR #80** — feat: ocultar tab Clientes de ambas UIs. Feedback del contador compañero: Clientes no es relevante por ahora. Se oculta de la navegación pero se preserva la ruta `/clientes` y `ClientesClient` para volver a exponerlo sin retrabajar. **(1)** `BottomNav.tsx`: sacado "Clientes" de `NAV_ITEMS` → quedan 3 pestañas (Subir, Revisar, Resumen). **(2)** `/escritorio/page.tsx`: eliminado el `ClientesPanel` del grid + import de `ClientesClient`. Layout queda: izquierda Subir + Resumen, derecha Revisar. **Regla nueva guardada en memoria** (`feedback_dual_ui.md`): todo cambio visible debe replicarse en ambas UIs (mobile BottomNav + escritorio grid).

**PR #79** — feat: settings gear + modo escritorio (`/escritorio`). **(1)** Nuevo `SettingsMenu` client en la barra superior (al lado del ThemeToggle): botón gear que abre popover con dos modos — "Teléfono" (navega a `/subir` con BottomNav) y "Escritorio" (navega a `/escritorio`, panel único). Cierra con click-outside o ESC; modo activo destaca en accent `#E8553E` con ícono `fill` + check. **(2)** Ruta `/escritorio` dentro del grupo `(app)` que compone los 4 tabs (Subir, Clientes, Revisar, Resumen) en un grid 2-col responsive (stack en <xl, 2-col en xl+). Cada sección en `<Suspense>` con skeleton shimmer propio → streaming paralelo. Izquierda: Subir + Clientes. Derecha: Revisar + Resumen. **(3)** Reutiliza los Client components tal cual. Overrides CSS en `globals.css` scopeados a `.escritorio-root .escritorio-col` neutralizan los wrappers mobile (`max-w-lg`, `pb-24`, `sticky top-0`, `py-6`, padding fijo) y transforman el `<div className="flex-1 pb-24">` externo de cada Client en una card con `rounded-[20px]`, `border`, `box-shadow`. Mantiene la estética sin tocar los componentes originales. **(4)** `BottomNav` retorna `null` cuando `pathname.startsWith("/escritorio")` — no se remonta entre tabs porque vive en layout. **(5)** Header del panel muestra eyebrow "Panel" + razón social grande + fecha en español, max width 1400px.

**PR #78** — perf(nav): skeletons reales + streaming Suspense + bundle más chico. La interfaz se sentía lenta y "pegada entre pestañas". Seis cambios en cascada: **(1)** `loading.tsx` de cada tab (subir/revisar/clientes/resumen) pasaba a ser `<div/>` vacío — pantalla blanca hasta que la query terminaba. Ahora muestran skeletons shimmer con la forma real del contenido. **(2)** `page.tsx` de cada tab devuelve el shell al instante; las queries pesadas corren dentro de un `<Suspense>` con fallback al skeleton (antes `Promise.all` bloqueaba el render). **(3)** Dedup de auth: `requireActiveEmpresa()` se removió de cada page — el layout ya protege. Pages usan `getUsuario()` directamente (React `cache` dedupe dentro del request). **(4)** Bundle: `experimental.optimizePackageImports: ["@phosphor-icons/react"]` en `next.config.ts` + `LineChart` ahora via `dynamic(ssr:false)` → chart.js sale del bundle inicial de `/resumen`. **(5)** Eliminado `PageTransition` (animación `page-in` de 300ms que demoraba visualmente cada navegación). **(6)** `BottomNav`: count inicial calculado en el layout y pasado como prop `initialPendientes` para evitar el flash "0 → count" en la primera carga; canal realtime sigue suscribiéndose una sola vez porque BottomNav vive en layout y no se remonta entre tabs.

**PR #77** — style: fuente Apple-like global + ajustes omitidos info. **(1)** `layout.tsx` reemplaza Geist por Inter (alternativa libre más cercana a SF Pro). `globals.css` antepone stack `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text"` así en macOS/iOS se renderiza con SF nativa; Inter queda como fallback en Linux/Windows. Agrega `-webkit-font-smoothing: antialiased`, `font-feature-settings: "cv11", "ss01", "ss03"` y `letter-spacing: -0.01em` para imitar el feel Apple. **(2)** `DocumentList`: ícono "i" de omitidos info vuelve a amarillo `#F59E0B`; texto del motivo siempre en `var(--muted-light)` (gris claro), sin diferenciación isInfo.

**PR #76** — style /subir: omitidos info en teal #14B8A6. Naranja (PR #75) chocaba con los warnings amarillos. Teal es complementario al naranja brand y se distingue claramente sin pelearse visualmente.

**PR #75** — style /subir: omitidos info naranja + badge oscuro para "Fila X". Texto e ícono de omitidos `info_only` cambian de azul (#3B82F6) a naranja (#F59E0B) para alinearse con la paleta warning de la app. El prefijo "Fila X" del motivo se renderiza ahora como un badge cuadrado de bordes redondeados con fondo gris oscuro (`#374151` light / `#1F2937` dark) y texto blanco, en vez de texto inline.

**PR #74** — feat /revisar: iconos phosphor para grupos de confianza. Reemplaza emojis (🟢🟡🔴🟠⚫) por íconos phosphor coloreados manteniendo los mismos colores: alta=CheckCircle verde, media=Warning amarillo, baja=WarningOctagon rojo, omitidos=WarningCircle naranja, ocultas=EyeSlash gris. Look más profesional, mismo significado visual.

**PR #73** — feat /revisar: editar directo desde thin row + ojo abierto en Ocultas. **(1)** `PropuestaCard` acepta nuevo prop opcional `initialEditing` que define el estado inicial de `editing`. `ConfianzaGroup` mantiene dos sets paralelos: `expandedCards` y `editCards`. Nueva función `editCard(id)` expande la card Y marca el flag de edición; `toggleCard` limpia el flag al contraer. El lápiz del ThinRow ahora abre la card directo en modo edición con los inputs visibles. **(2)** ThinRow recibe `isOculta` (true cuando `tipo === "ocultas"`). En esa sección el botón de ocultar muestra ícono Eye (ojo abierto), title "Restaurar" y llama `restaurarPropuesta` en lugar de `ocultarPropuesta`. Feedback visual claro: ojo abierto = click para desocultar.

**PR #72** — feat /revisar thin row con acciones + fix /subir omitidos info_only. **(1)** En `/revisar`, cada propuesta colapsada (PR #71) ahora muestra 3 íconos a la derecha: Check (aprobar — verde, llama `aprobarPropuesta` directo), PencilSimple (editar — naranja, expande la card), EyeSlash (ocultar — gris, llama `ocultarPropuesta`). Componente `ThinRow` extraído. **(2)** Fix /subir: la condición `!isInfo` en `DocumentList.renderItem` ocultaba checkbox y botones de acción para items `info_only` (introducidos en PR #68 para cartolas solo-abonos). Ahora checkbox y botón Ocultar siempre visibles; botón Agregar solo cuando NO es info_only (porque info_only ya está guardado).

**PR #71** — feat /revisar: cards colapsables por defecto. Tercer nivel de colapso pedido por el usuario (doc → confianza → renglón delgado → card completa). Cada propuesta empieza como un thin row con descripción, fecha, monto, receptor (si existe) y % de confianza. Click → expande a `PropuestaCard` (sin tocar el componente, solo se envuelve en `RevisarClient`). Estado por `Set<id>` local en `ConfianzaGroup`. Botón "Contraer" arriba de la card cuando está expandida. Permite scanear backlogs grandes mucho más rápido sin abrir cada tx.

**PR #70** — fix UI BottomNav: badge de Revisar soporta miles. Antes: tope "99+". Ahora formato compacto: 999 → "999", 1000 → "1k", 1234 → "1.2k", 12345 → "12k", ≥100000 → "99k+". Útil para backlogs grandes.

**PR #69** — fix UI /subir: prefijo `Fila X — ` también en items `info_only`. El prefijo del motivo estaba condicionado a `!isInfo`, así que en cartolas solo-abonos (PR #68) los duplicados info_only aparecían en azul pero sin indicar la fila del Excel. Fix: condicionar a `dupTipo !== "multi_transfer_p2p"` (único caso sin fila concreta) en vez de `!isInfo`. Color del prefijo se ajusta al esquema azul cuando isInfo.

**PR #68** — feat processor: cartola solo-abonos + saldo check solo positivo. Cambio basado en feedback de Contador Auditor: las cartolas filtradas solo-abonos son un caso de uso normal porque el contador solo procesa abonos (cada uno = potencial venta/op gravada para F29). Pagos P2P repetidos del mismo cliente el mismo día son legítimos en negocios de exchange. **(1)** Detecta `cartolaSoloAbonos = (≥10 filas && every entrada)`. **(2)** Intra-file loose dup en solo-abonos: NO omitir, se marca `isInfoWarning=true` → se guarda el mov + flag `info_only` en el visor (no bloquea). **(3)** `saldo_check` reducido a `"operaciones_reales" | undefined` — eliminada la rama "real_banco" porque cartolas filtradas u orden no-cronológico estricto generan falsos positivos recomendando omitir tx legítimas. **(4)** UI: removido el highlight rojo "duplicado del banco". Solo queda el verde "operaciones reales confirmadas" con monto y filas explícitas para auditabilidad SII.

**PR #67** — fix processor: motivo de duplicado usa `excel_row` real del conflicto. El texto del motivo seguía usando `seen.firstIndex + 1` (posición parseada), mientras que el prefijo del UI ya usaba `excel_row`. Inconsistente: prefijo decía "Fila 43" pero motivo decía "fila 30". Fix: leer `excel_row` del registro conflictivo desde `movimientosParsed` y usarlo en los strings de motivo de `loose_mismo_arch` y `mismo_ndoc_mismo_arch`. Fallback a `firstIndex + 1` si excel_row no existe.

**PR #66** — fix processor: strip `excel_row`/`saldo` antes del insert en `movimientos_raw`. Bug introducido en PR #65: `movimientosParsed` cargaba ambos campos para la validación de duplicados, pero la tabla no los tiene y PostgREST rechazaba con `Could not find the 'excel_row' column`. Fix: destructurar y descartar al construir `movimientosToInsert`. Solo viven en memoria para el dup check.

**PR #65** — feat parser+upload: fila real Excel + validación matemática del saldo en duplicados intra-archivo. (1) `ParsedLine`/`PreExtractedMovimiento`/`MovimientoExtraido` ahora cargan `excel_row` (1-based desde `applyAdapter`). `DuplicadoDetalle` expone `excel_row` y `excel_row_conflicto`. La UI prefiere `excel_row` sobre `indice_archivo + 1` (que era posición en la lista parseada, no la fila del Excel). (2) Para `loose_mismo_arch` y `mismo_ndoc_mismo_arch`, si ambas filas tienen `saldo`, se compara `|saldo[i] − saldo[ref]| ≈ monto` con tolerancia ±1 peso. Match → `saldo_check="operaciones_reales"` (sugerir Agregar igual), mismatch → `saldo_check="real_banco"` (error de exportación del banco, mantener omitido). UI muestra highlight verde/rojo arriba del motivo. Caso real Santander: FRANKLIN (74541) marca real_banco, MILLACURA (1M) marca operaciones_reales.

**PR #64** — fix UI /subir: leak de "0" en barra de progreso. `hasProgress = total_lotes && lote_actual` retornaba `0` (no `false`) cuando `lote_actual=0` y `total_lotes>0`, y React renderizaba ese 0 literal en `{hasProgress && (...)}`. Aparecía como un "0" suelto al lado del badge "Procesando" justo antes de completar. Fix: `Boolean(total_lotes && lote_actual)`. Bug clásico de coerción JSX.

**PR #63** — UI /subir: mostrar fila origen en omitidos. Cada item omitido ahora muestra `Tx en fila X — ` (en negrita) prefijando el motivo, para que el usuario sepa en qué fila del archivo está la transacción duplicada (no solo con cuál se compara). Usa `dup.indice_archivo + 1`, ya disponible en `DuplicadoDetalle`. Cambio solo en `DocumentList.tsx:renderItem`. No aplica a items informativos (multi_transfer_p2p, info_only).

**PR #62** — parser: soporte Santander. Cuando subimos CartolasPruebaSantander.xlsx (238 movs) cayó a capa 4 legacy. 3 fixes: (1) tipo flag de 1 letra A/C/D/H — Santander usa "A" en vez de "Abono", (2) skip saldo monotonia check en single_col — fallaba 89% porque las filas Santander están en orden DESC y/o saldo es pre-tx; el check 6 solo aplica a two_cols donde no hay otra fuente de verdad para distinguir cargo/abono; en single_col tenemos un tipo flag explícito, (3) migración broaden_transfer_rules: regla `\b(TRANSFER|TRANSFERENCIA|TRANSF)\b` sin anchor ni tipo_flujo_match (Santander usa "<num cuenta> Transf de NOMBRE"), regla "Depósito en efectivo". Validado: 238/238 entradas $69.807.341, 238/238 clasificadas por reglas, cero Mistral.

**PR #61** — parser: tercer layout `transactions_log`. Cuando subimos transacciones_prueba.xlsx (planilla manual de ventas P2P con fecha/desc/monto sin tipo flag ni saldo) cayó a capa 4 legacy. Nuevo layout: detecta fecha + desc + 1 monto, default_tipo_flujo configurable (entrada por defecto). Heurística para columna monto: solo numéricos en rango 1000-1B, excluye RUTs y teléfonos chilenos (~5.7e10). Validado: 5/5 extraídas con monto correcto, 5/5 clasificadas como compraventa_crypto.

**PR #60** — feat /revisar: sección Omitidos huérfanos + Ocultar reversible + motivo preservado. (1) Los duplicados huérfanos (cuyo padre ya fue aprobado) ya no se mezclan con alta/media/baja: tienen su propia sección naranja con mensaje explicativo. (2) Botón "Ignorar" reemplazado por "Ocultar" reversible: nuevo estado='oculto' (migración add_oculto_estado), nuevas server actions ocultarPropuesta/restaurarPropuesta, sección "Ocultas" gris al final, botón se invierte a "Restaurar" con icono Eye cuando ya está oculta. (3) Motivo del omitido se pasa via API /forzar-movimiento y se prepende a notas como "Motivo original: ..." para que se vea en /revisar.

**PR #59** — fix /revisar: omitidos huérfanos quedan visibles tras aprobar el parent. Bug: cuando un omitido (duplicado aceptado desde /subir) se nestaba bajo su propuesta original y el usuario aprobaba la original, el omitido quedaba pendiente en DB pero la UI dejaba de mostrarlo (su key ya no matcheaba ningún parent). Fix: detectar omitidos huérfanos y agregarlos a `pendientes` como cards standalone con su badge "Desde omitidos". Nunca desaparecen sin acción explícita.

**PR #58** — fix UI: remover botón Ignorar del desplegable de propuestas duplicadas. El usuario pidió que el dup nunca desaparezca sin acción explícita. Quedan solo Aprobar y Devolver. El "ojito" para ocultar omitidos en /subir se mantiene intacto.

**PR #57** — fix: restaurar flujo omitido para dups intra-archivo en bypass mode. Revierte PR #55 (auto-insert + warning informativo). El usuario pide control manual sobre cada duplicado para SII: dup → omitido por defecto → muestra en visor con motivo → "Agregar igual" para insertar. Acepta la fricción de SKIPO (14 dups manuales) a cambio de explícita verificación. processor.ts: shouldSkip=true para intra-file en bypass igual que legacy. DocumentList.tsx revertido al render unificado de omitidos. info_only queda como flag latente en types para futuro uso.

**PR #56** — UI: mostrar warnings informativos del bypass mode. RUN 19 guardaba 10/10 incluyendo duplicado pero la UI no avisaba porque la condición del visor era `dupCount > 0`. Ahora `DuplicadoDetalle.info_only` distingue warnings (movs guardados) de omitidos (movs descartados); processor.ts marca info_only=true para intra-file dups en bypass; DocumentList.tsx visor se renderiza si hay warnings, splitea en 2 secciones ("omitidos" con acciones y "avisos para revisar" informativos con icono azul).

**PR #55** — fix: intra-file dups como warning en bypass mode. RUN 18 guardaba 10/10 correctamente pero no avisaba del duplicado. PR #50 había deshabilitado completamente el intra-batch dedup en bypass para fix del caso SKIPO, matando también la señal informativa. Ahora separado: `shouldSkip` (descarta: cross-file + legacy intra-file) vs `isInfoWarning` (mantiene el mov + flaguea en duplicadosDetalle: bypass intra-file). Mensajes ajustados explicando que son operaciones reales guardadas para que el usuario revise.

**PR #54** — parser: soporte layout `single_col` + reglas ampliadas. Nuevo layout en la heurística para cartolas con 1 columna Monto + 1 columna Tipo (Abono/Cargo) en vez de 2 mutuamente exclusivas. `AdapterConfig.layout` + `columns.monto/tipo_flujo_col` opcionales. `countEquationMatches()` usa `saldo[i] = saldo[i-1] ± monto[i]` para discriminar monto vs saldo de forma matemática (evita heurísticas de rango). `REQUIRED_CONSECUTIVE` bajado a 3 para cartolas chicas. Migración expand_global_rules: TRANSFERENCIA|TRANSFER RECIBIDA/ENVIADA, tipo_flujo_match=NULL en boletas/facturas, patrones COMPRA/PAGO/marketplaces/gateways, crypto prioridad 70 (gana sobre forex en USDT), forex regex con word boundaries. Validado contra cartola_prueba_10mov.xlsx: 10/10 extraídas con monto correcto, 100% clasificadas por reglas, cero Mistral.

**PR #53** — classifier determinístico por reglas antes de Mistral. Tabla `clasificacion_reglas` con `empresa_id` nullable (NULL = global). Columns `fuente_clasificacion` + `regla_id` en `propuestas_ia` para trazabilidad SII. 15 reglas globales pre-cargadas cubriendo patrones chilenos: TRANSFER DE/A (p2p), ABONO POR TRF, CARGO POR TRANSF (gasto_egreso), crypto/forex, boletas/facturas, servicios (luz/agua/gas/internet), arriendo, remuneraciones, comisiones, impuestos SII, previsional. Processor bypass path: rules-first → Mistral fallback con confianza cap 0.75 (nunca auto-aprueba). Validación local: Cartola N°02 alcanza 100% de cobertura por reglas (675/675), cero llamadas a Mistral, tipos 650 p2p + 23 gasto_egreso + 2 crypto. Garantiza bit-exactitud repetible en clasificación.

**PR #52** — chore: ESLint 0 errores 0 warnings. 14 issues heredados arreglados: (1) setState-in-effect en ThemeToggle reemplazado por lazy useState, (2) disable comments justificados en PropuestaCard/SubirClient/ResumenClient para casos legítimos de fetch-on-deps y autocomplete desde datos externos, (3) import Image → ImageIcon en FileUpload (falso positivo jsx-a11y/alt-text), (4) remove unused vars en DocumentList, processor, ResumenClient. Parser validado: sigue dando 675/636/39 exactos.

**PR #51** — fix bugs de UI en /subir: (A) botón "Reprocesar" parpadeaba al subir archivo porque estado="subido" quedaba visible antes del cambio a "procesando" en after(). Fix: update síncrono en la route antes de retornar. (B) UI se quedaba en "Procesando" cuando el realtime perdía el UPDATE final. Fix: polling backup cada 3s mientras haya docs en procesando/subido + refetch al window focus. Zero cost cuando no hay docs procesándose.

**PR #50** — fix: saltar dedup intra-archivo en bypass mode. RUN 13 perdió 14 salidas legítimas: la cartola tiene múltiples cargos reales a SKIPO el mismo día con mismo monto, y el n_documento de esas filas es el RUT del destinatario (932758405), que isRutPattern no reconoce por falta de guión. En bypass mode skipeamos intra-batch dedup porque el parser garantiza 1 fila = 1 movimiento. Cross-file dedup se mantiene intacto.

**PR #49** — bypass de Mistral extraction. Cierra el último bug del audit: Mistral dropeando movimientos incluso con input pre-parseado. Nuevo método `AIProvider.classifyMovimientos()` + prompt clasificación-solo. `parseExcel` devuelve `{content, preExtracted, capa_usada}`. `procesarDocumento` acepta `preExtracted` opcional: si está presente, chunks la lista directamente y llama a `classifyChunkWithRetry` que echoa los movs (nunca los modifica) y fuerza `total=monto`. Fallback neutral si Mistral no devuelve propuesta para algún índice → zero pérdida. Skip saldo-filter en bypass (parser ya filtró). Garantiza 636/39/$50.2M/$51.7M exactos para Cartola N°02; variabilidad residual solo en campos clasificatorios (tipo_propuesto, receptor, confianza). Flujo no-cartola intacto.

**PR #48** — parser por capas con adapter cache + heurística universal. Reemplaza parseo monolítico de Excel por orchestrator con 4 capas: (0) cache por fingerprint estructural, (2) heurística universal sin nombres, (3) named matching, (4) legacy fallback. Validador con 6 checks bloqueantes (min_rows, fechas, montos>0, max_monto anti-saldo, max_rows, saldo_monotonía matemática) + 2 warnings. Cache global multi-tenant (`parser_adapters` sin empresa_id, zero leak — solo índices de columna) con health tracking (confianza 0-1, auto-disable <0.5). Auditoría en `parser_logs` por documento. Validado contra Cartola N°02: parse 1 capa 2 → 675/636/39 (\$50.206.203/\$51.715.000, match exacto); parse 2 capa 0 cache hit (4x más rápido). Capa 1 (Mistral structural analyzer) diferida a próximo PR.

**PR #47** — parser: pre-parseo determinístico de cartolas chilenas. Detecta header real (Fecha, Descripción, Cheques/Cargos, Abonos/Depósitos), salta metadata (Resumen del Período, Retenciones), descarta columna Saldo diario, y emite líneas auto-descriptivas `TIPO|FECHA|MONTO|DESCRIPCION|NDOC` con tipo_flujo pre-calculado. Validado contra Cartola real: match exacto con banco (636 abonos $50.206.203 / 39 cargos $51.715.000). Resuelve bugs del audit 10 runs: saldo corrupto (8/10) e inversión tipo_flujo. Fallback a sheet_to_csv genérico para Excels no-cartola.

**PR #46** — audit: capturar `finish_reason`, `response_full_length` y `tokens_output` en `audit_chunks` para diagnosticar truncation de Mistral por max_tokens. Motivado por RUN 7 chunk 2 que devolvió 18 movs vs ~100 esperados. Migración: `ALTER TABLE audit_chunks ADD COLUMN finish_reason/response_full_length/tokens_output`. Provider Mistral retorna `finishReason` del choice y largo del JSON crudo.
