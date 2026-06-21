---
kind: task
status: done
priority: high
owner_loop: dev-operator
created_at: 2026-06-21
tags: [audit, support-mode, dev-operator, privacy, app-context]
---

# Cerrar Modo Soporte En Rutas App

## Context

La auditoria productiva `audit:app` ampliada detecto que `/massdte` mostraba
banner de modo soporte y bloqueaba escrituras, pero al navegar a `/empresa`,
`/revisar`, `/subir`, `/clientes` y `/boletas/reportes` el banner desaparecia.

Los probes de escritura ya devolvian `DEV_SUPPORT_READ_ONLY`; el riesgo era
operativo: el operador podia perder la senal visual de que seguia viendo una
cuenta cliente y algunas lecturas seguian usando la empresa activa normal.

## Acceptance Criteria

- En modo soporte, todas las rutas del grupo app muestran `Modo soporte Genesys`.
- `/empresa`, `/revisar`, `/subir`, `/clientes` y `/boletas/reportes` leen la
  empresa soportada cuando existe cookie de soporte.
- Start y Pro siguen ocultando Equipo; Business lo sigue mostrando.
- Los probes de escritura siguen bloqueados con `DEV_SUPPORT_READ_ONLY`.
- La auditoria productiva ampliada termina sin hallazgos altos.

## Validation

- `npm run build`
- `AUDIT_NONDEV_STATE=/tmp/e2e-state-nondev.json npm run audit:app -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json --expect-dev`

## Timeline

- 2026-06-21 - Creada desde hallazgo de auditoria productiva: banner ausente en rutas app fuera de `/massdte`.
- 2026-06-21 - Cerrada: PR #12 fue mergeado, Vercel redeployo produccion
  (`dpl_BpXBLWhKSDrdvMTRnEEUsA14HGcR`) y la auditoria final
  `artifacts/runs/2026-06-21-massdte-dev-audit-2026-06-21T05-46-03-770Z.md`
  termino con 0 hallazgos.
