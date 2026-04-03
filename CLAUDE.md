# App Contable

## Stack
- Next.js con TypeScript y Tailwind CSS
- Supabase para base de datos y autenticación
- n8n en Railway para automatizaciones
- GitHub con ramas main, dev, y feature/* para colaborar

## n8n
- URL: https://n8n-production-47ecb.up.railway.app
- MCP nativo conectado (n8n-mcp)
- MCP documentación conectado (n8n-mcp-docs)

## Reglas importantes
- Antes de modificar workflows en n8n, exportar respaldo a /n8n-workflows/respaldos/ con la fecha
- Cada feature nueva va en rama separada de Git
- No tocar la rama main directamente

## Supabase
- Conectado via MCP
- Variables en .env.local

## Contexto
- App contable para Chile
- Integración con SII pendiente
- Dos desarrolladores trabajando en el repo
