---
kind: run
status: blocked
created_at: 2026-07-05T20:29:41.246Z
tags: [audit, emission-locks, playwright, massdte]
---

# MassDTE Emission Lock Audit

## Trigger

Auditoria controlada de lock remoto de emision. Puede crear un job temporal y lo cancela con DELETE. No se probo extension SII, portal SII, SimpleAPI upstream ni emision real.

## Run

- Base URL: http://localhost:3001
- State path: /tmp/e2e-state-vercel.json
- Provider requested: sii_local
- Tipo DTE: 39
- Screenshots: /tmp/massdte-lock-audit-2026-07-05T20-29-41-246Z
- Report: /Users/take/Desktop/app-contable/artifacts/runs/2026-07-05-massdte-emission-lock-audit.md
- Base status: n/a

## Summary

- Checks: 0 (n/a)
- Created job: no
- Cleanup: n/a
- Console errors: 0
- Console warnings: 0
- Page errors: 0
- Failed requests: 0 (0 unexpected, 0 expected navigation aborts)
- HTTP 4xx/5xx: 0
- Findings: 1

## Findings

1. **BLOCKED - Sesion normal no disponible**
   No existe storage state en /tmp/e2e-state-vercel.json.
   Evidence: /tmp/e2e-state-vercel.json

## Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|

## Lock Snapshots

- Before: n/a
- After create: n/a
- After patch: n/a
- After cleanup: n/a

## Browser Diagnostics

### Console
- Sin errores ni warnings de consola registrados.

### Page Errors
- Sin pageerror.

### Network
- Sin fallos de red ni HTTP 4xx/5xx registrados.

## Privacy And Scope

- No se guardan cookies, tokens, contrasenas ni valores de storage.
- Job IDs se muestran truncados; no se copian payloads privados.
- Si la corrida crea un job temporal, lo cancela con `DELETE /api/emision/jobs`.
- Extension SII, SII real y SimpleAPI upstream quedan fuera del alcance.

## Timeline

- 2026-07-05T20:29:41.246Z: corrida generada por scripts/audit-emission-lock.mjs.
