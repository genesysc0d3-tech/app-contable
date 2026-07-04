---
kind: speckit-config
status: active
created_at: 2026-06-20
tags: [spec-kit, agents, process]
---

# Spec Kit En Este Repo

Spec Kit es la disciplina de ejecucion por feature para MassDTE. No es codigo de
producto, no corre en produccion y no toca clientes.

Sirve para que Codex, Claude u otro agente trabajen con el mismo contrato antes
de cambiar codigo: primero se define que problema se resuelve, despues como se
planea, despues que tareas son verificables, y recien ahi se implementa.

## Relacion Con Loops

Los loops y Spec Kit no compiten.

- `loops/` decide que vale la pena mirar, conserva memoria y registra resultados.
- `artifacts/` guarda senales, tareas y notas durables.
- `specs/` define features grandes con `spec.md`, `plan.md` y `tasks.md`.
- `.specify/` guarda reglas, templates y constitucion del proceso.

El flujo recomendado es:

1. Un loop, artifact o usuario detecta trabajo importante.
2. Si el trabajo es grande o toca reglas de producto, se crea `specs/NNN-nombre/`.
3. El agente completa `spec.md` sin saltar a implementacion.
4. El agente completa `plan.md` con arquitectura, datos, riesgos y validacion.
5. El agente completa `tasks.md` en pasos verificables.
6. Otro agente, o el mismo en una sesion posterior, implementa desde esas tareas.
7. Al cerrar, se actualiza el artifact, `loops/LOG.md` y memoria si corresponde.

## Reglas Locales

- No usar Spec Kit para microfixes obvios de una linea.
- Si toca planes, cuenta pagadora, multiempresa, equipo Business, Telegram,
  extension SII, SimpleAPI, pagos, gating o realtime, leer primero
  `docs/MEMORIA.md` y `docs/DECISION_FINAL_PRODUCTO.txt`.
- Si toca Next.js, leer la guia relevante en `node_modules/next/dist/docs/`
  antes de escribir codigo.
- Specs deben describir producto y comportamiento observable. No deben esconder
  decisiones criticas en chat.
- Plans deben decir que archivos/capas se tocaran, riesgos, migraciones y
  validacion.
- Tasks deben poder verificarse de forma incremental.
- No guardar secretos, XML, PDFs, imagenes/base64, payloads privados ni datos
  sensibles de clientes en specs o artifacts.

## Estructura

```text
.specify/
  README.md
  init-options.json
  memory/constitution.md
  templates/

specs/
  006-dev-cuentas-unico/
    spec.md
    plan.md
    tasks.md
    checklists/requirements.md
```
