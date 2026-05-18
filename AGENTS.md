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
- Script de limpieza de datos de test: `scripts/limpiar-test.sql`.

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

### Última sesión (2026-05-17)

**Qué se hizo:**
- Popup empresa rediseñado con wizard de 5 pasos (Emisor, Certificado, Formatos, CAF, IA)
- Componentes de empresa (EmisorForm, CertificadoToggle, etc.) convertidos a inline styles oscuros
- Dashboard cards con glow hover (box-shadow red accent)
- Tema claro/oscuro: fondos sólidos vía `var(--surface)` en vez de glass translúcido
- Colores morados reemplazados por naranja-rojo `#E8553E`
- Botón flotante empresa con icono Buildings (Phosphor)
- Eliminados controles flotantes no funcionales del layout
- AGENTS.md enriquecido con setup, reglas y memoria persistente

**Archivos modificados:**
- `src/app/(app)/empresa/EmisorForm.tsx`, `CertificadoToggle.tsx`, `CAFPanel.tsx`, `AiKeyConfig.tsx`, `EmpresaFormatoCartola.tsx`
- `src/app/(app)/escritorio/v5/EmpresaPopup.tsx`, `V5Root.tsx`, `GlowWrap.tsx`, `page.tsx`, `RevisarTabContent.tsx`
- `src/app/(app)/layout.tsx`

**Decisiones:**
- Glow usa `!important` para vencer inline box-shadow
- Popup empresa tiene `height: min(900px, ...)` fija con scroll interno
- Componentes compartidos se modificaron con inline styles (funcionan en /empresa y en popup)
- Tema claro: `var(--surface) = #ffffff`, Tema oscuro: `var(--surface) = #16181d`
- No usar `100dvh` ni `overflow: hidden` en wrapper del dashboard (rompía visibilidad)

**Próximos pasos:**
- Terminar de pulir visual del popup empresa
- Revisar modo claro en todas las secciones
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
