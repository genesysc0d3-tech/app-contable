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
| `dev` | Integración — contiene PRs #1 al #25, toda la funcionalidad |

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
4. POST /api/procesar-documento → after() mantiene función viva
      ↓
5. Si imagen → Mistral OCR (mistral-ocr-latest) → texto estructurado
   Si grupo imágenes → OCR + agrupación inteligente por operación
      ↓
6. Mistral Small extrae movimientos (chunking 50, paralelo 3, retry 3)
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
- **Limite:** 60s Vercel Hobby — procesamiento IA cabe para ~600 tx
- **Para 1000+ tx:** migrar procesamiento a n8n webhook

---

## Pendiente

- [ ] Configurar Google OAuth en Supabase Dashboard + Google Cloud Console
- [ ] Mergear dev → main para deploy a producción
- [ ] Integración SII (emisión real de DTEs)
- [x] OCR para imágenes (Mistral OCR + agrupación inteligente)
- [ ] Integración de pagos real (actualmente se activa plan sin cobro)
- [ ] n8n webhooks: recordatorio F29, resumen semanal por email
- [ ] PWA: manifest.json, service worker, iconos
- [ ] Para cartolas 1000+ tx: migrar procesamiento a n8n webhook

---

## Equipo

Dos desarrolladores. El socio es contador — consultar con él decisiones de lógica tributaria.
Canal de colaboración: Slack workspace `app-contable` con `@Claude`.

---

*Última actualización: 4 Abril 2026 · rama `dev` · PRs #1-#25 mergeados*
