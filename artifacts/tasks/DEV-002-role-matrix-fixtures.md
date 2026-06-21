---
kind: task
status: done
priority: high
owner_loop: dev-operator
created_at: 2026-06-21
tags: [audit, roles, plans, dev-operator, privacy]
---

# Completar Fixtures De Matriz Start Pro Business

## Context

La auditoria de matriz de roles en produccion quedo operativa con
`scripts/audit-role-matrix.mjs`. Inicialmente `/dev/cuentas` solo tenia una
cuenta Start disponible para modo cliente; se agregaron fixtures Pro/Business y
se corrigio el modo soporte para APIs compartidas.

Reporte base:
`artifacts/runs/2026-06-21-massdte-role-matrix-audit-2026-06-21T05-11-52-751Z.md`.

## Scope

- Crear o habilitar cuentas de prueba operativas para Pro y Business en el
  entorno que se quiera auditar.
- Asegurar que cada cuenta tenga empresa principal activa y boton "Ver cliente"
  disponible en `/dev/cuentas`.
- Capturar opcionalmente una sesion no-dev en `AUDIT_NONDEV_STATE` para validar
  que usuarios normales no acceden al panel dev.
- No guardar contrasenas, tokens, documentos, XML, imagenes ni payloads privados
  en artifacts.

## Acceptance Criteria

- `npm run audit:roles -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json`
  marca `checked` para Start, Pro y Business.
- Business muestra `Equipo` y `/api/emision/jobs` responde
  `business_mode=true`.
- Start y Pro ocultan `Equipo` y responden `business_mode=false`.
- Si se entrega `AUDIT_NONDEV_STATE`, la sesion no-dev no ve `/dev/cuentas`.
- Sin `pageerror`, sin `console.error` inesperado y sin request failures no
  clasificados.

## Validation

- `node --check scripts/audit-role-matrix.mjs`
- `npm run audit:roles -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json`
- Revisar el reporte en `artifacts/runs/`.

## Timeline

- 2026-06-21 - Creada tras auditoria productiva: Start validado OK; Pro,
  Business y non-dev quedaron saltados por falta de fixtures/sesion.
- 2026-06-21 - Cerrada: se agregaron fixtures Pro/Business, se redeployo
  produccion y la matriz completa cerro con 0 hallazgos. Business mostro
  Equipo y `business_mode=true`; Pro/Start ocultaron Equipo y respondieron
  `business_mode=false`; la sesion no-dev termino en login sin ver panel dev.
