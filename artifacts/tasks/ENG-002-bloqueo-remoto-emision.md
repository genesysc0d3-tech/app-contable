---
kind: task
status: done
priority: high
owner_loop: engineering
created_at: 2026-06-20
tags: [business, emision-locks, sii-local, simpleapi, frontend, backend]
---

# Cerrar Bloqueo Remoto De Emision En La App

## Context

La extension ya navega SII. No se debe rehacer ese flujo.

El pendiente es la capa remota de app/backend/frontend: cuando una persona
inicia una emision real con extension, la cuenta pagadora queda con un lock
activo y otros usuarios no pueden iniciar otra emision real hasta que termine,
falle, se cancele o expire.

## Scope

- Revisar `POST /api/emision/jobs`, `GET /api/emision/jobs`,
  `PATCH /api/emision/jobs` y `DELETE /api/emision/jobs`.
- Confirmar que el backend bloquea otra emision real por `cuenta_id`.
- Confirmar que el frontend bloquea botones de emision real mientras hay lock.
- Confirmar que Business puede mostrar mensaje de equipo y Start/Pro solo
  mensaje generico.
- Confirmar que cambio de empresa durante emision no cambia `job.empresa_id`.
- No tocar la navegacion interna de la extension SII.

## Acceptance Criteria

- Usuario A inicia job real y crea lock por cuenta.
- Usuario B de la misma cuenta recibe `EMISION_BLOQUEADA`.
- Usuario de otra cuenta puede iniciar emision.
- Lock se libera al completar/fallar/cancelar/expirar.
- Frontend Business muestra estado de bloqueo de equipo.
- Frontend Start/Pro no muestra nombre de otra persona, equipo ni presencia.
- Resultado se guarda por `job_id` y `job.empresa_id`, aunque cambie
  `usuarios.empresa_id`.

## Validation

- `rtk tsc --noEmit`
- Test unitario o integracion ligera para visibilidad de lock.
- Revision de rutas `emision/jobs` y consumidores v5.
- Account 360 muestra jobs/locks/auditoria esperados.

## Timeline

- 2026-06-20 - Creada para no confundir extension funcional con multiusuario
  app/remoto.
- 2026-06-20 - Reescrita: el alcance ya no es probar la extension, sino cerrar
  bloqueo remoto backend/frontend de emision real.
- 2026-06-20 - Verificado por codigo: `emision_locks.cuenta_id` bloquea por
  cuenta, `POST /api/emision/jobs` devuelve `EMISION_BLOQUEADA`, el frontend v5
  consume `useEmissionLockStatus`, Business muestra mensaje de equipo y
  Start/Pro reciben mensaje generico. Se agrego test unitario de locks.
