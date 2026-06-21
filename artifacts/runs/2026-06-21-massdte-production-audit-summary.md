---
kind: run
status: done
created_at: 2026-06-21T05:46:03.770Z
tags: [audit, production, dev-operator, support-mode, playwright, massdte]
---

# MassDTE Production Audit Summary

## Trigger

Auditoria real contra produccion despues de completar fixtures Start/Pro/Business
y ampliar `audit:app` para cubrir rutas app en modo soporte. No se probo
extension SII ni se ejecutaron flujos reales contra SII.

## Runs

- Role matrix final: `artifacts/runs/2026-06-21-massdte-role-matrix-audit-2026-06-21T05-31-38-990Z.md`
- App audit con hallazgo: `artifacts/runs/2026-06-21-massdte-dev-audit-2026-06-21T05-34-02-541Z.md`
- App audit final post-deploy: `artifacts/runs/2026-06-21-massdte-dev-audit-2026-06-21T05-46-03-770Z.md`
- Deploy final: `dpl_BpXBLWhKSDrdvMTRnEEUsA14HGcR`
- Produccion: `https://app-contable-five.vercel.app`

## Result

- Estado final: OK, 0 hallazgos.
- Rutas visitadas: 28.
- Escenarios soporte por plan: 3.
- Checks de negocio: 56.
- Page errors: 0.
- Console warnings: 0.
- Failed requests inesperados: 0.
- HTTP 4xx/5xx no clasificados: 0.
- Los 16 `403` registrados son probes esperados de modo soporte read-only.

## Business Rules Checked

- Genesys accede a `/dev/cuentas` y detalle de cuenta.
- Usuario no-dev no ve `/dev/cuentas`; termina en `/auth/login`.
- Business en modo soporte muestra banner, Uso del mes, Equipo y
  `business_mode=true`.
- Pro y Start muestran banner y Uso del mes, ocultan Equipo y devuelven
  `business_mode=false`.
- `/massdte`, `/empresa`, `/revisar`, `/subir`, `/clientes` y
  `/boletas/reportes` mantienen banner de modo soporte en los tres planes.
- Upload, checkout, job de emision y emision directa quedan bloqueados con
  `DEV_SUPPORT_READ_ONLY`.
- Volver a dev retorna a `/dev/cuentas`.

## Finding Closed

`DEV-003` detecto que el banner de modo soporte desaparecia fuera de `/massdte`
y que rutas app usaban la empresa activa normal en vez de la empresa soportada.

Correccion aplicada:

- `getAppEmpresaContext()` centraliza la empresa efectiva para el grupo app.
- El layout `(app)` muestra el banner global de modo soporte.
- `/empresa`, `/revisar`, `/subir`, `/clientes` y `/boletas/reportes` usan la
  empresa soportada cuando existe cookie de soporte.
- `/api/sii-mock/rcv` respeta modo soporte para reportes.
- `audit:app` ahora recorre Start/Pro/Business con rutas read-only por plan.

## Remaining Scope

- Lock activo visual sigue `skipped` porque la auditoria no crea jobs ni locks.
- Extension SII, SII real, heartbeat real y CAF/folio real quedan para una fase
  separada con aprobacion explicita.

## Validation

- `npm run build`: OK local.
- Vercel production build: OK.
- `AUDIT_NONDEV_STATE=/tmp/e2e-state-nondev.json npm run audit:app -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json --expect-dev`: OK, 0 hallazgos.

## Timeline

- 2026-06-21 - Matriz Start/Pro/Business final: 0 hallazgos.
- 2026-06-21 - `audit:app` ampliado encontro DEV-003 en rutas soporte fuera de `/massdte`.
- 2026-06-21 - PR #12 mergeado, produccion redeployada y auditoria final cerrada con 0 hallazgos.
