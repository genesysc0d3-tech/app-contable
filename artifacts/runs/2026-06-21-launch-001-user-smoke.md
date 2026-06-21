---
kind: run
status: done
created_at: 2026-06-21
tags: [launch, sii-extension, caf, smoke, emision, production]
---

# LAUNCH-001 Smoke Manual Extension SII CAF

## Resultado

El usuario reporto el 2026-06-21 que el flujo real con extension/SII/CAF emite
correctamente en una prueba controlada.

Este artifact no contiene secretos ni documentos tributarios crudos. No se
versionan claves SII, certificados, cookies, CAF XML, XML/PDF, screenshots con
datos completos ni credenciales.

## Criterios Cubiertos

- Extension instalada y usable en navegador real: reportado OK.
- Flujo real de emision autorizado: reportado OK.
- Resultado de emision real: reportado OK por el usuario.
- Extension/SII no fue tocada por el agente en esta fase.
- Evidencia sensible queda fuera del repo.

## Riesgo Residual

- La prueba fue manual e informada por el usuario, no reproducida por el agente.
- Falta convertir este smoke en checklist repetible con version de extension,
  proveedor usado, empresa controlada, tipo DTE, job_id enmascarado, estado del
  lock y verificacion de reserva/liberacion de folio sin exponer datos
  tributarios.
- Para lanzamiento abierto sigue faltando observabilidad, alertas, runbook de
  soporte y plan de incidentes alrededor de emision.

## Decision

`LAUNCH-001` deja de bloquear la beta controlada. La emision real puede probarse
con usuarios controlados, con soporte presente y sin prometer operacion masiva
abierta hasta cerrar observabilidad, cola durable y compliance operacional.
