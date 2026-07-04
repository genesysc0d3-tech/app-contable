---
kind: feature-tasks
status: in_progress
created_at: 2026-06-20
feature: 006-dev-cuentas-unico
tags: [dev-operator, soporte, cuentas, privacidad]
---

# Tasks: Panel Dev Unico En `/dev/cuentas`

## Fase 1 - Preparacion

- [x] T001 Leer `docs/MEMORIA.md`, `docs/DECISION_FINAL_PRODUCTO.txt`,
  `loops/dev-operator/README.md` y este spec.
- [x] T002 Leer docs Next.js relevantes en `node_modules/next/dist/docs/` antes
  de tocar route handlers, layouts o server actions.
- [x] T003 Auditar rutas actuales `/dev`, `/dev/cuentas`, helpers `src/lib/dev`
  y flujo de soporte.

## Fase 2 - Acceso Dev Unico

- [x] T004 Corregir autorizacion para que `genesysc0d3@gmail.com` sea operador
  dev reconocido server-side.
- [x] T005 Retirar o redirigir `/dev` para que no exponga controles legacy.
- [x] T006 Asegurar que usuarios no dev reciban bloqueo seguro.

## Fase 3 - Vista Cuenta Pagadora

- [x] T007 Mostrar mapa de cuenta: plan, estado, empresas, personas, add-ons,
  pagos, refills, cupos y locks.
- [x] T008 Mostrar diagnosticos de pago y liberacion de funciones sin datos
  privados crudos.
- [x] T009 Agregar busqueda util por cuenta, empresa, RUT o email con privacidad
  razonable.

## Fase 4 - Modo Cliente Read-Only

- [x] T010 Agregar entrada a modo cliente desde una cuenta.
- [x] T011 Agregar boton persistente para volver a modo dev.
- [x] T012 Bloquear escrituras server-side en modo soporte: emision, subida,
  cambios de empresa, invitaciones, pagos y acciones de revision.
- [x] T013 Mostrar banner persistente de modo soporte en la app cliente.

## Fase 5 - Auditoria

- [x] T014 Registrar entrada/salida de modo cliente.
- [x] T015 Registrar acciones sensibles intentadas o bloqueadas.

## Fase 6 - Validacion

- [x] T016 Ejecutar `rtk tsc --noEmit`.
- [x] T017 Ejecutar tests relevantes o agregarlos si falta cobertura.
- [ ] T018 Probar manualmente `genesysc0d3@gmail.com`.
- [ ] T019 Probar manualmente usuario no dev.
- [x] T020 Revisar `git diff --check`.

## Fase 7 - Memoria

- [x] T021 Actualizar artifact/log/memoria con lo implementado y pendientes.
