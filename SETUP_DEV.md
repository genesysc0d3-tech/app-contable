# Setup para desarrollador — app-contable

## Stack
- Next.js 16 + React 19 + TypeScript + Tailwind v4
- Supabase (DB + Auth + Storage)
- Mistral AI (procesamiento documentos)
- Deploy: Vercel

## Repos
- GitHub: `genesysc0d3-tech/app-contable`
- Vercel: `genesysc0d3-1037s-projects/app-contable` → https://app-contable-five.vercel.app
- Supabase: pedir acceso web a `genesysc0d3-tech` (el proyecto existe, pedir URL + keys)

## Setup local

```bash
git clone https://github.com/genesysc0d3-tech/app-contable.git
cd app-contable
```

### 2. Env vars
Crear `.env.local` con:

```env
NEXT_PUBLIC_SUPABASE_URL=https://aluuuyecwifaakehvcam.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-public-key
SUPABASE_SERVICE_ROLE_KEY=service-role-key
AI_PROVIDER=mistral
MISTRAL_API_KEY=tu-mistral-key
MISTRAL_MODEL=mistral-small-latest
```

Las keys de Supabase se sacan de: https://supabase.com/dashboard/project/aluuuyecwifaakehvcam/settings/api

### 3. Instalar y correr

```bash
npm install
npm run dev
```

Abrir http://localhost:3000

### 4. Login
Usuario creado en Supabase Auth. Si no tenés credenciales, crear un user desde Supabase Dashboard > Authentication > Users > Add User.

## Convenciones

- Trabajar en ramas desde `dev`: `git checkout -b feature/nombre`
- PR a `dev`. `main` solo tiene el initial commit.
- Usar tipado de `src/lib/database.types.ts` para tablas de Supabase (generado vía `supabase gen types`).

## Supabase migrations

Las migrations están en `supabase/migrations/`. Para aplicar cambios locales:
```bash
supabase login
supabase link --project-ref aluuuyecwifaakehvcam
supabase db push
```

## Deploy

Cada push a `dev` deploya automático en Vercel (producción configurada desde `dev`).

## Scripts útiles

- `bash scripts/migrar-supabase.sh` — migrar a nuevo proyecto Supabase (necesita `.env.setup`)
- `bash scripts/migrar-github.sh` — migrar repo a otro GitHub (necesita `.env.github`)

## Notas

- Las migrations tienen dependencia de orden: `schema_base` → `boletas_sii_mock` → `propuesta_link` → `documento_tipo_hint` → `certificado_sii_flag`
- El antiguo proyecto Supabase (`nbvcngvwgbktjpxmuoto`) ya no existe.
- El antiguo repo GitHub (`holaavisoapp-del/app-contable`) ya no se usa.
