---
kind: doc
status: active
created_at: 2026-06-24
tags: [quality, security, compliance, ley-21719, operations, gates, massdte]
---

# MassDTE - Plan Reestructurado De Calidad, Seguridad, Compliance Y Operacion

Documento durable para retomar contexto despues de reinicio, cambio de agente o
auditoria. No contiene secretos, credenciales, documentos tributarios, XML, PDF,
cartolas, cookies ni datos reales de clientes.

## Resumen Ejecutivo

MassDTE ya tiene una base tecnica fuerte:

- CI con lint, tests, build y `npm audit`.
- Lighthouse CI separado.
- Auditorias productivas `audit:app`, `audit:roles` y `audit:locks`.
- Compliance Chile beta 8/10 versionado.
- Cola durable base para OCR/IA/documentos.
- Observabilidad `ops_events` con sanitizacion.
- Autorizacion versionada de emision real.
- Hardening inicial de extension, vaults, page-map, resultados y RCV lazy load.

El problema ya no es "crear todo desde cero". El problema es convertir lo que
existe en barreras obligatorias y operables con clientes reales.

Objetivo:

> Pasar de "documentado y auditado manualmente" a "obligatorio, repetible,
> auditable y seguro para clientes reales".

Prioridades no negociables:

1. Ley 21.719 y datos personales.
2. Datos tributarios y financieros.
3. Emision, folios, locks, jobs y autorizaciones.
4. Pagos, cupos y doble cobro.
5. Soporte dev read-only.
6. Extension SII/SimpleAPI.
7. Artifacts y logs sin datos crudos.
8. Calidad de codigo y documentacion operativa para corregir bugs sin romper
   produccion.

## Decision Sobre Ponytail

Ponytail se adopta solo como criterio anti-sobreingenieria:

- menor diff correcto;
- menos dependencias;
- reutilizar helpers y patrones existentes;
- no crear abstracciones "por si acaso";
- preferir APIs nativas/stdlib/framework cuando sean suficientes.

Ponytail no manda sobre:

- seguridad;
- compliance;
- auth, ownership, RLS;
- auditoria;
- logs sanitizados;
- validaciones;
- tests;
- retencion;
- consentimiento;
- emision;
- pagos;
- extension;
- documentacion operativa.

Regla final:

> En MassDTE, el "minimo correcto" incluye seguridad, auditoria, pruebas,
> documentacion y cumplimiento. Si una simplificacion corta eso, no es calidad:
> es riesgo.

## Hallazgos Que Originan Este Plan

Las tres revisiones independientes coincidieron:

- La base esta mejor que una app "vibe-coded" sin control, pero todavia faltan
  gates permanentes.
- CI no bloquea secretos, artifacts sensibles ni patrones MassDTE peligrosos.
- Hay material sensible local dentro del arbol del repo aunque ignorado:
  `.env.local`, `.env.github`, `.vercel/token`, `.supabase/token`,
  `.sii-explorer-profile`, `artifacts/playwright-auth/**`.
- Los artifacts versionados siguen reglas sanas, pero algunos reportes contienen
  rutas absolutas locales como `/Users/take/Desktop/...`.
- La Ley 21.719 exige evidencia por flujo: finalidad, proporcionalidad,
  seguridad, transparencia, confidencialidad y derechos de acceso,
  rectificacion, supresion, oposicion, portabilidad y bloqueo.
- Ley 21.595 / Ley 20.393 debe tratarse como gobierno interno proporcional:
  responsable, matriz de riesgos, canal, evidencia y controles.
- Un junior podria romper seguridad creyendo que esta "simplificando" codigo.

Fuentes legales de referencia:

- Ley 21.719: https://www.bcn.cl/leychile/navegar?idNorma=1209272
- Ley 21.595: https://www.bcn.cl/leychile/navegar?idNorma=1195119
- Ley 20.393: https://www.bcn.cl/leychile/navegar?idNorma=1008668
- Ley 21.663: https://www.bcn.cl/leychile/navegar?idNorma=1202434

## Fase 0 - Baseline Y Limpieza Segura

Objetivo: saber exactamente que material sensible existe localmente, que esta
trackeado y que debe quedar prohibido en Git/artifacts.

Acciones:

- Inventariar, sin imprimir valores:
  - `.env*`;
  - `.vercel/token`;
  - `.supabase/token`;
  - `.sii-explorer-profile/**`;
  - `artifacts/playwright-auth/**`;
  - storage states;
  - perfiles Chrome;
  - cookies;
  - login data;
  - certificados/CAF/PFX;
  - XML/PDF/base64/cartolas.
- Confirmar que esos paths estan ignorados por Git.
- Mover sesiones Playwright/Chrome nuevas fuera del arbol del repo por defecto,
  idealmente `/tmp` o una carpeta local explicitamente excluida.
- Revisar `artifacts/runs` versionados para detectar:
  - rutas absolutas locales;
  - nombres concretos de cookies;
  - IDs largos innecesarios;
  - URLs internas completas;
  - evidencia demasiado detallada.
- No borrar material local sensible sin aprobacion explicita.

Entregables:

- `artifacts/docs/artifact-sanitization-policy.md`
- Reporte baseline sanitizado, sin valores secretos.

## Fase 1 - Gates Automaticos P0

Objetivo: que secretos, datos crudos y patrones peligrosos no dependan de
memoria humana.

Agregar scripts:

```bash
npm run audit:secrets
npm run audit:safety
npm run check:prod-readiness
```

### `audit:secrets`

Debe bloquear hallazgos criticos como:

- tokens;
- cookies;
- service role;
- claves privadas;
- certificados;
- CAF/PFX;
- `.env` reales;
- storage state;
- perfiles Chrome;
- XML/PDF/base64 real;
- claves SII;
- passphrases;
- `GH_TOKEN` o `x-access-token`;
- `.vercel/token`;
- `.supabase/token`.

Regla: reportar archivo, linea y tipo de hallazgo, nunca imprimir el valor.

### `audit:safety`

Scanner propio MassDTE para patrones de riesgo:

- artifacts inseguros;
- `service_role` en cliente o helper no server-only;
- APIs sin guard visible;
- rutas que aceptan `empresa_id`, `cuenta_id`, `user_id`, plan o rol desde
  cliente sin ownership server-side;
- logs con `payload`, `raw`, `xml`, `pdf`, `base64`, `prompt`, `response`;
- uso riesgoso de `localStorage`/`sessionStorage` para datos sensibles;
- soporte dev que permita escrituras;
- Start/Pro viendo Equipo/presencia;
- emision sin autorizacion versionada;
- jobs/locks sin cleanup/idempotencia;
- OCR/IA/documentos fuera de la cola durable;
- scripts legacy que usen tokens/env de forma peligrosa.

En v1:

- Criticos bloquean CI.
- Dudosos quedan como warning.
- Warnings repetidos se convierten en bloqueos despues del baseline.

### `check:prod-readiness`

Debe ejecutar:

```bash
npm run lint
npm run test
npm run build
npm audit --omit=dev --audit-level=high
npm run audit:secrets
npm run audit:safety
```

Si existe sesion segura:

```bash
npm run audit:roles
npm run audit:locks
npm run audit:app
```

CI:

- Actualizar `.github/workflows/ci.yml`.
- Ejecutar `audit:secrets` y `audit:safety` antes de build.
- No usar credenciales reales en CI.
- Lighthouse queda separado.

## Fase 2 - Documentacion Operativa

Objetivo: que un bug con clientes activos se pueda corregir sin depender de
memoria ni improvisacion.

Crear:

- `artifacts/docs/engineering-quality-gates.md`
- `artifacts/docs/production-bugfix-runbook.md`
- `artifacts/docs/compliance/ley-21719-technical-checklist.md`
- `artifacts/docs/artifact-sanitization-policy.md`
- `scripts/README.md`

Actualizar o crear mapa backend activo:

- `src/app/(app)/escritorio/v5/BACKEND_MAP.md` si existe o equivalente en
  `artifacts/docs/`.

Debe cubrir:

- `/massdte` / v5;
- uploads/cartolas;
- revisar;
- emitir;
- boletas;
- pagos/cupos;
- soporte dev;
- Telegram;
- OCR/IA;
- extension SII;
- SimpleAPI;
- locks/jobs/folios;
- autorizaciones de emision;
- ops events;
- cola durable;
- rutas legacy que no se tocan.

## Fase 3 - Checklist Tecnico Ley 21.719

Objetivo: convertir compliance en evidencia por flujo, no solo en textos
publicos.

Flujos obligatorios:

- registro/cuenta;
- empresas/clientes;
- uploads/cartolas;
- OCR/IA;
- Telegram;
- pagos;
- emision;
- soporte dev;
- extension SII/SimpleAPI;
- documentos/Storage;
- observabilidad/artifacts.

Por flujo registrar:

- finalidad;
- datos tratados;
- base legal/consentimiento;
- proveedor/subencargado;
- transferencia internacional si aplica;
- retencion;
- derechos ARCO;
- borrado/exportacion;
- logs/evidencia;
- riesgos;
- responsable interno;
- estado: pendiente, beta, revisado, externo.

Pendientes para 9/10 real:

- revision legal externa;
- DPAs firmados/aceptados;
- responsable/oficial de privacidad formal;
- canal formal de privacidad/incidentes;
- proceso ARCO/brechas aprobado;
- EIPD para OCR/IA financiera/tributaria;
- MPD proporcional Ley 21.595 / 20.393.

## Fase 4 - Operacion Con Clientes

Objetivo: subir de beta tecnica a operacion controlada.

Acciones:

- Revisar frecuencia real de la cola durable. Cron diario puede ser
  insuficiente si hay clientes reales y jobs pendientes.
- Confirmar alerta obligatoria para errores criticos:
  `OPS_ALERT_WEBHOOK_URL` o equivalente.
- Definir rollback por dominio:
  - emision;
  - pagos;
  - documentos/OCR/IA;
  - Telegram;
  - soporte dev;
  - deploys.
- Runbook especifico emision:
  - cancelar job;
  - liberar lock;
  - revisar folio;
  - reconciliar resultado;
  - bloquear cuenta si hay riesgo;
  - comunicar cliente;
  - cerrar evidencia sanitizada.
- Lighthouse autenticado futuro para `/massdte` y `/dev/cuentas`.
- Branch protection con CI obligatorio antes de abrir mas clientes.

## Fase 5 - Endurecimiento Progresivo Y Auditoria Externa

Objetivo: avanzar desde gates propios a auditoria formal.

Acciones:

- Convertir warnings repetidos en bloqueos.
- Evaluar `gitleaks`/Semgrep despues de limpiar baseline para no meter ruido
  inutil.
- Ejecutar revision externa legal/seguridad con evidencia ordenada.
- No autodeclarar "10/10", "certificado" ni "blindado".
- Mantener lenguaje publico: readiness, controles, evidencia, mejora continua.

## Matriz Junior / Senior / DevOps / Legal

### Junior Puede Hacer

- Crear scanners simples sin imprimir valores.
- Agregar scripts npm.
- Documentar flujos existentes.
- Crear checklist de bugfix.
- Limpiar wording de runbooks.
- Sanitizar rutas locales en artifacts nuevos.
- Agregar tests unitarios simples.
- Correr `lint`, `test`, `build`, `check:prod-readiness`.

### Senior Engineering Debe Hacer

- Definir que hallazgos bloquean CI.
- Revisar auth, ownership, RLS y service role.
- Revisar emision, locks, folios, pagos y cupos.
- Aprobar cambios en extension/vault/manifest.
- Disenar rollback real de emision/pagos/documentos.
- Revisar que Ponytail no recorte seguridad.

### DevOps Debe Hacer

- Endurecer CI.
- Definir branch protection.
- Revisar cron/worker/colas.
- Confirmar alertas.
- Definir manejo de tokens y sesiones fuera del repo.
- Revisar despliegues y rollback.

### Legal / Contador / Compliance Debe Hacer

- Validar privacidad, terminos, DPA y postura publica.
- Definir base legal por flujo.
- Revisar retencion tributaria.
- Aprobar proceso ARCO/brechas.
- Validar postura "MassDTE es herramienta; el usuario autorizado emite".

### Soporte / Producto Debe Hacer

- Definir comunicacion ante incidentes.
- Definir cuando pausar operaciones.
- Mantener evidencia sanitizada.
- Escalar casos tributarios al contador interno.

## Checklist Operativo Para Junior

Antes de tocar codigo:

- Crear rama desde `dev`; nunca trabajar directo en `dev` o `main`.
- Leer `AGENTS.md`.
- Leer `docs/MEMORIA.md`.
- Leer `docs/DECISION_FINAL_PRODUCTO.txt` si toca planes, emision, Telegram,
  Business, soporte o gating.
- No leer `.env.local`, `.env.github`, `.env.setup`.
- Confirmar si toca P0/P1:
  - auth;
  - RLS;
  - pagos;
  - emision;
  - locks;
  - folios;
  - extension;
  - OCR/IA;
  - documentos;
  - Telegram;
  - soporte dev.
- No tocar legacy `/escritorio` v1-v4.

Durante el cambio:

- En APIs, usar guard existente o patron equivalente: sesion, empresa, cuenta,
  plan, rol, soporte read-only.
- Nunca confiar en `empresa_id`, `cuenta_id`, `user_id`, plan o rol enviados
  desde cliente.
- En modo soporte Genesys, toda escritura critica debe bloquearse.
- No loguear payloads crudos, XML, PDF, base64, prompts, responses IA, cookies,
  tokens, RUT/email completos.
- Usar `sanitizeOpsMetadata` / `recordOpsEvent` para observabilidad.
- No meter dependencias salvo razon fuerte.
- No arreglar tests debilitando seguridad.

Antes de cerrar:

- `npm run lint`
- `npm run test`
- `npm run build`
- `git diff --check`
- Si toca emision: `npm run audit:locks`.
- Si toca roles/planes/Business: `npm run audit:roles`.
- Si toca soporte/dev/app-wide: `npm run audit:app`.
- Si toca DB: migracion ordenada, tipos y dry-run/lint Supabase cuando aplique.

## Guardrails De Senior Reviewer

Rechazar PR si:

- valida seguridad solo en UI;
- usa service role sin ownership explicito;
- rompe `DEV_SUPPORT_READ_ONLY`;
- expone Equipo/presencia a Start/Pro;
- permite emitir sin autorizacion versionada;
- crea jobs/locks sin idempotencia o cleanup;
- guarda secretos o datos tributarios crudos en artifacts;
- agrega logs con `payload`, `raw`, `base64`, `xml`, `pdf`, `prompt`,
  `response`;
- cambia extension/vault/manifest sin threat model y prueba manual clara;
- toca OCR/IA/documentos sin respetar cola durable;
- cambia pagos/cupos sin test de doble cobro o compra pendiente;
- publica docs comerciales diciendo "cumplimos 10/10" o "certificado".

## Test Plan

Local base:

```bash
npm run lint
npm run test
npm run build
npm audit --omit=dev --audit-level=high
npm run audit:secrets
npm run audit:safety
npm run check:prod-readiness
```

Auditorias con sesion segura:

```bash
npm run audit:roles
npm run audit:locks
npm run audit:app
```

Validaciones minimas:

- secreto artificial temporal detectado sin imprimir valor;
- `artifacts/playwright-auth/**` detectado como critico si intenta entrar a Git;
- rutas personales en artifacts reportadas como warning;
- CI falla por criticos;
- logs no muestran secretos ni datos crudos;
- `audit:app/roles/locks` se mantienen verdes antes de deploy relevante.

## Assumptions

- No instalar Ponytail, Semgrep ni gitleaks en v1.
- V1 usa scanners Node propios, sin dependencias nuevas.
- No leer `.env.local`, `.env.github` ni credenciales.
- No tocar extension/SII real en este paquete.
- No borrar material local sensible sin aprobacion explicita.
- Base branch: `dev`; nunca `main` directo.
- Objetivo: operacion segura y auditable, no declarar cumplimiento legal final.

