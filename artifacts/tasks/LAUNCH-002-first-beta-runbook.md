---
kind: task
status: open
priority: high
owner_loop: product
created_at: 2026-06-21
tags: [launch, beta, operations, support, billing, onboarding]
---

# Runbook Primera Beta Controlada

## Context

La auditoria productiva de la app web quedo verde. Antes de vender o invitar al
primer usuario beta conviene tener un runbook concreto para operar la primera
cuenta sin improvisar: que se prueba, quien responde, como se revierte y que se
considera exito.

## Scope

- Definir perfil de la primera cuenta beta.
- Definir mensaje comercial permitido: beta controlada, no promesa abierta de
  emision tributaria completa hasta cerrar LAUNCH-001.
- Definir flujo de onboarding: registro, empresa, proveedor de emision, cartola,
  propuestas, reportes y soporte.
- Definir soporte Genesys: cuando entrar a modo cliente, que mirar y que no
  tocar.
- Definir checklist de compra/pago si se cobra.
- Definir rollback: cancelar job, liberar lock, revertir proveedor, bloquear
  cuenta si hay riesgo, y contacto al cliente.
- Definir evidencia permitida en artifacts.

## Acceptance Criteria

- Existe runbook en `artifacts/docs/` con pasos concretos de beta.
- Incluye criterio go/no-go para invitar al primer usuario.
- Incluye checklist de privacidad.
- Incluye checklist de soporte si falla upload, IA, pago, lock o extension.
- Incluye criterio de cierre de beta: que debe pasar para decir "esto funciono".
- Incluye que metricas revisar despues de la sesion.

## Validation

- Revision contra `docs/MEMORIA.md` y `docs/DECISION_FINAL_PRODUCTO.txt`.
- Simulacion manual con Genesys usando `/dev/cuentas` y modo soporte.
- No requiere deploy si solo agrega docs/runbook.

## Timeline

- 2026-06-21 - Creada despues de consolidar auditoria productiva y backlog launch.
