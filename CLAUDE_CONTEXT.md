# CLAUDE_CONTEXT.md

> Pega este archivo al inicio de cada conversación con Claude para que tenga contexto del proyecto.
> Actualízalo cada vez que cambien herramientas, convenciones o estructura.

---

## Proyecto

App contable para Chile. En etapa inicial — el "piso" está configurado pero **el diseño de la app se está definiendo junto con el equipo**. No asumir decisiones de producto que no estén documentadas aquí.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS |
| Base de datos + Auth | Supabase |
| Automatizaciones | n8n (desplegado en Railway) |
| Control de versiones | GitHub |
| Herramienta de desarrollo | Claude Code |

- **URL n8n en Railway:** `https://n8n-production-47ecb.up.railway.app`
- **Directorio local del proyecto:** `~/Desktop/app-contable`

---

## MCPs configurados en Claude Code

| MCP | Descripción |
|---|---|
| `n8n-mcp` | MCP nativo de n8n — conectado a la instancia en Railway vía HTTP |
| `n8n-mcp-docs` | n8n-mcp de czlonkowski — documentación y creación de workflows |
| `supabase` | Conectado al proyecto de Supabase del equipo |

---

## Ramas de Git

| Rama | Uso |
|---|---|
| `main` | Producción — solo merges aprobados |
| `dev` | Integración — base para nuevas features |
| `feature/setup-inicial` | Rama activa actual — configuración base |

**Convención:** Cada nueva funcionalidad va en su propia rama `feature/nombre-feature`, creada desde `dev`.

---

## Convenciones importantes

- **Antes de modificar cualquier workflow en n8n:** exportar respaldo a `/n8n-workflows/respaldos/` con la fecha en el nombre del archivo (ej: `respaldo-2025-01-15-workflow-nombre.json`).
- **Nunca trabajar directo en `main`.** Todo pasa por `dev` primero.
- **Decisiones de arquitectura de la app** se toman en equipo — no implementar módulos o estructuras de base de datos sin consenso previo.

---

## Estado actual

- [ ] Estructura base del proyecto creada
- [ ] Stack configurado (Next.js, Supabase, n8n en Railway)
- [ ] MCPs conectados en Claude Code
- [ ] Ramas de Git definidas
- [ ] **Diseño de la app: PENDIENTE** (se define con el equipo)
- [ ] Esquema de base de datos: PENDIENTE
- [ ] Módulos y pantallas: PENDIENTE

---

## Equipo

Dos desarrolladores colaborando. Las decisiones de producto y arquitectura se toman juntos antes de implementar.

---

*Última actualización: 2025 · rama `feature/setup-inicial`*
