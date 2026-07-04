---
kind: artifact-type
type: task
status: active
created_at: 2026-06-20
tags: [tasks]
---

# Tasks

A task is a concrete unit of work that an agent can execute and verify.

Tasks should be narrower than specs. A task is ready when the next action,
acceptance criteria and validation are clear.

## Template

```md
---
kind: task
status: open
priority: high
owner_loop: engineering
created_at: YYYY-MM-DD
tags: []
---

# Title

## Context

## Scope

## Acceptance Criteria

## Validation

## Timeline
```
