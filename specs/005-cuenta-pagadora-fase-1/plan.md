# Plan

## Pasos

1. Crear migracion SQL con cuenta pagadora y backfill.
2. Crear helper `src/lib/entitlements.ts`.
3. Adaptar `requireActiveEmpresa()` para usar membresia/cuenta activa.
4. Adaptar metering para contar boletas desde cartolas por cuenta.
5. Adaptar checkout/webhook/cron de pagos a `cuenta_id` con fallback por
   `empresa_id`.
6. Verificar TypeScript y pruebas relevantes.
7. Pedir revision a subagente sobre el diff.

## Validacion

- `rtk tsc --noEmit`.
- Tests existentes de pagos/telegram si aplican.
- Revision automatizada por subagente.
