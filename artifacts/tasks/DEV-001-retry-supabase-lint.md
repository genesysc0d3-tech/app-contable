---
kind: task
status: closed
priority: medium
owner_loop: dev-operator
created_at: 2026-06-20
tags: [supabase, lint, pooler]
---

# Reintentar Supabase Lint Cuando Pase El Bloqueo Del Pooler

## Context

`db lint --linked` fallo por autenticacion temporal del pooler
`cli_login_postgres` / `ECIRCUITBREAKER` despues de aplicar migraciones. La
migracion quedo aplicada y listada en remoto; el fallo no fue SQL.

## Scope

- Esperar antes de reintentar para no extender el circuito de proteccion.
- Reintentar con `bash scripts/supabase-local-token.sh db lint --linked`.
- Si vuelve a fallar por auth/pooler, registrar en timeline y no insistir.

## Acceptance Criteria

- Lint remoto corre OK o queda documentado como bloqueado por infraestructura.
- No se imprime ningun token ni se lee `.env.local`.

## Validation

- `bash scripts/supabase-local-token.sh migration list`
- `bash scripts/supabase-local-token.sh db lint --linked`

## Timeline

- 2026-06-20 - Creada tras fallo temporal del pooler al validar auditoria.
- 2026-06-20 - Cerrada: `migration list` y `db push --dry-run` confirmaron
  remoto al dia; `db lint --linked` corrio OK sin errores de schema y sin leer
  ni imprimir secretos.
- 2026-06-20 - Nota posterior: `inspect db locks` fue OK, pero inspect
  opcional en paralelo (`long-running-queries`, `table-stats`) volvio a activar
  `ECIRCUITBREAKER`; no repetir inspect remoto inmediatamente.
