---
kind: task
status: done
priority: critical
owner_loop: engineering
created_at: 2026-06-21
tags: [launch, sii-extension, caf, smoke, emision, production]
---

# Smoke Real Extension SII CAF

## Context

La app web, soporte Genesys, matriz de planes y lock remoto ya quedaron
auditados en produccion. Falta validar el flujo real con extension/SII/CAF antes
de prometer emision tributaria end-to-end.

Esta tarea es deliberadamente separada porque puede tocar credenciales SII,
CAF/folios reales y resultado tributario real.

## Scope

- Usar una cuenta/empresa controlada, autorizada para pruebas reales.
- No guardar claves SII, certificados, cookies, CAF XML ni PDFs/XML crudos en
  artifacts.
- Validar extension instalada y version/capabilities esperadas.
- Crear job remoto antes de iniciar flujo local.
- Confirmar heartbeat/status visible desde extension.
- Confirmar que el lock bloquea otra emision mientras el job esta activo.
- Ejecutar un flujo real minimo autorizado con SII local o SimpleAPI local.
- Confirmar resultado asociado a `job_id` y guardado por `job.empresa_id`.
- Confirmar liberacion de lock al completar/fallar/cancelar.

## Acceptance Criteria

- Extension responde ping/capabilities en navegador real.
- `POST /api/emision/jobs` crea job y lock.
- UI muestra lock activo mientras la extension trabaja.
- `PATCH /api/emision/jobs` refleja heartbeat/status real de extension.
- Resultado de extension queda persistido por `job_id`.
- Si el usuario cambia empresa durante el flujo, el resultado sigue guardandose
  por `job.empresa_id`.
- Lock final queda liberado.
- Cualquier folio CAF reservado queda `usado`, `liberado` o `fallido` segun el
  resultado.
- El reporte final no contiene secretos ni documentos tributarios crudos.

## Validation

- `npm run build`
- `npm run audit:locks -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json`
- Smoke manual con navegador real + extension instalada.
- Revision de Account 360 para job, lock, reserva folio y auditoria.

## Timeline

- 2026-06-21 - Creada despues de cerrar auditoria web, roles y lock remoto sin SII.
- 2026-06-21 - Cerrada por smoke manual informado por el usuario: extension/SII/CAF
  emite en flujo real controlado. La evidencia versionada queda limitada a
  resumen no sensible en
  `artifacts/runs/2026-06-21-launch-001-user-smoke.md`; no se guardan claves,
  cookies, CAF XML, XML/PDF tributarios, screenshots con datos completos ni
  credenciales.
