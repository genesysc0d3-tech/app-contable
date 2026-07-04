---
kind: feature-plan
status: in_progress
created_at: 2026-06-20
feature: 006-dev-cuentas-unico
tags: [dev-operator, soporte, cuentas, privacidad]
---

# Plan: Panel Dev Unico En `/dev/cuentas`

## Resumen

Consolidar el operador dev en `/dev/cuentas`, retirar la superficie legacy
`/dev`, y asegurar que el modo cliente sea read-only server-side. El panel debe
servir para diagnosticar pagos, add-ons, cupos y salud de cuentas sin exponer
datos privados innecesarios.

## Alcance

Archivos/capas probables:

- `src/app/(dev)/dev/cuentas/*`
- `src/lib/dev/*`
- `src/app/(app)/escritorio/v5/DevSupportBanner.tsx`
- server actions/API que hoy ejecutan escrituras en modo soporte
- `src/lib/audit/*`
- migraciones si falta auditoria o tabla de operadores dev

Fuera de alcance:

- extension SII;
- portal SII real;
- paneles de clientes;
- legacy `/escritorio` v1-v4.

## Arquitectura

La autorizacion dev debe resolverse server-side. El email `genesysc0d3@gmail.com`
es el operador dev inicial. El panel `/dev/cuentas` muestra resumen por cuenta
pagadora y permite entrar a una vista cliente en modo soporte read-only.

El modo soporte debe propagarse a la app como contexto de lectura y tambien debe
validarse en backend para impedir escrituras aunque la UI falle.

## Datos Y Migraciones

Tablas potenciales:

- `dev_operators` si se decide no usar lista fija.
- `audit_events` o extension de auditoria existente para entrada/salida soporte.

RLS/policies:

- No exponer panel dev por RLS cliente.
- Usar service role en rutas dev controladas cuando haga falta diagnosticar.

Backfill:

- No aplica salvo que se cree tabla de operadores.

## Seguridad Y Privacidad

- Gating backend por usuario dev autorizado.
- Modo soporte bloquea escrituras server-side.
- Auditoria para entrada/salida y acciones sensibles.
- No mostrar documentos crudos, XML, PDFs, imagenes/base64 ni secretos.
- No leer `.env.setup`, `.env.github` ni claves privadas.

## Riesgos

- Soporte read-only incompleto -> bloquear en helpers comunes y endpoints
  criticos, no solo botones.
- Panel dev demasiado poderoso -> acciones de reparacion en fase separada con
  confirmacion y auditoria.
- Confundir `/dev` y `/dev/cuentas` -> redirigir o retirar `/dev`.

## Validacion

- `rtk tsc --noEmit`
- tests de `src/lib/dev` si existen o se agregan;
- tests/server checks para modo soporte read-only;
- prueba manual con `genesysc0d3@gmail.com`;
- prueba manual con usuario no dev.

## Orden De Trabajo

1. Auditar estado actual de `/dev`, `/dev/cuentas`, `src/lib/dev` y modo soporte.
2. Hacer que `/dev/cuentas` sea la entrada dev unica.
3. Corregir autorizacion dev para `genesysc0d3@gmail.com`.
4. Agregar/ajustar boton entrar en modo cliente y volver a modo dev.
5. Bloquear escrituras server-side en modo soporte.
6. Mejorar mapa de cuenta pagadora: pagos, add-ons, cupos, empresas, personas.
7. Agregar auditoria minima.
8. Validar con cuenta dev y usuario no dev.
