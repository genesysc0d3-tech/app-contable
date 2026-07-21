---
kind: run
status: done
created_at: 2026-06-21T20:46:43.798Z
tags: [audit, emission-locks, playwright, massdte]
---

# MassDTE Emission Lock Audit

## Trigger

Auditoria controlada de lock remoto de emision. Puede crear un job temporal y lo cancela con DELETE. No se probo extension SII, portal SII, SimpleAPI upstream ni emision real.

## Run

- Base URL: https://app-contable-five.vercel.app
- State path: /tmp/e2e-state-vercel.json
- Provider requested: sii_local
- Tipo DTE: 39
- Screenshots: /tmp/massdte-lock-audit-2026-06-21T20-46-43-798Z
- Report: /Users/take/Desktop/app-contable/artifacts/runs/2026-06-21-massdte-emission-lock-audit-2026-06-21T20-46-43-798Z.md
- Base status: 307

## Summary

- Checks: 8 (pass:8)
- Created job: server:sii_local::uuid
- Cleanup: HTTP 200
- Console errors: 0
- Console warnings: 0
- Page errors: 0
- Failed requests: 18 (0 unexpected, 18 expected navigation aborts)
- HTTP 4xx/5xx: 0
- Findings: 0

## Findings

- Sin hallazgos en esta corrida.

## Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|
| lock-api-before | pass | GET inicial /api/emision/jobs devolvio HTTP 200. | /tmp/massdte-lock-audit-2026-06-21T20-46-43-798Z/01-massdte-before-lock.png |
| lock-create | pass | Job temporal creado: server:sii_local::uuid. |  |
| lock-api-after-create | pass | GET /api/emision/jobs muestra el lock temporal creado. |  |
| lock-heartbeat-patch | pass | PATCH actualizo estado visible a audit_probe. |  |
| lock-status-visible | pass | GET refleja estado_visible audit_probe. |  |
| lock-ui-visible | pass | La UI muestra texto de emision bloqueada/en curso con lock activo. | /tmp/massdte-lock-audit-2026-06-21T20-46-43-798Z/02-massdte-active-lock.png |
| lock-cleanup | pass | Job temporal cancelado con estado cancelled. |  |
| lock-api-after-cleanup | pass | GET final confirma que no queda lock activo. |  |

## Lock Snapshots

- Before: HTTP 200, ok=true, locked=false, business_mode=false, job=n/a, status=n/a
- After create: HTTP 200, ok=true, locked=true, business_mode=false, job=server:sii_local::uuid, status=running
- After patch: HTTP 200, ok=true, locked=true, business_mode=false, job=server:sii_local::uuid, status=audit_probe
- After cleanup: HTTP 200, ok=true, locked=false, business_mode=false, job=n/a, status=n/a
- UI path: /massdte
- UI blocked text: yes
- UI screenshot: /tmp/massdte-lock-audit-2026-06-21T20-46-43-798Z/02-massdte-active-lock.png

## Browser Diagnostics

### Console
- Sin errores ni warnings de consola registrados.

### Page Errors
- Sin pageerror.

### Network
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-27&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-25&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-19&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/api/emision/jobs :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-25&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-24&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-20&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-18&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-08&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-10&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-30&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-22&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-21&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-20&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-06&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-05&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-01&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)

## Privacy And Scope

- No se guardan cookies, tokens, contrasenas ni valores de storage.
- Job IDs se muestran truncados; no se copian payloads privados.
- Si la corrida crea un job temporal, lo cancela con `DELETE /api/emision/jobs`.
- Extension SII, SII real y SimpleAPI upstream quedan fuera del alcance.

## Timeline

- 2026-06-21T20:46:43.798Z: corrida generada por scripts/audit-emission-lock.mjs.
