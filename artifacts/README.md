---
kind: artifact-index
status: active
created_at: 2026-06-20
tags: [artifacts, loops]
---

# Artifact Store

Artifacts are durable records that agents can read, update and link across
sessions. They are the shared memory for loops.

## Types

- `signals`: recurring observations or strategic facts worth tracking.
- `tasks`: concrete work items with acceptance criteria and validation.
- `docs`: durable notes that support the work but are not product source of
  truth.
- `runs`: optional reports from larger loop executions.

## Rules

- Prefer updating an existing artifact over creating a duplicate.
- Every artifact should have frontmatter with `kind`, `status`, `created_at`
  and `tags`.
- Every task needs acceptance criteria and validation.
- Every artifact should keep a short `Timeline`.
- Do not store secrets, raw client data, XML, PDFs, images/base64 or private
  provider payloads.

## Status Values

- `open`: known and not started.
- `in_progress`: actively being worked.
- `blocked`: cannot move without user or external state.
- `done`: completed and verified.
- `wont_do`: intentionally closed.
