---
kind: domain
domain: product
status: active
goal: Keep MassDTE product rules, plans, gating and UX aligned with the final decision document.
cadence: Manual or before product-facing changes
tags: [product, pricing, ux, gating]
---

# Product Loop

This loop owns product coherence.

## Sources Of Truth

- `docs/DECISION_FINAL_PRODUCTO.txt`
- `docs/MEMORIA.md`
- `specs/005-cuenta-pagadora-fase-1/`
- `AGENTS.md`

## Outputs

- Product signals in `artifacts/signals`
- Product tasks in `artifacts/tasks`
- Concise run notes in `loops/LOG.md`

## Workflow

1. Read the decision document directly.
2. Compare current behavior or request against non-negotiable rules.
3. Create or update a signal when a pattern is recurring or strategically
   important.
4. Create a task when the next action is concrete and verifiable.
5. Avoid changing product rules silently. Ask the user if a rule needs to be
   reinterpreted.
6. Update the timeline of the artifact acted on.

## Dedupe Rules

- Do not create a new signal for the same product rule.
- Increment frequency or update timeline on the existing signal instead.
- If a task is already open, add context to it rather than duplicating.

## Safety

- Start/Pro never show Business team UI.
- Business does not grant unlimited companies or people.
- Manual boletas are free and unlimited.
- Telegram never consumes boletas-from-cartolas quota.
- Backend gates plan, access, quota and emission locks.
