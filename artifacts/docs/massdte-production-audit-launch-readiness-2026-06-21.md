---
kind: doc
status: active
created_at: 2026-06-21
tags: [audit, launch, production, backlog, massdte, sii-extension]
---

# MassDTE Production Audit & Launch Readiness

## Resumen Ejecutivo

La app web de MassDTE en produccion quedo en estado verde para la capa SaaS:
dev operator, soporte Genesys, matriz Start/Pro/Business, modo cliente
read-only, bloqueo de usuario no-dev y lock remoto de emision fueron auditados
contra `https://app-contable-five.vercel.app`.

No se detectaron hallazgos abiertos en la ultima corrida productiva. El unico
hallazgo real encontrado durante la auditoria fue DEV-003: el banner/contexto
de soporte desaparecia fuera de `/massdte`. Se corrigio, se mergeo, se
redeployo y se verifico con auditoria final en produccion.

La frontera clara es esta: la app web esta razonablemente lista para beta
controlada y LAUNCH-001 ya fue reportado OK en smoke manual con
extension/SII/CAF. Observabilidad base, cola durable OCR/IA/documentos y
compliance beta 8/10 ya quedaron versionados. Aun no conviene prometer
operacion masiva abierta sin validar la primera beta real, alertas externas,
Lighthouse autenticado y revision legal externa.

## Evidencia Principal

- Auditoria app-wide final:
  `artifacts/runs/2026-06-21-massdte-dev-audit-2026-06-21T05-46-03-770Z.md`
- Resumen produccion:
  `artifacts/runs/2026-06-21-massdte-production-audit-summary.md`
- Matriz Start/Pro/Business:
  `artifacts/runs/2026-06-21-massdte-role-matrix-audit-2026-06-21T05-31-38-990Z.md`
- Lock remoto de emision:
  `artifacts/runs/2026-06-21-massdte-emission-lock-audit.md`
- DEV-003 cerrado:
  `artifacts/tasks/DEV-003-support-mode-app-wide-context.md`
- ENG-002 reforzado con auditoria productiva:
  `artifacts/tasks/ENG-002-bloqueo-remoto-emision.md`

## Que Quedo Verde

### Dev Operator

- Genesys accede a `/dev/cuentas`.
- `/dev` redirige al panel operativo nuevo.
- Detalle de cuenta carga y muestra prioridad operativa.
- Modo soporte entra desde `Ver cliente`.
- `Volver a dev` retorna a `/dev/cuentas`.
- Usuario no-dev no accede a `/dev/cuentas`; termina en `/auth/login`.

### Modo Soporte Read-Only

- Banner `Modo soporte Genesys` visible en rutas app auditadas.
- Rutas auditadas con banner en Start/Pro/Business:
  `/massdte`, `/empresa`, `/revisar`, `/subir`, `/clientes`,
  `/boletas/reportes`.
- Rutas app leen la empresa soportada mediante `getAppEmpresaContext`.
- `/api/sii-mock/rcv` respeta empresa soportada.
- Escrituras principales bloqueadas con `DEV_SUPPORT_READ_ONLY`:
  upload, checkout, job de emision y emision directa.

### Planes Y Roles

- Business muestra Equipo y `business_mode=true`.
- Pro y Start ocultan Equipo y devuelven `business_mode=false`.
- `Uso del mes` visible en los tres planes.
- Non-dev no ve panel dev.
- Fixtures Pro/Business no contienen documentos, XML, pagos ni credenciales.

### Lock Remoto De Emision

- `POST /api/emision/jobs` crea job temporal y lock remoto.
- `GET /api/emision/jobs` reporta `locked=true`.
- `PATCH /api/emision/jobs` actualiza heartbeat/`estado_visible`.
- UI `/massdte` muestra emision bloqueada/en curso con lock activo.
- `DELETE /api/emision/jobs` cancela el job.
- `GET` final confirma `locked=false`.
- La prueba no ejecuto extension, SII, SimpleAPI upstream ni emision real.

## Hallazgo Cerrado Durante La Auditoria

### DEV-003 - Modo soporte no era app-wide

Problema:

- `/massdte` mostraba banner y usaba empresa soportada.
- `/empresa`, `/revisar`, `/subir`, `/clientes` y `/boletas/reportes` perdian
  el banner y parte del contexto visual/operativo de soporte.

Correccion:

- `getAppEmpresaContext()` centraliza empresa efectiva.
- Layout `(app)` renderiza banner global de soporte.
- Rutas auditadas usan empresa soportada.
- RCV mock respeta soporte.
- `audit:app` recorre Start/Pro/Business por rutas app.

Estado: cerrado y redeployado.

## Riesgos Restantes

### P0 Antes De Prometer Emision Real

- Smoke real con extension/SII/CAF no ejecutado.
- Heartbeat/status real desde extension no validado contra produccion.
- SimpleAPI local con CAF real no validado end-to-end.
- Resultado tributario real no validado con `job_id` y `job.empresa_id`.

### P1 Antes De Beta Pagada

- Runbook de primera cuenta beta ya existe; falta validarlo despues del deploy.
- Falta checklist de rollback/soporte para fallos de emision real.
- Falta definir criterio de exito para primera emision real aceptada/rechazada.
- Falta una pasada manual mobile/desktop final de onboarding y compra.
- Compliance beta 8/10 versionado: RAT, DPA/subencargados, retencion, brechas,
  MPD inicial y paginas publicas legales. Falta revision legal externa para
  lanzamiento abierto.

### P2 Post Beta

- Lighthouse no se ejecuto como parte de la corrida final productiva. Queda
  cubierto en CI para rutas publicas sin sesion mediante
  `.github/workflows/lighthouse.yml`; falta extenderlo a rutas autenticadas con
  estado Playwright controlado.
- Reportes intermedios viejos sin trackear siguen en workspace local.
- Falta configurar `OPS_ALERT_WEBHOOK_URL` y, si se requiere menor latencia,
  scheduler externo o Vercel Pro para correr crons con frecuencia subdiaria.

## Backlog Priorizado

| Prioridad | Item | Estado | Artifact |
|---|---|---|---|
| P0 | Smoke real extension/SII/CAF | done manual | `artifacts/tasks/LAUNCH-001-extension-sii-caf-smoke.md` |
| P0 | Cola durable OCR/IA/documentos | done beta | `artifacts/tasks/ENG-003-cola-durable-documentos-ia.md` |
| P1 | Runbook beta primer cliente | in_progress | `artifacts/tasks/LAUNCH-002-first-beta-runbook.md` |
| P1 | Compliance Chile beta 8/10 | done_beta | `artifacts/tasks/COMPLIANCE-001-ley-21719-21595-readiness.md` |
| P1 | Checklist final compra/onboarding/mobile | pendiente | crear despues de runbook beta |
| P2 | Lighthouse performance/accessibility | in_progress | CI agregado para `/auth/login`, `/auth/registro` y `/bloqueado`; falta modo autenticado |
| P2 | Limpieza de reportes intermedios locales | pendiente | no borrar sin decision explicita |

## Decision Recomendada

La web puede pasar a beta controlada si el mensaje comercial evita prometer
emision masiva abierta y se opera con soporte cercano. LAUNCH-001, observabilidad
base, cola durable y compliance beta ya estan cubiertos a nivel tecnico.

No conviene lanzar abierto ni cobrar con promesa de emision tributaria final
hasta completar:

1. Alertas externas para emision real, upload, IA, pagos y locks.
2. Runbook de soporte/rollback validado con la primera cuenta beta.
3. Checklist de compra/onboarding en produccion.
4. Revision legal externa de privacidad, terminos, DPA, retencion y MPD.

## Comandos De Referencia

```bash
npm run audit:roles -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json
AUDIT_NONDEV_STATE=/tmp/e2e-state-nondev.json npm run audit:app -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json --expect-dev
npm run audit:locks -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json
```

## Timeline

- 2026-06-21 - Matriz Start/Pro/Business cerrada con 0 hallazgos.
- 2026-06-21 - DEV-003 detectado, corregido, redeployado y verificado.
- 2026-06-21 - Lock remoto auditado en produccion sin extension/SII.
- 2026-06-21 - Cola durable y compliance beta 8/10 agregados al plan.
- 2026-06-21 - Este informe convierte resultados en backlog launch.
