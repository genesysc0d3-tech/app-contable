<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-context -->
## app-contable

App contable SaaS para Chile. IA procesa cartolas bancarias, clasifica movimientos y propone documentos tributarios.

### Stack
- Next.js 16 + React 19 + TypeScript + Tailwind v4
- Supabase (DB + Auth + Storage)
- Mistral AI
- Deploy: Vercel

### Repos
- GitHub: `genesysc0d3-tech/app-contable` (rama `dev` = integración, `main` = solo initial commit)
- Vercel: `genesysc0d3-1037s-projects/app-contable` → https://app-contable-five.vercel.app
- Supabase: proyecto `aluuuyecwifaakehvcam`

### Reglas
- Nunca trabajar directo en `main` ni `dev`. Crear rama `feature/` o `fix/` desde `dev`.
- Las env vars están en `.env.local` (no leer `.env.setup` ni `.env.github`).
- Migrations en `supabase/migrations/` con dependencia de orden.
- Tipado de base de datos en `src/lib/database.types.ts`.
- Leer `SETUP_DEV.md` para instrucciones de setup.
<!-- END:project-context -->
