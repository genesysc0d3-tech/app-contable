---
kind: feature-checklist
status: active
created_at: 2026-06-20
feature: 006-dev-cuentas-unico
tags: [requirements, dev-operator]
---

# Checklist: Requisitos Panel Dev Unico

## Claridad

- [x] El problema esta descrito sin depender de chat.
- [x] Los usuarios afectados estan claros.
- [x] Los requisitos son observables y testeables.
- [x] Los no objetivos estan explicitados.

## Seguridad Y Producto

- [x] El backend valida acceso dev y modo soporte.
- [x] No se guardan secretos ni datos sensibles innecesarios.
- [x] La UX respeta que el panel dev solo existe para operadores.
- [x] El plan no toca legacy muerto salvo `/dev` como superficie dev legacy.

## Validacion

- [x] Hay comandos de verificacion definidos.
- [x] Hay criterio para cerrar o bloquear la feature.
