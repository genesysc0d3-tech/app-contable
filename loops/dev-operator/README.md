---
kind: domain
domain: dev-operator
status: active
goal: Help Genesys inspect account health, payments, feature unlocks and operational risks while respecting client privacy.
cadence: Manual or before account-health investigations
tags: [dev-dashboard, accounts, payments, privacy]
---

# Dev Operator Loop

This loop owns the Genesys-only dev operator workflow.

## Operator

Only authenticated `genesysc0d3@gmail.com` can access dev operator surfaces.
`usuarios.vetado = true` still blocks access.

## Sources Of Truth

- `/dev`
- `/dev/cuentas`
- `/dev/cuentas/[cuentaId]`
- `src/lib/dev/`
- `src/app/(dev)/dev/`
- account artifacts in `artifacts/tasks` and `artifacts/signals`

## Outputs

- Account-health tasks in `artifacts/tasks`
- Operational signals in `artifacts/signals`
- Run notes in `loops/LOG.md`

## Workflow

1. Inspect account health through the dev dashboard or service helpers.
2. Confirm plan, payment, add-ons, companies, people, locks, jobs and audit
   events.
3. Never expose raw documents, XML, images, certificates, secrets or full client
   identifiers in artifacts.
4. Create a task for clear fixable problems.
5. Create a signal for recurring operational friction.
6. Log what was checked and what changed.

## Privacy Rules

- Emails and RUTs stay masked outside authenticated dev UI.
- Do not copy raw payment provider payloads into artifacts.
- Do not store SII credentials, certificates, CAF XML or image/base64 content.
