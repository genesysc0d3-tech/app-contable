---
kind: task
status: done
priority: high
owner_loop: engineering
created_at: 2026-06-21
tags: [architecture, scalability, queue, ocr, ai, documents, production]
---

# Cola Durable Para Documentos OCR IA

## Context

`/api/subir-procesar` ya valida payload y limita frecuencia, pero aun inicia
parseo/OCR/IA con un background volatil dentro del proceso web. Eso mejora UX,
pero no es durable: una funcion serverless puede terminar, reiniciarse o perder
trabajo despues de responder al usuario.

Para produccion madura, documentos, OCR e IA deben moverse a jobs persistentes
con reintentos, idempotencia y visibilidad operacional.

## Scope

- Crear tabla de jobs de procesamiento asociada a `documentos_subidos`.
- Registrar job antes de responder al usuario.
- Guardar solo metadata operativa, nunca contenido crudo del documento ni OCR
  completo en artifacts.
- Worker/cron procesa jobs `queued`/`retryable`.
- Estados minimos: `queued`, `running`, `completed`, `failed`, `cancelled`.
- Campos minimos:
  - `id`
  - `documento_id`
  - `empresa_id`
  - `usuario_id`
  - `tipo`
  - `storage_path`
  - `status`
  - `attempts`
  - `max_attempts`
  - `idempotency_key`
  - `last_error`
  - `locked_at`
  - `locked_by`
  - `created_at`
  - `updated_at`
  - `completed_at`
- Idempotencia por documento/tipo/version de pipeline para evitar doble cobro o
  doble propuesta.
- Backoff exponencial y deteccion de jobs atascados.
- Telemetria minima: cantidad queued/running/failed, duracion, proveedor OCR/IA,
  costo aproximado si existe y errores por causa.

## Acceptance Criteria

- Subir documento crea job durable antes de iniciar procesamiento.
- Si el worker cae, el job puede retomarse o marcarse `failed` con error seguro.
- Reintentar un mismo documento no duplica propuestas ni consumo.
- El estado visible en UI sale del job/documento persistido, no de memoria del
  proceso web.
- Hay limite de concurrencia por cuenta/empresa para proteger costos IA/OCR.
- Hay script o endpoint interno para reintentar jobs fallidos de forma
  auditada.
- Tests cubren idempotencia, reintento, job atascado y fallo de proveedor IA.

## Validation

- `npm run test`
- `npm run build`
- Prueba local con un Excel, un PDF y una imagen.
- Auditoria posterior confirma que no aparecen documentos crudos ni OCR completo
  en artifacts/logs.

## Timeline

- 2026-06-21 - Creada despues de agregar rate limits iniciales y cerrar
  LAUNCH-001 por smoke manual. Queda como siguiente bloque real de arquitectura
  escalable; no se implementa una cola incompleta sin worker.
- 2026-06-21 - Implementada cola durable base:
  `document_processing_jobs`, worker `processDocumentQueue`,
  `/api/document-processing/cron`, retry dev en
  `/api/document-processing/retry`, upload/reprocesar encolan jobs antes de
  responder y la UI sigue `documentos_subidos.estado/progreso_ia`.
  El kick oportunista solo acelera; la durabilidad depende de tabla + cron.
