---
kind: doc
status: active
created_at: 2026-06-25
tags: [readiness, scorecard, security, senior]
---

# Readiness scorecard — MassDTE

Honesto, modo senior. **No autodeclaramos 10/10**: las últimas décimas necesitan
abogado + auditor externo, diferidos hasta revenue (decisión tomada y correcta).
Esto mide el **techo auto-servible** y qué falta para alcanzarlo.

## Estado por objetivo

| Objetivo | Hoy | Techo auto-servible | Qué falta para el techo |
|---|:---:|:---:|---|
| Recuperación / undo | 5 | 9 | Activar backup en la Mini (A1) |
| Radio de daño (agente no mata todo) | 6.5 | 8.5 | A3 least-priv · A5 base dev · A6 branch protection |
| Protección de secretos | 8 | 9 | Rotar si el historial tenía algo real |
| Aislamiento multi-tenant (RLS) | 7 | 9 | Correr test con 2 usuarios + `get_advisors` |
| Code safety (patrones) | 8.5 | 9 | Ratchet: warnings→bloqueo con el tiempo |
| Gates de CI obligatorios | 7.5 | 9 | A6 branch protection |
| Tests de invariantes | 6 | 8 | Doble-cobro + correr RLS |
| Runbooks / docs operativos | 9 | 9 | ✓ |
| Observabilidad / alertas | 6.5 | 8 | Setear `OPS_ALERT_WEBHOOK_URL` |
| Integridad de emisión | 8.5 | 9 | Reserva central de folios (mejora futura) |
| Compliance técnico (gratis) | 8 | 8.5 | Llenar checklist por flujo |
| Compliance legal externo | 2 | 2 | **Diferido**: abogado + auditoría (con revenue) |

**Composite para beta pagada controlada:** ~7.5 hoy → **~8.5** al cerrar tus
items → **10 real** solo cuando entre el legal externo.

## Para cerrar el techo auto-servible (solo tú puedes)

1. **Activar backup (A1)** — antes del primer cliente. `scripts/backup/README.md`.
2. **Branch protection (A6)** — 2 min. GitHub → Settings → Branches → regla para
   `dev` y `main`: requerir PR + check **CI** verde.
3. **Least-privilege + rotación de tokens (A3)** — acotar GitHub/Vercel; rotar lo
   que el historial haya expuesto.
4. **Base dev separada (A5)** — 2º proyecto Supabase o branching; el preview
   apunta ahí. Quita la fricción del guard de `cb4w` y aísla migraciones.
5. **`OPS_ALERT_WEBHOOK_URL`** — alerta inmediata de errores críticos.
6. **Correr el test RLS** — 2 usuarios de prueba + env; sumar `get_advisors`.

## Para el 10/10 real (diferido hasta revenue)

Abogado (DPAs firmados, oficial de privacidad, validar términos + procedimiento
de brecha) + auditoría externa de seguridad/legal. El trabajo gratis ya hecho
hace que ese abogado **valide y suba de nivel**, no parta de cero.

## Postura pública

Readiness, controles, evidencia, mejora continua. Nunca "10/10", "certificado"
ni "blindado".
