---
kind: run
status: blocked
created_at: 2026-07-05T20:29:40.854Z
tags: [audit, roles, dev-operator, playwright, massdte]
---

# MassDTE Role Matrix Audit

## Trigger

Auditoria enfocada en matriz Start/Pro/Business usando sesion Genesys y modo soporte read-only. No se probo extension SII ni se crearon jobs, locks, uploads o pagos.

## Run

- Base URL: http://localhost:3001
- Genesys state path: no disponible
- Non-dev state: no configurado
- Screenshots: /tmp/massdte-role-audit-2026-07-05T20-29-40-854Z
- Report: /Users/take/Desktop/app-contable/artifacts/runs/2026-07-05-massdte-role-matrix-audit.md

## Summary

- Dev panel status: not-run
- Plan scenarios: 0
- Checks: 0 (n/a)
- Console errors: 0
- Console warnings: 0
- Page errors: 0
- Failed requests: 0 (0 unexpected, 0 expected navigation aborts)
- HTTP 4xx/5xx: 0
- Findings: 1

## Findings

1. **BLOCKED - Sesion Genesys no disponible**
   No existe storage state en /tmp/e2e-state-vercel.json. Captura login con audit:app --capture-login o pasa --state.
   Evidence: /tmp/e2e-state-vercel.json

## Dev Panel

- No ejecutado.

## Plan Matrix

| Plan | Scenario | Support path | Banner | Uso | Equipo UI | business_mode | Lock | Screenshot |
|---|---|---|---|---|---|---|---|---|

## Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|

## Non-Dev Access

- No ejecutado.

## Browser Diagnostics

### Console
- Sin errores ni warnings de consola registrados.

### Page Errors
- Sin pageerror.

### Network
- Sin fallos de red ni HTTP 4xx/5xx registrados.

## Privacy And Scope

- No se guardan cookies, tokens, contrasenas ni valores de storage.
- Emails, UUIDs y parametros sensibles se redactan en diagnosticos.
- Entrar/salir de modo soporte puede dejar eventos de auditoria operativa en la cuenta; no modifica documentos, pagos, jobs, locks ni emision.
- Extension SII y SII real quedan fuera del alcance.

## Timeline

- 2026-07-05T20:29:40.854Z: corrida generada por scripts/audit-role-matrix.mjs.
