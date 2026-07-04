---
kind: run
status: done
created_at: 2026-06-23T05:48:49.126Z
tags: [audit, roles, dev-operator, playwright, massdte]
---

# MassDTE Role Matrix Audit

## Trigger

Auditoria enfocada en matriz Start/Pro/Business usando sesion Genesys y modo soporte read-only. No se probo extension SII ni se crearon jobs, locks, uploads o pagos.

## Run

- Base URL: https://app-contable-five.vercel.app
- Genesys state path: /tmp/e2e-state-vercel.json
- Non-dev state: /tmp/e2e-state-nondev.json
- Screenshots: /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z
- Report: <repo>/artifacts/runs/2026-06-23-massdte-role-matrix-audit.md

## Summary

- Dev panel status: ok
- Plan scenarios: 3
- Checks: 20 (pass:17, skipped:3)
- Console errors: 0
- Console warnings: 0
- Page errors: 0
- Failed requests: 50 (0 unexpected, 50 expected navigation aborts)
- HTTP 4xx/5xx: 0
- Findings: 0

## Findings

- Sin hallazgos en esta corrida.

## Dev Panel

- Status: ok
- Final path: /dev/cuentas
- HTTP: 200
- Client buttons: 3
- Screenshot: /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/01-dev-cuentas-role-matrix.png

## Plan Matrix

| Plan | Scenario | Support path | Banner | Uso | Equipo UI | business_mode | Lock | Screenshot |
|---|---|---|---|---|---|---|---|---|
| Business | checked | /massdte | yes | yes | yes | true | false | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/02-support-business-massdte.png |
| Pro | checked | /massdte | yes | yes | no | false | false | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/03-support-pro-massdte.png |
| Start | checked | /massdte | yes | yes | no | false | false | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-support-start-massdte.png |

## Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|
| genesys-dev-panel | pass | Genesys ve /dev/cuentas con 3 entrada(s) a modo cliente. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/01-dev-cuentas-role-matrix.png |
| plan-business-support-banner | pass | Business: banner Modo soporte Genesys visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/02-support-business-massdte.png |
| plan-business-usage | pass | Business: Uso del mes visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/02-support-business-massdte.png |
| plan-business-business-mode-api | pass | Business: /api/emision/jobs business_mode=true; esperado=true. |  |
| plan-business-team-panel | pass | Business: panel Equipo visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/02-support-business-massdte.png |
| plan-business-active-lock-ui | skipped | Business: no hay lock activo; no se creo uno para mantener la corrida sin mutaciones de emision. |  |
| plan-business-support-exit | pass | Business: Volver a dev retorna a /dev/cuentas. |  |
| plan-pro-support-banner | pass | Pro: banner Modo soporte Genesys visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/03-support-pro-massdte.png |
| plan-pro-usage | pass | Pro: Uso del mes visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/03-support-pro-massdte.png |
| plan-pro-business-mode-api | pass | Pro: /api/emision/jobs business_mode=false; esperado=false. |  |
| plan-pro-team-panel | pass | Pro: Equipo oculto como corresponde. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/03-support-pro-massdte.png |
| plan-pro-active-lock-ui | skipped | Pro: no hay lock activo; no se creo uno para mantener la corrida sin mutaciones de emision. |  |
| plan-pro-support-exit | pass | Pro: Volver a dev retorna a /dev/cuentas. |  |
| plan-start-support-banner | pass | Start: banner Modo soporte Genesys visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-support-start-massdte.png |
| plan-start-usage | pass | Start: Uso del mes visible. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-support-start-massdte.png |
| plan-start-business-mode-api | pass | Start: /api/emision/jobs business_mode=false; esperado=false. |  |
| plan-start-team-panel | pass | Start: Equipo oculto como corresponde. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-support-start-massdte.png |
| plan-start-active-lock-ui | skipped | Start: no hay lock activo; no se creo uno para mantener la corrida sin mutaciones de emision. |  |
| plan-start-support-exit | pass | Start: Volver a dev retorna a /dev/cuentas. |  |
| nondev-dev-panel | pass | Sesion no-dev no ve panel dev; termino en /auth/login. | /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-nondev-dev-cuentas-role-matrix.png |

## Non-Dev Access

- Status: pass
- Detail: n/a
- Final path: /auth/login
- Screenshot: /tmp/massdte-role-audit-2026-06-23T05-48-49-126Z/04-nondev-dev-cuentas-role-matrix.png

## Browser Diagnostics

### Console
- Sin errores ni warnings de consola registrados.

### Page Errors
- Sin pageerror.

### Network
- FAILED GET https://app-contable-five.vercel.app/massdte?_rsc=ddaTtC17XKcwO8A8 :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-19&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-09&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-07&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-29&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-23&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-23&month=2026-5&view=week&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-29&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/dev/cuentas?_rsc=sKlBWfOrLMZlW-Pb :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-11&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-20&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/dev/cuentas?_rsc=6qcu2BUlUud1WZox :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED POST https://app-contable-five.vercel.app/massdte :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED POST https://app-contable-five.vercel.app/dev/cuentas?q=pro :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?_rsc=x_XMCvaAkCCBV8bp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-29&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-30&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-15&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-12&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-13&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-09&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-06&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-03&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-02&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-18&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-13&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-06&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-03&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-02&month=2026-5&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?month=2026-6&date=2026-06-23&view=day&_rsc=JWHwEFtrOzdcadjx :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-28&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-26&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-22&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-14&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-10&month=2026-5&view=day&_rsc=4Ql9QT7sXOAyECnY :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-30&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-28&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)
- FAILED GET https://app-contable-five.vercel.app/massdte?date=2026-06-23&month=2026-5&view=day&_rsc=9Iitp0zaSIpuJhVp :: net::ERR_ABORTED (esperado: navegacion Next cancelada)

## Privacy And Scope

- No se guardan cookies, tokens, contrasenas ni valores de storage.
- Emails, UUIDs y parametros sensibles se redactan en diagnosticos.
- Entrar/salir de modo soporte puede dejar eventos de auditoria operativa en la cuenta; no modifica documentos, pagos, jobs, locks ni emision.
- Extension SII y SII real quedan fuera del alcance.

## Timeline

- 2026-06-23T05:48:49.126Z: corrida generada por scripts/audit-role-matrix.mjs.
