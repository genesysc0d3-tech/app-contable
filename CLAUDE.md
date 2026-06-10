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
- EL LEGACY NO IMPORTA: /escritorio v1-v4 y sus componentes son código muerto.
  No analizarlos, no fixearlos, no contar sus errores de lint. Pérdida de tiempo.
- Migraciones en supabase/migrations/
- Script limpieza: scripts/limpiar-test.sql

## Contexto actual
- PRODUCTO = /massdte (alias de src/app/(app)/escritorio/v5/) + stack de emisión:
  - src/lib/emission/ (providers: simpleapi, sii-local, mock)
  - src/app/api/simpleapi/ y src/app/api/sii-local/ (proxies)
  - extensions/sii-portal-rpa/ (extensión Chrome, vaults cifrados)
- Objetivo: llevar massdte a producción
- Popup empresa con wizard 5 pasos
- Dashboard con glow hover red accent
- Tema claro/oscuro via clase .dark + CSS variables (custom-variant en globals.css)

Ver AGENTS.md para memoria detallada del proyecto.
