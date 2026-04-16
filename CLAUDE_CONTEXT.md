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

*Última actualización: 16 Abril 2026 · rama `dev` · PRs #1-#120 mergeados · n8n workflow desactivado (guardado)*

**PR #120** — fix(clasificador): hint del usuario prevalece sobre heurísticas. Al marcar cartola santander como P2P cripto, las filas se pintaban AFE porque la suma de `angleGlosa` (match "transf", 0.35) + `anglePatron` (match "mismo receptor mismo día ≥2", 0.65) = 1.0 superaba el hint 0.90 y ganaba afecta — tributariamente incorrecto (Art. 2 N°3 DL 825 + Of. SII 963/2018, cripto = activo incorporal exenta). **Fix** `lib/sii/clasificador-tipo.ts`: (1) short-circuit en `clasificarBoleta` — si hint ∈ {p2p_cripto, forex_divisas, servicios, ventas} el veredicto del hint es autoritativo y se salta el ensemble; (2) `anglePatron` siempre neutral, repetición/monto redondo son la misma huella en cripto y retail recurrente, sin glosa no discrimina afecta/exenta; (3) `glosa.no_boletar` con peso ≥ 0.7 sigue prevaleciendo sobre el hint (transf entre cuentas propias dentro de cartola cripto NO se boletea, aunque la cartola esté marcada como cripto). Las 3 migraciones de boletas pendientes (`boletas_sii_mock`, `boletas_propuesta_link`, `documento_tipo_hint`) aplicadas en Supabase vía MCP el 2026-04-16.

**PR #119** — fix(hint): auto-flip del dropdown. El menú con portal+fixed se salía del viewport cuando el card estaba cerca del bottom. Fix: `useLayoutEffect` calcula `spaceBelow` y `spaceAbove` del botón, si `spaceBelow < 280px` (altura estimada) y `spaceAbove > spaceBelow` → abre hacia arriba. También alinea horizontalmente si `left + menuWidth > viewport`. `maxHeight` del menú = `calc(100vh - top - 16px)` con `overflow-y auto` para viewports chicos.

**PR #118** — fix(hint): dropdown del HintSelector via portal. El menú se cortaba por el `overflow-hidden` del card de doc en DocumentList. Mismo patrón usado en `ColumnChip` del FieldMapper (PR #87): `createPortal` a `document.body` con `position: fixed` calculada desde `getBoundingClientRect()` del botón via `useLayoutEffect`. Cierra en `scroll`/`resize` para no desalinearse, `z-[200]`.

**PR #117** — feat(boletas): hint por cartola (P2P/Forex/Servicios/Ventas) → clasificador. Problema: el clasificador (glosa + giro + patrón) no detecta el tipo cuando las glosas son genéricas como "Transf de Juan Perez" sin mencionar cripto explícitamente. Fix: el usuario marca cada cartola con un hint que el clasificador usa como 4to ángulo con peso alto (0.85-0.90) pisando los demás. **Migration** `20260416_documento_tipo_hint.sql`: `documentos_subidos.tipo_operacion_hint text` nullable. Valores: `p2p_cripto`, `forex_divisas`, `servicios`, `ventas`, `mixto` (o null = mixto). **Server action** `src/app/(app)/subir/actions.ts` `setDocumentoHint(documentoId, hint)`: service role + scoping por empresa_id, validación del valor contra set válido, `revalidatePath` de `/subir` y `/escritorio`. **Clasificador** (`lib/sii/clasificador-tipo.ts`): nuevo tipo exportado `DocumentoHint`, nueva función `angleHint` (`p2p_cripto/forex_divisas → exenta 0.90`, `servicios/ventas → afecta 0.80`, `mixto/null → neutral`). `clasificarBoleta` acepta parámetro opcional `hint` sumado al ensemble. **Endpoint** `pendientes-emision`: query incluye `documentos_subidos(tipo_operacion_hint)` en nested select, lee hint por propuesta via movimiento_raw, pasa al clasificador. **UI** `components/upload/HintSelector.tsx`: dropdown pill "💡 Tipo: <valor>" con 5 opciones + descripción, optimistic update con rollback en error, toast. `DocumentList.tsx` renderiza `HintSelector` junto a Mapear campos para docs en estado "procesado".

**PR #116** — fix(sii): cripto/P2P y forex son EXENTAS, no afectas. Corrección de clasificador por feedback del usuario. Las criptomonedas son **activos incorporales/digitales** (Of. SII 963/2018), no bienes corporales muebles → el hecho gravado básico de IVA (Art. 2 N°3 DL 825) NO aplica → **la venta de cripto NO paga IVA**. La renta tributa en Primera Categoría (25%/27%) si hay habitualidad, pero eso va por F22/F29, no por el tipo de DTE. En la práctica los contadores documentan P2P cripto como **Boleta Exenta (Tipo 41)** para dejar trazable el ingreso. **Cambios** en `lib/sii/clasificador-tipo.ts`: **(1)** Ángulo Glosa keywords cripto (usdt, btc, ethereum, binance, p2p, buda, etc) ahora votan EXENTA con peso 0.85 + razón "activo incorporal, no IVA (Of. SII 963/2018, Art. 2 N°3 DL 825)". Antes votaban afecta. **(2)** Nueva regla glosa: forex/divisas (`forex|fx|usd|d[oó]lar|euro|cambio de divisa`) → EXENTA peso 0.70. Mismo principio: divisas no son bien corporal mueble. **(3)** Ángulo Giro: si giro incluye `cripto|exchange|p2p|forex|divisa|criptomoneda|criptoactivo` → vota EXENTA peso 0.50 (antes votaba afecta). Servicios profesionales (consultor, software, asesor, etc) siguen AFECTA.

**PR #115** — fix(boletas): incluir `transferencia_p2p`, `compraventa_crypto`, `operacion_forex` como tipos emitibles. Las 10 propuestas P2P del Santander aprobadas no pasaban a Emitir porque el filtro exigía `tipo_propuesto="boleta"` pero la IA las clasifica con tipos específicos (`transferencia_p2p`, `compraventa_crypto`, `operacion_forex`). Fix: constante `TIPOS_EMITIBLES = ["boleta", "transferencia_p2p", "compraventa_crypto", "operacion_forex"]` aplicada en `pendientes-emision` query principal (`.in("tipo_propuesto", TIPOS_EMITIBLES)`) y en el hint de "otros tipos aprobados" (`.not("tipo_propuesto", "in", ...)` para que solo muestre realmente NO emitibles). `emitir-lote` validación por propuesta acepta los 4 tipos, error_message "Tipo X no se emite como boleta" si viene otro. Quedan FUERA por diseño: `factura_afecta` (contador dijo no facturas por ahora), `boleta_honorarios` (flujo diferente — PN segunda categoría, otro DTE), `gasto_egreso`/`no_comercial`/`factura`/`ignorar` (no son ingresos). El clasificador SII de PR #114 decide afecta/exenta para cada uno.

**PR #114** — feat: clasificador SII afecta/exenta + fix bloques hydration. **(1)** Bloques renumeraban tras reload por hydration mismatch (lazy `useState` leía localStorage en cliente, server sin acceso → calculaba desde 1; al hidratar saltaban). Fix: gate `mounted` (`useState(false)` + `useEffect(() => setMounted(true))`) → `useBlocks` queda false hasta cliente, blockMapRef vacío al inicio + useEffect carga desde localStorage al mount. Sin SSR mismatch. **(2)** Clasificador `lib/sii/clasificador-tipo.ts` con **3 ángulos ensemble** (replica criterio SII): **Ángulo 1 Glosa** keywords/regex sobre descripción — NO_BOLETAR (transferencias entre cuentas propias, devoluciones, préstamos, aportes capital, sueldos), EXENTA (educación Art. 13 N°4, salud Art. 12 letra E N°7, transporte pasajeros Art. 13 N°3, arriendo no amoblado, exportación), AFECTA (cripto/P2P Of. SII 963/2018, servicios profesionales, ventas, comisiones; default suave para "transferencia recibida sin contexto"). **Ángulo 2 Giro** `empresas.giro` determina probabilidad base. **Ángulo 3 Patrón** ≥2 ops mismo día mismo receptor → exchange P2P → afecta; recurrente mensual → afecta; monto redondo > $100k → cripto. **Ensemble**: suma pesos por veredicto. NO_BOLETAR prevalece si peso > 0.5. Entre afecta/exenta gana mayor peso, default afecta en empate. Retorna `{tipo_dte, sugerencia, confianza, razones[], angulos}`. **Endpoint** `pendientes-emision`: pre-procesa patrones por (receptor,día/mes), cada item ahora trae `tipo_sugerido` (39|41|null), `sugerencia`, `confianza_clasif`, `razones[]`. Si `sugerencia="no_boletar"` → `listo_emitir=false` con motivo explícito. **Endpoint** `emitir-lote` acepta nuevo body `{items: [{id, tipo_dte}]}` con tipo per propuesta. CAF correcto se consume según tipo. **UI** `EmitirBoletaForm`: cada item muestra `💡 razón` del clasificador, `TipoToggle` [AFE]/[EXE] (naranja/azul) por item con override del sugerido marcado `●` ámbar. `emitirSeleccionadas` envía items con tipo final.

**PR #113** — fix: bloques persistentes al recargar + Emitir hint si otro tipo. **(1)** `blockMapRef` de PR #101 vivía solo en memoria del componente — al recargar, IDs nuevos arrancaban desde block 1 y todo se renumeraba. Fix: persisto el map en `localStorage` con key `app-contable:blockmap:{documentoId}:{tipo}`. Lazy init via `useState` con función lee desde localStorage al mount; cuando se asignan IDs nuevos en el `useMemo`, persiste con `JSON.stringify(Array.from(map.entries()))`. `ConfianzaGroup` recibe nuevo prop `documentoId` (thread-eado desde `DocumentBody` en las 5 invocaciones via sed). Ahora "ya procesé el bloque 2" sigue siendo "Bloque 2" tras reload. **(2)** Emitir vacío sin contexto. Si usuario aprobó propuestas pero ninguna tipo "boleta" (puede ser factura/gasto/registro_crypto), Emitir mostraba "no hay nada" sin explicar por qué. Fix endpoint `pendientes-emision`: query auxiliar cuando `items.length === 0` que cuenta propuestas aprobadas de OTROS tipos via `.neq("tipo_propuesto", "boleta")`. Retorna `aprobadas_otros_tipos: { factura: 5, gasto: 12, ... }`. Fix UI `EmitirBoletaForm`: si no hay items pero hay otros tipos, hint amarillo con breakdown por tipo (Factura/Gasto/Registro crypto/etc) + instrucción de cambiar tipo en Revisar via ✏.

**PR #112** — fix(revisar): aprobaciones persisten via service role. **Bug**: aprobar tx o bloque sacaba items de pantalla con animación, pero al recargar seguían pendientes. Tab Emitir quedaba vacío. **Causa**: política RLS de UPDATE en `propuestas_ia` bloqueando silenciosamente desde sesión de usuario — `.update().select()` retornaba data vacía → count 0 → acción decía "ok count:0" pero nada se persistía. **Fix**: nuevo helper `getEmpresaAndService()` que autentica, fetcha `empresa_id`, y devuelve service-role client. **Todas** las acciones de `revisar/actions.ts` (aprobarPropuesta, ocultarPropuesta, restaurarPropuesta, descartarPropuesta, editarPropuesta, aprobarTodas, devolverAOmitidos) ahora usan service role + `.eq("empresa_id", empresaId)` para mantener seguridad sin depender de RLS. `count: "exact"` en cada update verifica filas modificadas; si 0 → retorna error claro → frontend hace rollback de la animación optimistic. `revalidatePath` suma `/escritorio` (antes solo `/revisar`). `devolverAOmitidos` también scopeada por empresa (antes select sin filtro).

**PR #111** — feat(boletas): emisión en lote desde propuestas aprobadas. Rediseño total del tab Emitir según lógica del negocio (clientes P2P / exchangers necesitan emitir cientos de boletas sin form por cada una). Flujo: aprobás propuestas tipo boleta en Revisar → aparecen automáticamente en bandeja Emitir → seleccionás (auto pre-seleccionadas las listas) → click "Emitir N" → todas pasan a Boletas con folios. **Migration** (`20260415_boletas_propuesta_link.sql`): ALTER `boletas_emitidas` add `propuesta_id uuid REFERENCES propuestas_ia(id) ON DELETE SET NULL`. UNIQUE INDEX parcial `WHERE propuesta_id IS NOT NULL AND estado <> 'anulada'` — una propuesta solo puede tener una boleta vigente, permite re-emitir si se anuló. **Endpoints**: `GET /api/intermediaria/pendientes-emision` (propuestas tipo boleta aprobado/editado no emitidas, con cliente.rut + cliente.nombre como fallback de receptor, calcula `listo_emitir` por validación SII, retorna `{items, totales}`). `POST /api/intermediaria/emitir-lote` (max 200, secuencial para preservar orden de folios, por cada propuesta: verifica ownership/estado/tipo/no-duplicada → resuelve receptor → `validarBoleta` → consume folio via RPC atómica → genera DTE+TED+trackId → persiste con `propuesta_id` link. Si se acaban folios mid-lote, marca resto SIN_FOLIOS y corta. Retorna `{exitos, fallos, monto_emitido, resultados[]}`). **UI** `EmitirBoletaForm` rewrite total (ya no es form): carga pendientes al mount, auto-selecciona listas, stats arriba ("X listas" + chip bloqueadas), filtros pills (Listas/Bloqueadas/Todas), checkbox "Seleccionar todas visibles", lista con checkboxes + warning amarillo si bloqueada (+ motivo "Falta RUT receptor"), sticky bar bottom-2 ("N seleccionadas · Total $X" + botón "Emitir N" con spinner), toast resumen post-batch ("23 emitidas, 2 con error"), refresh local + router.

**PR #110** — feat(boletas): tres tabs Revisar/Emitir/Boletas con UI completa. Sube de 2 a 3 tabs en el spotlight panel del escritorio. **(1)** `RevisarBoletasTabs` ahora acepta 3 props (`revisarContent`, `emitirContent`, `boletasContent`). 3 pills en header (CheckSquare / PaperPlaneTilt / Receipt). Las 3 montadas con `display: none/block` para preservar state. **(2)** Nuevo `components/boletas/EmitirBoletaForm.tsx` (client): toggle pills Afecta(39)/Exenta(41), receptor con RUT auto-format al blur + badge "Obligatorio" en naranja cuando `total > $180.000` (Res. Ex. 174/2017), detalle multi-línea con add/remove, total grande tabular abajo. Submit deshabilitado hasta `canSubmit` (monto > 0, líneas válidas, receptor si requiere). POST a `/api/intermediaria/emitir-boleta`, toast del primer `errores[0].message` si falla, success state con folio + monto, reset form, `router.refresh()`. **(3)** Nuevo `components/boletas/BoletasList.tsx` (RSC): query `boletas_emitidas` limit 20 ordenado por fecha+folio desc. Cast loose `as unknown as any` porque tabla no está en `database.types` aún (migration pendiente). Try/catch → empty state si tabla falta. Lista con `#folio` + badge AFECTA/EXENTA color por tipo + receptor + fecha + monto. Badge ANULADA muted si `estado="anulada"`. **(4)** Eliminada `BoletasPanel` placeholder de `escritorio/page.tsx`.

**PR #109** — feat(sii): backend mock para boletas electrónicas (PR 1/N). Sistema de emulación SII para emitir boletas tipo 39 (afecta) y 41 (exenta). Replica restricciones reales del SII validadas con `contador-tributario-chileno`. **NO conecta al SII real**. Validaciones que emula: RUT módulo 11 oficial, receptor obligatorio si total > $180.000 (Res. Ex. 174/2017), IVA 19% redondeado al peso, total = neto + IVA tolerancia ±1, exenta sin IVA, folios CAF secuenciales no reutilizables vencen 6m, TED + XMLDSig estructura oficial. **Migration** (`supabase/migrations/20260415_boletas_sii_mock.sql`): `boletas_caf_mock` (rangos folios por empresa+tipo), `boletas_emitidas` (snapshot completo con XML/TED/track_id/referencia opcional para NCs), RLS por empresa via `usuarios`, función SQL `consume_next_folio(empresa, tipo)` atómica con `FOR UPDATE`. **Lib** (`src/lib/sii/`): `validation.ts` (cleanRut, validarRut módulo 11, calcularIVA, descomponerBruto, `validarBoleta` consolidada), `dte-xml.ts` (`generarTED`, `generarDTE` conforme EnvioBOLETA_v10.xsd con namespaces, `generarTrackId`). **Endpoints**: `POST /api/sii-mock/dte/recibir` (valida estructura mínima, retorna track_id mock + ACEPTADO), `POST /api/sii-mock/caf/solicitar` (rango secuencial 10-1000 folios), `POST /api/intermediaria/emitir-boleta` (Haulmer-style: auth, valida, RPC consume_next_folio, genera DTE, fetch interno a sii-mock, persiste), `GET /api/intermediaria/folios-disponibles` (agrega restantes por tipo). **Pendiente** (próximos PRs): UI emisión, NC anulación, alta emisor, módulo exenta separado, PDF visual, RCOF mock. Migration NO se aplica auto — aplicar manual via Supabase Dashboard SQL Editor.

**PR #108** — fix(mapper): scrollbar oculto + columnas vacías colapsadas + sync scroll. 3 fixes: **(1)** `.no-scrollbar` agregado a los `overflow-x-auto` de `BlockHeader` y `BlockData` (estaba visible antes, feo). **(2)** Columnas vacías colapsadas. `GridView` `useMemo` `emptyCols: Set<number>` detecta cols con header row vacío AND sin data content en filas visibles. Pasado a `BlockHeader`/`BlockData` que aplican `w-8 min-w-8 max-w-8 px-0` en esas cols (en vez de `min-w-[140px]`). Chip/arrow/label-input/data cells NO se renderizan — solo muestra `"–"` muted. Más columnas caben sin scroll. **(3)** Sync scroll. `GridView` crea `headerScrollRef` y `dataScrollRef`, `useEffect` agrega scroll listeners (`passive: true`) con check `scrollLeft !== other.scrollLeft` para sincronizar sin infinite loop (asignar el valor ya presente no dispara scroll event). Refs pasados a los `overflow-x-auto` de cada bloque via prop `scrollRef`.

**PR #107** — fix: Revisar chrome duplicado + títulos editables en mapper. **(1)** `RevisarBoletasTabs` (PR #106) envolvía `revisarContent` sin aplicar la clase `.escritorio-col` que usan las reglas CSS del grupo escritorio (globals.css) para ocultar el h1 interno de `RevisarClient` + neutralizar su sticky header. Resultado: aparecían dos chromes "Revisar". Fix: agregar `className="escritorio-col"` al div wrapper del tab revisar. **(2)** Feedback del mapper: la fila header detectada por auto-detect puede no ser la más informativa y algunas columnas quedan "(vacío)". Usuario quiere guiarse visualmente sin volver al Excel. `FieldMapper` suma state `columnLabels: string[]` sincronizado al header row via `useEffect` (reset al cambiar `headerRow`). Thread a `GridView` → `BlockData`. `BlockData` ahora renderiza `<thead><tr>` con `<input>` editables (uno por columna) arriba de los data rows: `text-[11px] font-bold center`, `bg-transparent` con `placeholder:italic "(escribí un título)"`, focus ring suave `bg-white/60` dark `bg-black/30`. Aplica `columnTint` en la `<th>` heredando el color de rol (fecha=azul, glosa=teal, etc). Los labels son SOLO visuales — no se envían al servidor ni afectan `AdapterConfig`.

**PR #106** — feat(escritorio): Boletas como tab dentro de Revisar (no Capturar). Feedback: Boletas encaja mejor junto a Revisar (ambos son flujos de "revisión + emisión de documentos tributarios") que junto a Capturar (flujo de entrada de datos). **(1)** Nuevo `components/RevisarBoletasTabs.tsx` (client, spotlight). Card único con tabs "Revisar" / "Boletas" como pills en la esquina derecha del header. Icon box solid `#E8553E` siempre (es el spotlight), el icon cambia según tab activa (`CheckSquare` / `Receipt`). Header muestra label + hint dinámico. Contenidos montados con `display: none/block` para preservar state al cambiar tab. Tab labels `hidden sm:inline` para caber bien en mobile. **(2)** Capturar vuelve a Panel simple sin tabs — solo `SubirClient` adentro. **(3)** `components/CapturarBoletasTabs.tsx` eliminado (reemplazado por el nuevo RevisarBoletasTabs).

**PR #105** — fix(ui): glow parejo + calendar strip más flaco. **(1)** Glow uniforme: antes Revisar spotlight tenía `0.55` y otros `0.35` (disparejo). Ahora TODOS los panels comparten `box-shadow: 0 0 60px -12px rgba(232,85,62,0.45)` en light y `0 0 72px -10px rgba(232,85,62,0.50)` en dark. Hover-only fade 600ms se mantiene. Spotlight se distingue ahora solo por el icon-box solid `#E8553E`, no por el glow. **(2)** `CalendarStrip` ~35% más flaco: `rounded-[28px] → rounded-[24px]`, header `px-5 py-3 → px-4 py-2`, icon box `9x9 → 7x7` con icon 13px, label `15px → 13px`, subtitle `11px → 10px mt-0.5`, dots del summary `1.5px → 1px`. Body `px-4 py-3 → px-3 py-1.5`, gap entre cells `1 → 0.5`. Cells `w-10 py-2 → w-8 py-1`, weekday `9px → 7px`, day `13px → 11px`, dots `1x1 → 0.5x0.5`, `rounded-xl → rounded-lg`. Botón "Ver todas" → "Todas".

**PR #104** — feat(escritorio): calendar clickeable filtra Revisar por fecha. Click en un día del calendar strip → Revisar filtra a docs subidos ese día. Default al abrir: hoy. **(1)** `EscritorioPage` recibe `searchParams: Promise<{ date?: string }>` (Next.js 16 async). Lee `date`: `undefined → hoy YYYY-MM-DD`, `"all" → null (ver todas)`, `"YYYY-MM-DD" → ese día`. **(2)** `selectedDate` propagado a `CalendarStrip` (highlight celda activa) y `RevisarPanel` (filtro). **(3)** `CalendarStrip` cells ahora `<Link href={"/escritorio?date=YYYY-MM-DD"} prefetch={false} scroll={false}>`. Celda **seleccionada**: `bg-[#E8553E] text-white shadow glow`. Celda **hoy** (no seleccionada): `ring-1 ring-inset ring-[#E8553E]/50` + hover accent. Distingue claramente "seleccionado" vs "hoy". **(4)** Header del calendar strip: botón "Ver todas" (`X icon + Link ?date=all`) visible solo cuando hay filtro, para quitar explícitamente. **(5)** Panel Revisar hint dinámico: "Todas las fechas" | "Del 15 abr 2026" (helper `formatDateShort`). **(6)** `<Suspense key={selectedDate ?? "all"}>` para re-activar fallback al cambiar de fecha (evita flash de data stale). **(7)** Filter client-side sobre lista fetched: `propuestas.filter(p => p.movimientos_raw?.documentos_subidos?.created_at.startsWith(filterDate))`. Escala bien con volúmenes actuales (cientos); migrar a PostgREST si escala.

**PR #103** — feat(escritorio): Boletas como tab + Calendar strip + revert maxHeight. 4 cambios: **(1)** Revertido `maxHeight="60vh"` de PR #102. Revisar vuelve a altura natural; expandir un doc baja normal sin scroll interno. **(2)** Nuevo `components/CapturarBoletasTabs.tsx` (client). Card único con tabs internas (Capturar / Boletas). Header dinámico según tab activa (icon + label + hint cambian). Tab strip `flex-1` por tab, active `bg-#E8553E text-white`. Contenidos mantienen `display: none/block` para no perder state (files en cola de Capturar sobreviven al switchear). `SubirClient` como `children`, `BoletasPanel` como prop `boletasContent` (patrón RSC en client wrapper). **(3)** Nuevo `CalendarStrip` RSC async en `escritorio/page.tsx`. Fetchea `propuestas_ia` (pendiente + aprobado/editado) y `documentos_subidos` del mes actual, agrupa por día en Map, renderiza tira horizontal con `flex gap-1 min-w-max overflow-x-auto no-scrollbar`. Cada día: cell `w-10 py-2 px-1 rounded-xl` con weekday initial uppercase (D L M M J V S), día tabular-nums, y hasta 3 dots 1x1 debajo (naranja=pend, azul=subidos, verde=aprobadas). Hoy: `bg-#E8553E text-white shadow-[0_0_14px_-4px_rgba(232,85,62,0.5)]`. Fines de semana muted. Header del strip con `Calendar` icon + mes capitalizado + totales. `CalendarSkeleton` como Suspense fallback. **(4)** Layout final: `[col-3] CapturarBoletasTabs` + `[col-7] CalendarStrip → Revisar`.

**PR #102** — feat(escritorio): Revisar compacto + nuevo card Boletas emitidas. Dos cambios: **(1)** `Panel` ahora acepta prop `maxHeight?: string`. Aplicado al content wrapper como `style={maxHeight, overflowY: "auto"}`. Panel es `flex flex-col` con `shrink-0` en header y `flex-1 min-h-0` en content para que el scroll interno funcione correctamente. Revisar usa `maxHeight="60vh"` → ocupa hasta 60% del viewport, scrollea internamente al pasarse. Header reducido: `px-6 py-5 → px-5 py-3.5`, icon `10x10 → 9x9`, label `18px font-light → 16px font-medium`, hint mt-1 (antes mt-1.5). ~35% menos alto. **(2)** Nueva card `Boletas emitidas` debajo de Revisar. Right column pasa a `lg:col-span-7 flex flex-col gap-6` con dos `Panel` apilados. Icon `Receipt` (Phosphor), hint "Documentos tributarios enviados". `BoletasPanel` empty state inline: `Receipt 12x12 neo-inset` + texto "Aún no emitiste boletas" + subtext "Conectá tu cuenta SII para empezar (modo prueba disponible)" + botón "Emitir" disabled con `Plus` icon (title "Próximamente"). Placeholder hasta cablear mock SII intermediaria.

**PR #101** — fix(revisar): bloques mantienen numeración estable al aprobar. Problema: aprobar el bloque 2 hacía que los remanentes se renumeraran (3→2, 4→3, etc.). Confuso: "¿ya lo hice o no?". Fix: cada propuesta se asigna a un bloque al verla por primera vez y ese número se mantiene mientras exista. **(1)** `ConfianzaGroup` suma `blockMapRef: useRef<Map<string, number>>` persistente entre renders (propuesta.id → block number 1-indexed). No se resetea con `router.refresh()`. **(2)** `blocks` ahora `{ num: number; items: Propuesta[] }[]` (no array indexado). `useMemo`: escanea items nuevos (never-seen IDs), asigna al siguiente bloque disponible (`max + 1`) chunked por 10, agrupa items vigentes por block number, retorna ordenado por num asc. Bloques vacíos (todos aprobados) automáticamente desaparecen del array. **(3)** `activeBlockNum` state (antes `activeBlock` index). `useEffect` sync: si blocks cambia y el activo no existe, salta al primer disponible; si queda vacío, null. `activeBlock = blocks.find(b => b.num === activeBlockNum) ?? blocks[0]`. **(4)** Tab strip: `key={block.num}`, label `"Bloque {block.num}"` (no más `idx+1`). **(5)** Botón: `"Aprobar bloque {activeBlock.num} ({items.length})"` — confirma visualmente qué estás aprobando. Toast: `` `${count} aprobadas en bloque ${blockNum}` ``. **(6)** `sorted` ahora memoizado con `useMemo([propuestas])` porque el array es recreado cada render y la memo de blocks depende de él.

**PR #100** — feat(revisar): aprobar bloque con optimistic + animación de salida. Problema: `router.refresh()` inmediato tras aprobar bloque causaba full re-render / flash de reload. Solución optimistic + animación diferida. **(1)** Nueva animación `.animate-depart` en `globals.css`: `@keyframes depart` con fade + `translateX(32px)` + `max-height: 0` + padding/margin `0` en 450ms `cubic-bezier(0.4,0,0.2,1)`. **(2)** `ConfianzaGroup` suma state `departingIds: Set<string>` para track optimistic. **(3)** `handleAprobarGrupo` y `handleAprobarBloque` ahora: **a)** marcan ids como departing ANTES del request; **b)** ejecutan `aprobarTodas`; **c)** si error → rollback (quitan del set) + toast; **d)** si ok → toast, `setTimeout 500ms`, entonces llaman `onAction()` (que dispara el `router.refresh` del padre). Cuando llega el refresh, los items ya desaparecieron del DOM porque la animación terminó y el nuevo data del server no los incluye. Eliminado el `router.refresh()` directo que llamaban antes. **(4)** Container de `visible.map`: `space-y-3 → flex flex-col gap-3`. El `gap` no aplica a items con `max-height:0`, así el spacing se ajusta limpio sin márgenes residuales durante el colapso. **(5)** Render wraper: `<div className={departingIds.has(p.id) ? "animate-depart" : ""}>`. Resultado: los items se deslizan a la derecha + colapsan su altura + el resto fluye arriba suave. Sin flash de reload.

**PR #99** — feat(ui): docs como tabs + dropzone compacto + drop global (5 fixes enumerados). **(1)** Revertido expand-to-top de PR #98 (no gustó el jump). Sistema de tabs reemplaza esa lógica. **(2)** Docs como pestañas en Revisar. Refactor: `DocumentSection` dividido en `DocumentTab` (pill `rounded-full px-3 py-1.5` con `FileText 12px` + nombre truncate 160px + fecha + badge count; selected con `border-[#E8553E] bg-accent-light shadow glow`) + `DocumentBody` (contenido sin header, padding-top 2). `RevisarClient` lifta `selectedDocId` state; render: `<DocumentTabs>` horizontal con `overflow-x-auto no-scrollbar` arriba + `<DocumentBody>` del seleccionado abajo. Solo un doc visible a la vez — cambio de tab no mueve nada vertical. Fallback auto al primer doc si `selectedDocId` no coincide. **(3)** Panel `escritorio/page.tsx`: `<div className="escritorio-col pb-4">` para padding inferior. El minicard ya no toca el borde del card. **(4)** Dropzone compacto en `FileUpload.tsx`: de `py-14 px-6` vertical con icon 40px y text-base a fila horizontal `py-3 px-4` — icon box 10x10 accent-light + `UploadSimple 20px bold` + texto 13px "Arrastrá o tocá" / 10px subtext + file-type icons 14px derecha. Dragging: scale[1.01], shadow-glow naranja, texto a "Soltá para subir". **(5)** Drop global en toda la ventana: `useEffect` en FileUpload con listeners window-level `dragenter`/`dragleave`/`dragover`/`drop`. Contador `depth` para no flickear. Solo reacciona cuando `dataTransfer.types.includes("Files")`. Al soltar files en cualquier lugar de la ventana, se aceptan y se procesan; dropzone se resalta visualmente mientras hay drag activo globalmente.

**PR #98** — feat(ui): glow dinámico + doc rows compactos + expand-to-top. Tres fixes del escritorio según feedback: **(1)** Glow constante → dinámico. Removido `.breathe-glow` pulsante del spotlight. Nueva utility `.panel-hover-glow` con `transition: box-shadow 600ms cubic-bezier(0.22,1,0.36,1)`. Idle sin shadow, hover aplica halo naranja: `48px -14px rgba(232,85,62,0.35)` para paneles normales, `72px -12px rgba(232,85,62,0.55)` para `.is-spotlight`. Dark mode bump (+0.05 opacity). El glow solo se prende al pasar el mouse, fade-out suave al salir. **(2)** Document rows compactos en `RevisarClient`: padding `y-3.5 x-4 → y-2 x-3`, `FileText 20px → 14px`, filename `text-sm → text-[12px] leading-tight`, metadata `text-[10px] → text-[9px]`, badges `font-semibold` con `text-[9px]`, `rounded-[20px] → rounded-[14px]`. Removido `md:hover:-translate-y-0.5` y shadow hover (causaban roce de contenido). Border-bottom condicional: solo cuando `expanded=true`. **(3)** Expand-to-top: container cambió de `space-y-3` a `flex flex-col gap-2`. `DocumentSection` recibe `order-first` cuando `expanded=true`, `order-none` cuando collapsed. Transition-all 300ms. Click en doc collapsado → salta al top de la lista, otros quedan abajo en orden cronológico. Al cerrar vuelve a su posición.

**PR #97** — fix(ui): dark mode neutro frío + flat cards (principios OpenSea / artículo dark UI). Referencia del usuario: screenshot de OpenSea dark + artículo "9 principles of dark UI" de Dhananjay Mukerji. Cambios: **(1)** `--background: #18181B` (era warm brown `#1B1917`). Cool neutral Zinc-like. **(2)** `--neo-bg: #212125`, `--foreground: #EDEDED` neutro. **(3)** `--muted` / `--muted-light` en escala `rgba(255,255,255, opacity)` (era warm `rgba(235,230,220, opacity)`). **(4)** Principio #6 aplicado: **avoid shadows in dark mode**. `--neo-shadow: none` y `--neo-shadow-sm: none` en dark. `--neo-inset: inset 0 0 0 1px rgba(255,255,255,0.04)` solo hint. Override `.dark .neo` y `.dark .neo-sm` con `border: 1px solid var(--border)` — cards separan por diferencia de tono (`#212125` vs `#18181B`) + border limpio, no por elevación. **(5)** Principio #4 aplicado: saturación dimmed. Mesh gradients de `0.22 → 0.12` naranja, ámbar de `0.12 → 0.06`. Brand identity preservada (principio #5) — orange sigue en `accent`, spotlight icon solid, `breathe-glow`. **(6)** `--glass-bg: rgba(24,24,27,0.75)` más opaco para contraste sobre el bg más oscuro. Light mode sin cambios (neumorfismo cálido funciona bien ahí).

**PR #96** — feat(ui): hero inline en topbar + dark gris cálido. Feedback: el bubble flotante no convencía; preferencia por stats inline al lado de la razón social en el head. Y dark mode: casi-negro no deja destacar cards — mover a gris oscuro cálido. **Dark tokens** (`globals.css`): `--background: #1B1917` (antes `#0a0706`), `--neo-bg: #252320` nuevo explícito para cards, `--foreground: #F0EDE8` (warm), `--muted: rgba(235,230,220,0.55)` warm scale, `--glass-bg: rgba(15,13,11,0.65)` más oscuro para contrastar sobre bg más claro. **Light también suma** `--neo-bg: #F5F1E9` diferenciado. `.neo` / `.neo-sm` / `.neo-inset` usan `var(--neo-bg)` en vez de `var(--background)` → cards un paso más claras que el bg, dual-shadow neumorfismo crea profundidad real. **TopBar con stats inline** (`escritorio/page.tsx`): `TopBarShell` componente sync con frame (brand + fecha) sirve como `Suspense` fallback; `TopBar` async RSC fetcha los counts y renderiza los stats dentro. Layout `h-16`: `[●] Razón social | (divider) | 22px font-light tabular-nums número · 11px tracking-wide subtítulo con Lightning` + fecha a la derecha con `pr-[92px]` (para no chocar con gear+sun fixed del layout). `animate-number-in` cuando carga. `HeroBubble.tsx` borrado.

**PR #95** — feat(ui): hero como bubble draggable con fade idle. Feedback: el hero full-width de PR #93-#94 no era lo pedido. Ahora es una **bubble compacta (280x128)** en esquina top-right que el usuario puede arrastrar a cualquier lado. Cuando no está hovered/dragging, se difumina. **(1)** Nuevo `components/HeroBubble.tsx` (client): `position: fixed` con default `top-right (window.innerWidth - 280 - 24, 80)`. Drag via `onPointerDown/Move/Up` + `setPointerCapture(pointerId)`. `clampToViewport` en cada update (bubble nunca queda fuera). Posición persistida en `localStorage` key `"hero-bubble-pos"`. Resize listener re-clampa. **(2)** Estados: `active` (hover OR dragging OR intro 1.8s) → `filter: blur(0px) saturate(1)`, `opacity: 1`, `scale(1)`. `idle` → `filter: blur(6px) saturate(0.8)`, `opacity: 0.55`, `scale(0.96)`. Transición `450ms cubic-bezier(0.22,1,0.36,1)` entre estados; sin transition durante drag (1:1 response). `prefers-reduced-motion` fuerza active siempre. **(3)** Hero content compacto: `rounded-[22px] px-5 py-4` neo card, orb naranja 28x28, label 9px, número 44px inline, subtítulo 12px "esperando", footer 11px. `animate-number-in` en el content inicial. **(4)** Layout: hero fuera del `<main>` (overlay fixed), panels directos arriba del page con `pt-10 pb-16`. **(5)** `FloatingHero.tsx` borrado (reemplazado). Solo desktop — `hidden lg:block` — mobile sigue con `MobileHero` tradicional en `/subir`.

**PR #94** — feat(ui): hero flotante + zero friction motion. **UX analysis**: el `tilt-3d` de PR #93 en cards con contenido scrolleable (Revisar tiene 200+ filas) era roce real — al clickear un target, la card se movía bajo el cursor. Se saca todo motion que afecta target acquisition; solo queda motion display-only (hero) y ambient (box-shadow). **Cambios**: **(1)** Nuevo `components/FloatingHero.tsx` (client): pointer-follow parallax con lerp `0.06`, max `14x10px` desde centro, smoothed vía `requestAnimationFrame`, `prefers-reduced-motion` con early return. Solo para contenido no interactivo (display card). **(2)** Hero zone wrapeada en `<FloatingHero>` con `.neo rounded-[32px] px-10 py-10`. Orb radial naranja decorativo adentro (`radial-gradient closest-side rgba(232,85,62,0.18)`). Al mover el mouse la card drifteá suave, feels alive sin ser intrusiva. **(3)** `tilt-3d` removido del Panel wrapper. Paneles ahora estáticos con solo `.breathe-glow` en spotlight (box-shadow pulse cada 5s, **zero transform**, zero content shift). **(4)** Grid `lg:grid-cols-10` con Capturar `col-span-3` y Revisar `col-span-7` (antes `5/12` vs `7/12`). Revisar protagonista. **(5)** Panel header ligero: icon `10x10 rounded-xl` (antes `11x11 rounded-2xl`), label 18px font-light, hint 11px tracking-wide. Border-bottom sutil `black/5` / `white/5`. Padding `px-6 py-5`. Utility `.tilt-3d` queda en globals para display-only si se usa en otros lugares.

**PR #93** — feat(ui): hero storytelling + neumorphism 2.0 + 3D tilt. Rediseño estructural (no de color) para que la app se sienta premium, Apple-like, con jerarquía dramática y narrativa de datos. **Sistema CSS**: **(1)** Light mode tokens warm off-white: `--background: #EDE9E1` (antes `#F5F5F3`), `--foreground: #1A1612` (warm black), `--border: #E2DCD1`, `--muted: #6B6559` / `#9A9486`, `--surface: #E8E2D7`, glass warm. El warm off-white da volumen a las sombras del neumorfismo. **(2)** Neumorfismo 2.0: tokens `--neo-light` / `--neo-dark` / `--neo-shadow` / `--neo-shadow-sm` / `--neo-inset` por tema. Light usa sombra cálida `rgba(165,150,130,0.35)` + highlight `rgba(255,255,255,0.95)`. Dark usa sombra profunda `rgba(0,0,0,0.55)` + highlight sutil. Utilities `.neo`, `.neo-sm`, `.neo-inset`, `.neo-press`. **(3)** 3D tilt: `.tilt-3d` con `perspective(1200px) rotateX(2deg) rotateY(-2deg) translateY(-4px)` on hover, cubic-bezier spring 400ms, GPU-only. **(4)** Idle breathing: `.breathe` (scale 1 → 1.008 cada 6s), `.breathe-glow` (halo naranja pulsa cada 5s). **(5)** Hero typography: `.hero-number` `clamp(48px, 8vw, 96px)`, font-weight 200, letter-spacing -0.04em, tabular-nums. `.hero-number-dec` 0.55em opacity 0.45 para jugar con decimales. `.hero-label` 11px uppercase tracking 0.2em. Animación `number-in` 700ms spring. **(6)** `prefers-reduced-motion` disable breathing + tilt. **Desktop (`/escritorio`)**: nueva `HeroZone` arriba con razón social (hero-label) + número GIGANTE de propuestas pendientes + subtítulo "X aprobadas en {mes}" con `Lightning` verde y `TrendUp`. Panel wrapper usa `.neo .tilt-3d rounded-[28px]`; spotlight agrega `.breathe-glow`. Icon box del spotlight solid `#E8553E` con shadow glow naranja. Padding `px-7 py-5` (antes `px-5 py-3.5`), label `20px font-light tracking-tight` (antes `13px font-bold uppercase`). Copy narrativo: "Capturar" / "Revisar". TopBar razón social como texto muted (el hero abajo ancla). **Mobile**: nuevo `components/MobileHero.tsx` (RSC) con mismos stats, tipografía escalada `clamp(44px, 14vw, 72px)`, subtítulo 12px. `/subir/page.tsx` ahora renderiza `<MobileHero>` arriba en Suspense + `<SubirClient>` abajo.

**PR #92** — feat(ui): fondo premium gradient envolvente (estilo fintech). Feedback + referencia visual (mockup mobile dark morado): el fondo de PR #91 quedaba tímido. Ahora es un gradient atmosférico completo que envuelve toda la página. **(1)** `.mesh-bg::before` combina dos `radial-gradient` elipses con sizing `vw/vh`: top-right `ellipse 60vw 50vh at 75% -10%` (naranja fuerte), bottom-left `ellipse 50vw 40vh at 15% 110%` (ámbar). **(2)** `.mesh-bg::after` nueva capa: `ellipse 100vw 80vh at 50% 30%` para tinte ambient general. **(3)** Dark mode con intensidad premium: `--mesh-1: 0.22` (era `0.09`), `--mesh-2: 0.12` (era `0.05`), `--mesh-3: 0.08` coherente al brand. Background base `#0a0706` (leve warm shift desde `#0a0a0a`), `--glass-bg: rgba(20,18,17,0.55)` más warm. **(4)** Light mode bump suave `0.04→0.08` sin invadir. **(5)** Removido el tercer color indigo — todo paleta naranja/ámbar coherente. Zero animación, zero peso extra.

**PR #91** — fix(ui): fondo profesional (halos estáticos tipo Linear/Vercel). Feedback: el mesh drifteando de PR #90 quedaba juguete. **(1)** `.mesh-bg::before/after` ahora son `radial-gradient`s posicionados (esquina top-right + bottom-left), sin keyframes ni `will-change`. Zero animación, zero GPU cost de fondo. **(2)** Opacidades de `--mesh-1/2/3` bajadas ~40%: light `0.04-0.06` (era `0.06-0.10`), dark `0.05-0.09` (era `0.10-0.18`). Da warmth sutil sin competir con el contenido. **(3)** Eliminados `@keyframes mesh-drift-1/2/3` y `.mesh-blob-3` queda como `display:none` (back-compat). **(4)** `escritorio/page.tsx`: removida la referencia a `<div.mesh-blob-3>`. La profundidad ahora viene de las cards glass con glow, no del fondo.

**PR #90** — feat(ui): glass + glow + mesh bg moderno (100% CSS). Refresh visual sin agregar libs ni peso al bundle. **Tokens nuevos** en `globals.css`: `--glass-bg`, `--glass-border`, `--glow-accent`, `--glow-accent-soft`, `--mesh-1/2/3` — valores distintos light/dark (más saturados en dark para compensar). **Utilities**: `.glass` (`backdrop-blur(20px) saturate(180%)` + border), `.glass-strong` (blur 28, saturate 200), `.glow-accent` / `.glow-accent-soft` (box-shadows naranja), `.glow-on-hover` (lift + halo al hover con cubic-bezier spring), `.mesh-bg` (contenedor con 2 blobs fixed en `::before`/`::after`, filter blur 80px, `mesh-drift-1/2` keyframes con translate+scale 22-26s), `.mesh-blob-3` (tercera burbuja opcional 30s), `prefers-reduced-motion` respetado. **Aplicado a**: `/escritorio` root → `mesh-bg` + `<div className="mesh-blob-3">`; TopBar → `.glass` con dot de marca que ahora tiene `animate-ping` + `shadow-[0_0_10px_rgba(232,85,62,0.7)]` sutil pero vivo; `Panel` wrapper → `.glass` + `.glow-on-hover` (antes era `bg-white` solid con shadow estático), spotlight suma `.glow-accent-soft` permanente, el icon-box del spotlight con `shadow-[0_0_16px_-4px_rgba(232,85,62,0.5)]`. `/auth/login` y `/auth/registro` → wrapper `.mesh-bg min-h-screen`, card central `.glass + .glow-accent-soft` reemplaza el `bg-white/5 backdrop-blur-sm` manual. Zero bundle cost (solo CSS), GPU-composited.

**PR #89** — feat(mapper): motion + hover responsive. Feedback: el `FieldMapper` se sentía rígido con bloques estáticos. Ahora las interacciones cuentan la historia visualmente. **(1)** `globals.css` suma animaciones scopeadas: `mapper-stagger` + `mapper-stagger-1/2/3` (cascade entry 500ms con cubic-bezier spring, delays 60/140/220ms por bloque), `chip-pop` (spring 0.7 → 1.08 → 1 al cambiar rol, se dispara con `key={role}` en el button), `chip-detected-glow` (pulso ring verde 1600ms para chips que vinieron auto-detectados), `arrow-hint` (bounce vertical infinito del `ArrowDown` entre chip y encabezado **solo** cuando la columna tiene rol asignado), `mapper-data-row` (translateX 2px on hover). **(2)** Column tint sincronizado: `GridView` mantiene state `hoveredCol` y expone `columnTint(c)` que devuelve `backgroundColor` con el hex del rol + alpha `12` (idle) o `2a` (hover). Se aplica a TODAS las celdas de la columna `c` cruzando los bloques `BlockHeader` y `BlockData` → al hover, la columna entera se enciende en su color conectando chip ↔ datos. Reemplaza los dots por celda del PR #86 (ruidoso) por un tint full-column (más limpio). Nuevo `ROLE_HEX` map con los hex de cada rol. **(3)** Arrow entre chip y encabezado apagada (`text-muted-light/40`) cuando role=`"ignorar"`, activa + animada cuando tiene rol. **(4)** `FieldMapper` guarda `initialSuggestedRoles` en state para que los chips auto-detectados reciban el glow una sola vez al montar (comparando `role === initialSuggestedRoles[c]`). **(5)** Chip con `hover:scale-110 hover:-translate-y-0.5 active:scale-95` (antes solo `scale-105`).

**PR #88** — feat(mapper): términos contables chilenos + tooltips "en cristiano". Revisión profesional del `FieldMapper` usando la skill `contador-tributario-chileno`. **(1)** Terminología actualizada a cartola bancaria chilena estándar (Banco de Chile / Santander / BCI / Banco Estado): "Entrada"→"Abono" (ingreso), "Salida"→"Cargo" (egreso), "Descripción"→"Glosa", "N° documento"→"N° operación", "Tipo flujo"→"Tipo (D/C)". Layouts renombrados: "Cargo + Abono separados (cartola típica)", "Monto + Tipo (D/C)", "Una sola columna (todos cargos o todos abonos)". **(2)** Nuevo componente `Tooltip` (mismo patrón que `ColumnChip` menu): render vía `createPortal` a `document.body` con `position: fixed` calculada desde `getBoundingClientRect`; no se clipea por overflow. Fondo `#1c1c1e`, texto blanco, max-w 260px, animate-fade-in, z-[300]. Trigger en mouseEnter/leave + focus/blur. **(3)** Tooltips aplicados: cada `ColumnChip` muestra el `hint` del rol al hover (ej: "Cargo" → "Plata que SALIÓ de la cuenta: pagos, transferencias enviadas, giros"). Labels de los 3 bloques (Información de cabecera / Fila de títulos / Estos movimientos se van a agregar) con underline dotted + tooltip. Campos de ajustes avanzados (`Field` component) con ícono "?" al lado del label que al hover muestra explicación detallada. **(4)** Validaciones usan términos chilenos: "Asigná Cargo y/o Abono", "Falta asignar la Glosa", "Asigná la columna de Tipo (D/C)". **(5)** Opciones de `default_tipo_flujo` para `transactions_log` explícitas: "Abonos (ingresos)" / "Cargos (egresos)".

**PR #87** — fix(mapper): dropdown del chip via portal + bloque ignorado colapsable. Dos fixes al `FieldMapper` (PR #86): **(1)** El menú de `ColumnChip` se cortaba porque vivía `absolute` dentro de `<th>` dentro de `overflow-x-auto`. Ahora usa `createPortal` para renderse en `document.body` con `position: fixed`, calculando top/left desde `getBoundingClientRect()` del botón (via `useLayoutEffect`). Se cierra en `scroll`/`resize` para evitar desalineación. z-index `[200]` para estar por arriba del modal `[100]`. **(2)** `BlockIgnored` ahora colapsable con `defaultOpen=false`. Muestra solo un botón con caret + lock + label ("Información de cabecera — 11 filas NO se agregan") + "Mostrar" a la derecha. Click expande la tabla. Reduce ruido visual cuando el usuario solo quiere revisar el mapeo detectado.

**PR #86** — feat(upload): mapeo táctil con autodetect + bloques visuales. Rediseño del `FieldMapper` (PR #85) según feedback: menos técnico/dropdown, más táctil/chips, con autodetect y bloques visuales separados. **Backend** (`api/parser/preview`): corre `detectByNames` y `detectHeuristic` sobre el sheet completo y devuelve `suggested: AdapterConfig | null` + `suggestedSource: "named" | "heuristic" | null`. **Frontend**: **(1)** Al abrir el modal, si `suggested` existe, pre-asigna roles a cada col + fija `header_row`, `first_data_row`, `date_format`, `layout`. Usuario solo revisa y aprueba. **(2)** Banner superior: verde "Detectamos el formato — revisá y aprobá" o amarillo "No reconocimos el formato — asigná manualmente". **(3)** Tres bloques visuales apilados con colores: *"Información de cabecera — N filas NO se agregan"* (dashed border gris, opacity-60, click en cualquier fila la convierte en fila de títulos), *"Fila de títulos"* (border amarillo `FEF3C7`, cada col con `ColumnChip` clickeable arriba + flecha `ArrowDown` apuntando a la col), *"Estos movimientos se van a agregar"* (border verde `ECFDF5`, primeras 8 filas, cada celda con dot del color del rol, botones "↑ Incluir una fila más arriba" / "↓ Empezar una más abajo"). **(4)** `ColumnChip`: dropdown con color-coding por rol (fecha azul, descripción teal, entrada verde, salida naranja, monto amarillo, tipo flujo violeta, n°doc indigo, saldo gris). Roles disponibles filtrados según layout. **(5)** Ajustes avanzados (date_format, layout, hoja info) colapsados por default con `Gear` icon. **(6)** Footer en vivo: "Todo listo ✓" en verde o "Falta asignar X ⚠" en rojo; CTA principal "Todo bien, procesá" deshabilitada hasta que valide. **(7)** Lenguaje cotidiano: nada de "col 0", "skip_rows_before_data" ni "layout two_cols" — todo en español claro.

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
