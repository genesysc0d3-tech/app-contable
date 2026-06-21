---
kind: task
status: done
priority: high
owner_loop: engineering
created_at: 2026-06-20
tags: [business, equipo, cupos, supabase]
---

# Endurecer Cupos De Equipo Y Pago De Personas

## Context

Business cobra personas adicionales como add-on. La validacion server-side ya
existe, pero puede tener carrera si dos invitaciones se crean al mismo tiempo
con un solo cupo disponible.

Decision de producto: solo la cuenta pagadora/titular puede comprar y agregar
personas. Una invitacion pendiente reserva cupo. Cada pago aprobado de
`persona_adicional` agrega exactamente un cupo mas. Nunca se abre un segundo
checkout de persona adicional si hay una compra pendiente.

## Scope

- Revisar `src/app/(app)/empresa/actions.ts`.
- Crear RPC, transaccion o advisory lock para validar y crear invitacion de
  equipo de forma atomica.
- Crear compra de persona adicional sin riesgo de doble cobro: intencion local
  pendiente, bloqueo de segunda compra pendiente y activacion por webhook.
- Mantener UI sin roles visibles.
- No cambiar Start/Pro: no muestran panel Equipo ni teaser.

## Acceptance Criteria

- Con un cupo disponible, dos invitaciones concurrentes no pueden dejar dos
  personas activas sobre cupo.
- Solo la cuenta pagadora/titular puede crear invitaciones y comprar personas.
- Si existe compra pendiente de persona adicional, el backend bloquea otro
  checkout antes de Mercado Pago.
- Pago aprobado de persona adicional activa exactamente la intencion local
  correspondiente.
- Backend sigue bloqueando equipo fuera de Business.
- Errores son humanos y no exponen detalles internos.
- No se relajan validaciones de plan/cuenta.

## Validation

- `rtk tsc --noEmit`
- Test o script de concurrencia con dos invitaciones simultaneas.
- `bash scripts/supabase-local-token.sh db push --dry-run` si hay migracion.

## Timeline

- 2026-06-20 - Creada desde el TXT como siguiente pendiente tecnico despues de
  auditoria y Account 360.
- 2026-06-20 - Cerrada. Se agrego RPC `crear_empresa_invitacion_titular` con
  advisory lock por cuenta, reserva de cupo por invitaciones pendientes y regla
  de titular/cuenta pagadora. Checkout de persona adicional crea una intencion
  `cuenta_addons` pendiente y bloquea segundos checkouts hasta que el webhook
  aprueba/cancela. Migracion aplicada en Supabase remoto.
- 2026-06-20 - `db lint` detecto referencia ambigua en la RPC; se aplico
  migracion correctiva `20260620113000_fix_team_invite_rpc_ambiguous.sql`.
