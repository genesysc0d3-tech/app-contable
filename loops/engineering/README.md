---
kind: domain
domain: engineering
status: active
goal: Turn approved tasks into small, verified code changes without losing product constraints.
cadence: Manual or after task creation
tags: [engineering, tests, migrations]
---

# Engineering Loop

This loop owns implementation.

## Sources Of Truth

- `AGENTS.md`
- relevant task in `artifacts/tasks`
- `docs/MEMORIA.md`
- `docs/DECISION_FINAL_PRODUCTO.txt` for account, plans, Business, Telegram,
  emission, gating or realtime
- relevant Next docs in `node_modules/next/dist/docs/` before Next code changes

## Outputs

- Code, tests and migrations
- Updated task timeline/status
- `loops/LOG.md` entry
- `AGENTS.md` memory only when operating context changes

## Workflow

1. Pick one open engineering task.
2. Read the task's acceptance criteria and validation.
3. Inspect current code before editing.
4. Keep edits scoped to active `/massdte` v5 or active emission stack.
5. Use `apply_patch` for manual edits.
6. Run the task validation.
7. Update the task timeline.
8. Log result in `loops/LOG.md`.

## Default Validation

- `rtk tsc --noEmit`
- targeted Vitest tests when applicable
- `bash scripts/supabase-local-token.sh db push --dry-run` for migrations
- `git diff --check`

## Safety

- Never read private env files.
- Never push/deploy/commit without explicit user request.
- Never change legacy `/escritorio` v1-v4.
- Do not weaken tax, plan or access validation to make tests pass.
