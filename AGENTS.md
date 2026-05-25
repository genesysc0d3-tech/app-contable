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
| App (producción) | https://app-contable-five.vercel.app |
| GitHub repo | genesysc0d3-tech/app-contable (rama `dev`) |
| Supabase project | aluuuyecwifaakehvcam |

---

## Reglas

- **Nunca** trabajar directo en `main` ni `dev`. Crear rama `feature/` o `fix/` desde `dev`:
  - `git checkout dev && git pull && git checkout -b feature/mi-feature`
- Las env vars están en `.env.local`. No leer `.env.setup` ni `.env.github`.
- Migraciones SQL en `supabase/migrations/` (respetar orden por fecha).
- Tipado de base de datos en `src/lib/database.types.ts`.
- Script de limpieza de datos de test: `scripts/limpiar-test.sql`. Conserva `parser_adapters`, `parser_logs`, `clasificacion_reglas`, `boletas_caf_mock`, `clientes`, `usuarios`, `empresas`, `propuestas_ia`, `movimientos_raw`, `documentos_subidos`. Borra solo `audit_chunks`, `ia_uso`, `creditos_uso`, `periodos_contables`.

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
<!-- MEMORY:END -->

---

## Deploy

```bash
# La rama dev se deploya automáticamente en Vercel
git push origin dev
# O manual:
npx vercel --prod --yes
```

URL de producción: https://app-contable-five.vercel.app

<!-- END:project-context -->
