---
kind: doc
status: active
created_at: 2026-06-24
tags: [quality, gates, ci, security]
---

# Quality gates de MassDTE

Qué corre, cuándo y qué bloquea. La meta: que la seguridad no dependa de la
memoria de nadie.

## Gates locales

| Comando | Qué hace | ¿Bloquea? |
|---|---|---|
| `npm run lint` | ESLint | sí |
| `npm run test` | vitest | sí |
| `npm run build` | Next build | sí |
| `npm audit --omit=dev --audit-level=high` | deps vulnerables | sí (high+) |
| `npm run audit:secrets` | secretos en archivos trackeados (nunca imprime el valor) | sí (críticos) |
| `npm run audit:safety` | patrones de riesgo MassDTE | sí (`service-role-in-client`); resto warn |
| `npm run check:prod-readiness` | corre todo lo anterior con resumen | sí |

## Gates con sesión segura

| Comando | Cuándo |
|---|---|
| `npm run audit:roles` | tocas roles/planes/Business |
| `npm run audit:locks` | tocas emisión |
| `npm run audit:app` | tocas soporte / app-wide |

## CI (GitHub Actions)

`.github/workflows/ci.yml` corre lint, test, audit:secrets, audit:safety, build
y npm audit en cada PR a `dev`/`main`. Lighthouse va en su propio workflow.

## El ratchet

v1: los críticos bloquean, lo difuso avisa. Cuando el baseline esté limpio, los
warnings repetidos se promueven a bloqueo. Warnings actuales a vigilar:
`destructive-script-without-prod-guard`, `possible-sensitive-log`,
`sensitive-data-in-web-storage`.

## Pendiente (necesita tu cuenta)

- **Branch protection**: exigir CI verde para mergear (GitHub → Settings →
  Branches → regla para `dev` y `main`).
- **`supabase get_advisors`** (security + performance) tras cada cambio de schema.
