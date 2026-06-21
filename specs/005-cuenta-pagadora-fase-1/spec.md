# Cuenta Pagadora Fase 1

## Objetivo

Introducir una cuenta pagadora central sin romper el aislamiento actual por
empresa activa. Esta fase deja la base para planes Start/Pro/Business,
multiempresa, equipo Business y bloqueo global de emision.

## Alcance

- Crear tablas `cuentas`, `cuenta_empresas`, `cuenta_usuarios` y
  `cuenta_addons`.
- Backfill compatible desde empresas y usuarios actuales.
- Mantener `usuarios.empresa_id` como dashboard activo.
- Adaptar acceso y cuotas para resolver el plan desde la cuenta pagadora.
- Mantener compatibilidad temporal con `empresas.plan`,
  `empresas.plan_activo`, `suscripciones.empresa_id`, `refills.empresa_id` y
  referencias antiguas de Mercado Pago.

## Fuera De Alcance

- Selector visual de empresa.
- Panel Equipo Business.
- `emision_jobs` y `emision_locks`.
- Telegram multiempresa.
- Realtime/presencia.

## Riesgos

- No cambiar RLS global a multiempresa en esta fase.
- No romper pagos existentes cuyo `external_reference` aun use `empresa_id`.
- No permitir que una empresa de otra cuenta se active como dashboard.
