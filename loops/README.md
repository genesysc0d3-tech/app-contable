---
kind: loop-harness
status: active
created_at: 2026-06-20
tags: [loops, agents, operating-system]
---

# MassDTE Loop Harness

This folder defines how agents should compound work in this repo.

The loop harness is not automation by itself. It is the operating contract that
lets Codex, Claude or another agent read the same context, pick the next useful
task, verify it, and leave durable state for the next run.

## Core Rule

Agents do not rely only on chat history.

Before major work, read:

- `AGENTS.md`
- `docs/MEMORIA.md`
- `docs/DECISION_FINAL_PRODUCTO.txt` when touching product rules
- `.specify/memory/constitution.md` when opening or executing a feature spec
- latest entries in `loops/LOG.md`
- relevant loop contract in `loops/*/README.md`
- relevant artifacts in `artifacts/tasks` or `artifacts/signals`
- relevant feature spec in `specs/NNN-feature-name/` when the work is large

After major work, update:

- the task or signal artifact acted on
- the related `specs/NNN-feature-name/` files when scope, plan or tasks change
- `loops/LOG.md`
- `AGENTS.md` memory only when the result changes operating context

## Guardrails

- Never read `.env.setup` or `.env.github`.
- Avoid reading `.env.local`; use configured MCP/CLI wrappers when possible.
- Never commit, push, deploy, run destructive DB changes, or clear storage unless
  the user explicitly asks for that action.
- For Supabase remote changes, use `scripts/supabase-local-token.sh` or MCP
  without printing secrets.
- For Next.js code, read the relevant docs in `node_modules/next/dist/docs/`
  before writing code.
- Legacy `/escritorio` v1-v4 is dead. Work on `/massdte` / `escritorio/v5` and
  the active emission stack.

## Loop Types

- `product`: keeps product rules, pricing, gating and UX decisions coherent.
- `engineering`: turns tasks into code, tests and migrations.
- `dev-operator`: watches the Genesys dev dashboard, payments, migrations and
  account health without exposing client-private data.

## Artifact Stores

- `artifacts/signals`: recurring observations worth attention.
- `artifacts/tasks`: concrete work items ready for an agent.
- `artifacts/docs`: durable notes and decisions that are not product source of
  truth.
- `artifacts/runs`: optional per-run reports when a loop performs a larger
  investigation.

## Spec Kit

Use `.specify/` and `specs/` for large features that need a durable contract.
Loops decide what is worth doing; Spec Kit defines the feature before code is
changed. See `.specify/README.md` and `artifacts/docs/spec-kit-operating-model.md`.

## Standard Run

1. Read the loop contract and latest log entries.
2. Pick one task or signal that matches the loop.
3. If the work is large, open or update a feature spec before editing.
4. Check current repo state before editing.
5. Implement narrowly.
6. Verify with the validation listed in the artifact/spec.
7. Update the artifact/spec status or timeline.
8. Add one concise entry to `loops/LOG.md`.
