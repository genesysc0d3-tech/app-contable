# App Contable

App contable SaaS para Chile. IA procesa cartolas bancarias, clasifica movimientos y propone documentos tributarios.

## Stack
- Next.js 16 + React 19 + TypeScript + Tailwind v4
- Supabase (DB + Auth + Storage)
- Mistral AI + DeepSeek
- Deploy: Vercel

## URLs
- App: https://app-contable-five.vercel.app
- GitHub: genesysc0d3-tech/app-contable (rama dev)
- Supabase: aluuuyecwifaakehvcam

## Setup
1. `git clone` + `npm install`
2. Pedir `.env.local` al compa (keys de Supabase, Mistral, DeepSeek)
3. `npm run dev`

## Reglas
- No trabajar directo en main ni dev. Usar feature/* o fix/* desde dev
- Solo modificar archivos en /v5 o componentes compartidos
- Migraciones en supabase/migrations/
- Script limpieza: scripts/limpiar-test.sql

## Contexto actual
- Versión activa: v5 (src/app/(app)/escritorio/v5/)
- Popup empresa con wizard 5 pasos
- Dashboard con glow hover red accent
- Tema claro/oscuro via CSS variables

Ver AGENTS.md para memoria detallada del proyecto.
