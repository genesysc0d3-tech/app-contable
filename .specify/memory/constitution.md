---
kind: speckit-constitution
status: active
created_at: 2026-06-20
tags: [spec-kit, constitution, massdte]
---

# Constitucion MassDTE

Esta constitucion gobierna specs y tareas de agentes. No reemplaza
`docs/DECISION_FINAL_PRODUCTO.txt`; cuando haya conflicto, la decision final de
producto manda.

## Principios

### 1. Producto Simple

MassDTE habla para personas que quieren ahorrar tiempo, no para contadores ni
desarrolladores. En UX comercial se evita jerga como DTE, API, endpoints,
entitlements, cuota_masivas o multi-RUT. Se prefiere empresa, boletas desde
cartolas, boletas manuales, comprobantes por Telegram, equipo, historial y
reportes.

### 2. Backend Manda

La UI puede ocultar o explicar, pero el backend valida plan, pago, acceso,
cuotas, locks, empresa activa y permisos dev. Ningun spec puede depender solo de
controles visuales para seguridad o cobro.

### 3. Privacidad Por Defecto

Specs, artifacts, logs y paneles dev no almacenan ni muestran secretos, PDFs,
XML, imagenes/base64, certificados, claves SII, tokens, payloads privados o
datos sensibles innecesarios. El modo soporte debe ser trazable y de minima
exposicion.

### 4. Cuenta Pagadora Como Centro

La cuenta pagadora (`cuentas`) es la unidad de plan, pago, add-ons, equipo y
bloqueo de emision real. Cada empresa sigue siendo un dashboard aislado por
`empresa_id`.

### 5. Business Es La Experiencia De Equipo

El bloqueo tecnico de emision real es por cuenta pagadora, pero presencia,
panel Equipo, mensajes con nombres de personas y experiencia multiusuario
visible son solo Business.

### 6. Solo v5 Y Stack Activo

El producto activo es `/massdte` (`src/app/(app)/escritorio/v5`) y el stack de
emision. Legacy v1-v4 no se analiza, no se arregla y no se reporta salvo que el
usuario lo pida explicitamente.

### 7. Migraciones Y Tipos

Cambios de base de datos van en `supabase/migrations/` con orden temporal. Si
cambia el esquema usado por TypeScript, se actualiza `src/lib/database.types.ts`
o se documenta por que no aplica.

### 8. Loops Y Spec Kit Comparten Memoria

Loops detectan y registran trabajo. Spec Kit estructura features grandes.
Artifacts guardan evidencia y tareas. Ningun agente debe depender solo de la
conversacion compactada.

## Definition Of Done

Una feature grande queda lista cuando:

- `spec.md` explica problema, usuarios, requisitos, no objetivos y criterios de
  exito.
- `plan.md` explica arquitectura, datos, riesgos, migraciones y validacion.
- `tasks.md` esta dividido en pasos verificables.
- La implementacion pasa TypeScript/tests relevantes o documenta bloqueos.
- Se actualizan artifacts/logs/memoria si el resultado cambia contexto futuro.
