---
kind: global-log
status: active
created_at: 2026-06-20
tags: [loops, log]
---

# Global Loop Log

Read the latest 5-10 entries before major loop work. Add one concise entry after
major loop work. Link artifacts when possible.

## 2026-06-21 - Auditoria produccion soporte app-wide cerrada - #dev-operator #audit #support-mode

What: Extended `audit:app` to sweep Start/Pro/Business support mode across
`/massdte`, `/empresa`, `/revisar`, `/subir`, `/clientes` and
`/boletas/reportes`. The first production run found DEV-003: support banner and
effective company context were missing outside `/massdte`. Fixed app-wide
support context, merged PR #12, redeployed production and reran the audit with
0 findings. Write probes still return `DEV_SUPPORT_READ_ONLY`; non-dev remains
blocked from `/dev/cuentas`.

Refs: `artifacts/runs/2026-06-21-massdte-production-audit-summary.md`,
`artifacts/tasks/DEV-003-support-mode-app-wide-context.md`,
`scripts/audit-app-devtools.mjs`.

## 2026-06-21 - Matriz Start Pro Business cerrada - #dev-operator #audit #production

What: Added Pro/Business audit fixtures in Supabase, fixed support-mode account
API resolution and support logo access, merged PR #10, redeployed production,
and reran `npm run audit:roles` with Genesys plus a temporary non-dev state.
The final production report covers Business, Pro and Start with 0 findings:
Business shows Equipo and `business_mode=true`; Pro/Start hide Equipo and
return `business_mode=false`; non-dev does not see `/dev/cuentas`.

Refs: `artifacts/runs/2026-06-21-massdte-role-matrix-audit-2026-06-21T05-11-52-751Z.md`,
`artifacts/tasks/DEV-002-role-matrix-fixtures.md`,
`supabase/migrations/20260621010000_role_matrix_audit_fixtures.sql`.

## 2026-06-21 - Matriz de roles auditada parcialmente - #dev-operator #audit #plans

What: Added `scripts/audit-role-matrix.mjs` and `npm run audit:roles` to
exercise Genesys support mode by plan without touching SII, uploads, payments,
jobs or locks. Production audit validated the available Start account:
support banner visible, Uso del mes visible, Equipo hidden and
`business_mode=false`. Pro, Business and non-dev access checks remain skipped
until fixtures/sessions exist.

Refs: `artifacts/runs/2026-06-21-massdte-role-matrix-audit-2026-06-21T04-53-49-938Z.md`,
`artifacts/tasks/DEV-002-role-matrix-fixtures.md`,
`scripts/audit-role-matrix.mjs`.

## 2026-06-20 - Auditoria DevTools autenticada agregada - #dev-operator #audit #playwright

What: Added a local Chrome DevTools MCP config and a repeatable Playwright
audit harness for MassDTE/dev-operator. Ran an authenticated Genesys audit
against `localhost:3001`: `/dev/cuentas`, account detail, support mode
read-only, `/massdte`, `/empresa`, `/revisar`, `/subir`, `/clientes`,
`/boletas/reportes` and `/planes` all completed with 0 findings. The expected
read-only 403 probes were classified as support-mode validation; SII extension
and real SII flows were not touched.

Refs: `artifacts/docs/manual-devtools-audit.md`,
`artifacts/runs/2026-06-20-massdte-dev-audit-2026-06-21T02-36-15-885Z.md`,
`scripts/audit-app-devtools.mjs`.

## 2026-06-20 - Produccion base verificada para bloque 4-5 - #production #supabase #build

What: Continued the TXT implementation checklist through production checks.
Supabase remote migrations are aligned through `20260620113000`, `db push
--dry-run` reports the remote database is up to date, `db lint --linked` now
passes with no schema errors, and `npm run build` completes on Next 16.2.9.
Emission lock, metering and Telegram parser tests passed; `/dev/cuentas` smoke
returns login redirect instead of 404. Optional `inspect db locks` returned
only the inspection query itself; parallel optional inspect calls then hit the
pooler `ECIRCUITBREAKER`, so do not repeat Supabase remote inspect immediately.

Refs: `artifacts/tasks/DEV-001-retry-supabase-lint.md`,
`docs/DECISION_FINAL_PRODUCTO.txt`.

## 2026-06-20 - Dev detalle compactado como panel operativo - #dev-operator #ux

What: Reworked `/dev/cuentas/[cuentaId]` detail density after browser review.
The four tall metric cards became one compact operational summary strip, empty
payments/emission states now explain what to check, and audit history is capped
in the visible panel so repeated support-mode entries do not dominate the page.
TypeScript, emission lock tests, metering tests and diff check passed.

Refs: `src/app/(dev)/dev/cuentas/[cuentaId]/page.tsx`,
`specs/006-dev-cuentas-unico/spec.md`.

## 2026-06-20 - Dev cuentas mejora jerarquia visual - #dev-operator #ux

What: Polished `/dev/cuentas` UX with counted filter chips, a visible result
summary, severity rails per account row, clearer row status labels and a more
explicit "Ver cliente" action. The account detail header now shows operational
state chips and the priority panel includes a "Siguiente paso" line. TypeScript,
emission lock tests, metering tests and diff check passed.

Refs: `src/app/(dev)/dev/cuentas/page.tsx`,
`src/app/(dev)/dev/cuentas/[cuentaId]/page.tsx`,
`specs/006-dev-cuentas-unico/spec.md`.

## 2026-06-20 - Dev detalle prioriza problemas - #dev-operator #ux

What: Added a top priority panel to `/dev/cuentas/[cuentaId]` so Genesys sees
errors, warnings and the key checks first: plan, payment, quota and emission
lock. Detailed tables remain below. TypeScript, lock tests, metering tests,
route smoke and diff check passed.

Refs: `src/app/(dev)/dev/cuentas/[cuentaId]/page.tsx`,
`specs/006-dev-cuentas-unico/spec.md`.

## 2026-06-20 - Dev cuentas suma filtros operativos - #dev-operator #ux

What: Added server-rendered operating filters to `/dev/cuentas`: all accounts,
alerts, blocked, no payment and over quota, plus compact counters for the
current search result. This keeps the dev panel focused on account health
without exposing unmasked client identifiers.

Refs: `src/app/(dev)/dev/cuentas/page.tsx`,
`specs/006-dev-cuentas-unico/spec.md`.

## 2026-06-20 - Dev cuentas unico endurecido - #dev-operator #support #privacy

What: Executed the first implementation pass for spec 006. `/dev` now redirects
to `/dev/cuentas`, legacy dev actions return disabled, `/dev/cuentas` has
server-side search, support mode returns to `/dev/cuentas`, account audit logs
support entry/exit, and core write paths reject `DEV_SUPPORT_READ_ONLY`.
Protected paths include revisar, clientes, empresa/equipo, app company switch,
upload, payments, emission jobs and SimpleAPI. TypeScript, lock tests, metering
tests, route smoke and diff check passed. Manual browser verification with
Genesys remains.

Refs: `specs/006-dev-cuentas-unico/spec.md`,
`src/app/(dev)/dev/page.tsx`, `src/lib/dev/support-mode.ts`,
`src/app/(app)/revisar/actions.ts`, `src/app/api/emision/jobs/route.ts`.

## 2026-06-20 - Spec Kit local agregado - #loops #spec-kit #agents

What: Added a local Spec Kit layer for feature contracts: `.specify/`
constitution/templates, an operating-model doc, and `specs/006-dev-cuentas-unico`
to formalize `/dev/cuentas` as the future single dev operator surface before
runtime code changes.

Refs: `.specify/README.md`, `.specify/memory/constitution.md`,
`artifacts/docs/spec-kit-operating-model.md`,
`specs/006-dev-cuentas-unico/spec.md`.

## 2026-06-20 - Loop harness scaffolded - #loops #agents

What: Created the MassDTE loop harness structure with shared artifact rules,
domain contracts and initial tasks for engineering/dev-operator follow-up.

Refs: `loops/README.md`, `artifacts/README.md`,
`artifacts/tasks/ENG-001-transaccion-cupos-equipo.md`,
`artifacts/tasks/ENG-002-bloqueo-remoto-emision.md`,
`artifacts/tasks/DEV-001-retry-supabase-lint.md`.

## 2026-06-20 - Bloqueo remoto de emision verificado - #engineering #emision

What: Rewrote ENG-002 away from extension smoke testing and closed it around
the actual app requirement: backend/frontend lock by paying account. Added
unit coverage for `acquireCuentaEmissionLock` and `releaseCuentaEmissionLock`
covering same-account blocking, different-account allowance, expired locks and
release.

Refs: `artifacts/tasks/ENG-002-bloqueo-remoto-emision.md`,
`src/lib/emission/locks.test.ts`, `src/app/api/emision/jobs/route.ts`,
`src/app/(app)/escritorio/v5/useEmissionLockStatus.ts`.

## 2026-06-20 - Cupos de equipo y persona adicional cerrados - #engineering #billing #business

What: Closed ENG-001 with payer-owned team growth. Only the paying account
holder can invite or buy people. Pending invitations reserve seats, active
`persona_adicional` add-ons add one seat each, and a pending person purchase
blocks another checkout before Mercado Pago to avoid double charging. Supabase
remote was migrated through `20260620113000`; lint later hit temporary pooler
auth/ECIRCUITBREAKER after the corrective migration.

Refs: `artifacts/tasks/ENG-001-transaccion-cupos-equipo.md`,
`supabase/migrations/20260620110000_team_invite_owner_lock.sql`,
`supabase/migrations/20260620113000_fix_team_invite_rpc_ambiguous.sql`,
`src/app/(app)/empresa/actions.ts`, `src/lib/pagos/mercadopago.ts`,
`src/app/api/pagos/webhook/route.ts`.
