---
kind: doc
status: active
created_at: 2026-06-24
tags: [runbook, operations, emission, sii, simpleapi]
---

# Runbook: incidente de emisión (SII / SimpleAPI)

Para cuando una emisión queda atascada, falla, o un folio queda inconsistente.

## Síntomas

- Botón "Emitir" bloqueado y nadie está emitiendo (lock colgado).
- Job `running` viejo / sin heartbeat.
- Folio consumido pero sin boleta, o boleta sin folio.
- Cliente reporta boleta no emitida o duplicada.

## Pasos

1. **Identificar** job y lock por cuenta/empresa: `/dev/diagnostico`, o consulta
   de solo lectura a la base. En prod nunca escribir a mano.
2. **Cancelar el job**: `DELETE /api/emision/jobs` (libera el lock de la cuenta).
   Confirmar con `GET /api/emision/jobs` → `locked=false`.
3. **Lock huérfano**: si no hay job activo pero el lock sigue, esperar el
   vencimiento (`expires_at`) o liberarlo por el endpoint; no borrar filas a mano.
4. **Reconciliar folio**: revisar si el folio quedó consumido en el proveedor
   (SII/SimpleAPI). Si se reservó y no se emitió, marcarlo; no reutilizar a ciegas.
5. **Resultado tardío**: confirmar que se guardó por `job.empresa_id`, no por la
   empresa activa actual del usuario.
6. **Riesgo** → bloquear emisión de esa cuenta/empresa hasta resolver.
7. **Cliente**: avisar qué pasó y qué se hizo, en lenguaje simple.
8. **Cerrar**: evidencia sanitizada en `artifacts/runs/` (sin XML/PDF/folios
   reales crudos).

## Nunca

- Reusar un folio sin confirmar que no se emitió.
- Borrar filas de emisión/locks a mano en prod.
- Guardar XML/PDF/base64 reales en la evidencia.

## Referencias de código

- `src/app/api/emision/jobs/route.ts` (lock por cuenta, fail-closed)
- `src/lib/emission/locks.ts`
- `emission_authorizations` (autorización versionada antes de emitir)
