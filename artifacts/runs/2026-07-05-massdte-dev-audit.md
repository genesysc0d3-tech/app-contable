---
kind: run
status: blocked
created_at: 2026-07-05T20:29:41.638Z
tags: [audit, devtools, playwright, massdte]
---

# MassDTE DevTools Audit

## Trigger

Auditoria real de app con Playwright como reproductor verificable y Chrome DevTools MCP como inspector interactivo configurado localmente. La extension SII queda fuera del alcance.

## Run

- Base URL: http://localhost:3001
- Auth source: none
- Storage state path: no disponible
- Screenshots: /tmp/massdte-audit-2026-07-05T20-29-41-638Z
- Report: /Users/take/Desktop/app-contable/artifacts/runs/2026-07-05-massdte-dev-audit.md
- Base status: 307

## Summary

- Routes visited: 9
- Support plan scenarios: 0
- Business checks: 3
- Console errors: 0
- Console warnings: 0
- Page errors: 0
- Failed requests: 0 (0 unexpected, 0 expected navigation aborts)
- HTTP 4xx/5xx: 0
- Findings: 1

## Findings

1. **BLOCKED - Auditoria autenticada no ejecutada**
   No existe storage state en /tmp ni se recibieron credenciales por variables de entorno. La corrida valida redirects y salud basica, pero no prueba reglas de negocio autenticadas.
   Evidence: /tmp/e2e-state.json

## Routes

| Route | Status | Final path | HTTP | ms | Screenshot | Signals |
|---|---|---|---:|---:|---|---|
| dev-cuentas | auth-redirect | /auth/login | 200 | 2417 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/01-dev-cuentas.png | no:Panel operador<br>no:Account 360<br>no:Ver cliente<br>no:Detalle |
| dev-diagnostico | auth-redirect | /auth/login | 200 | 1758 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/02-dev-diagnostico.png | no:Diagnostico<br>no:Genesys<br>no:operador |
| massdte | auth-redirect | /auth/login | 200 | 1768 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/03-massdte.png | no:Uso del mes<br>no:Equipo<br>no:Modo soporte Genesys<br>no:Cambiar empresa<br>no:Emitir bloqueado |
| empresa | auth-redirect | /auth/login | 200 | 1775 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/04-empresa.png | no:Empresa<br>no:Datos del emisor<br>no:Formatos de cartola<br>no:Folios CAF<br>no:Agregar persona |
| revisar | auth-redirect | /auth/login | 200 | 1779 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/05-revisar.png | no:Revisar<br>no:propuestas<br>no:pendientes |
| subir | auth-redirect | /auth/login | 200 | 1700 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/06-subir.png | no:Subir<br>no:documento<br>no:cartola |
| clientes | auth-redirect | /auth/login | 200 | 1718 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/07-clientes.png | no:Clientes<br>no:cliente |
| boletas-reportes | auth-redirect | /auth/login | 200 | 1661 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/08-boletas-reportes.png | no:Reporte RCV<br>no:Registro de ventas |
| planes | auth-redirect | /auth/login | 200 | 1699 | /tmp/massdte-audit-2026-07-05T20-29-41-638Z/09-planes.png | no:Start<br>no:Pro<br>no:Business<br>no:Mercado Pago |

## Support Read-Only Matrix

- No ejecutada.

## Route Deep Detail

### dev-cuentas
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/01-dev-cuentas.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 719
- Load event ms: 852
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 829
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:22, 307:1
- Network method counts: GET:23
- Network resource types: document:2, stylesheet:1, font:2, script:18
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /dev/cuentas

### dev-diagnostico
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/02-dev-diagnostico.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 108
- Load event ms: 171
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /dev/diagnostico

### massdte
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/03-massdte.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 231
- Load event ms: 233
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /massdte

### empresa
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/04-empresa.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 217
- Load event ms: 219
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /empresa

### revisar
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/05-revisar.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 220
- Load event ms: 234
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:xC79CM-nMf0gKFURmF-BF, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /revisar

### subir
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/06-subir.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 135
- Load event ms: 169
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:6Xi4o72xlPwP3qtqSYxGB, __next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:xC79CM-nMf0gKFURmF-BF, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /subir

### clientes
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/07-clientes.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 180
- Load event ms: 184
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:6Xi4o72xlPwP3qtqSYxGB, __next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:tF1T6UdvPNqUbpKtSL2YV, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:xC79CM-nMf0gKFURmF-BF, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /clientes

### boletas-reportes
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/08-boletas-reportes.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 92
- Load event ms: 113
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:6Xi4o72xlPwP3qtqSYxGB, __next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:UT3jlMRz2ew_3iOMi1HMK, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:tF1T6UdvPNqUbpKtSL2YV, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:xC79CM-nMf0gKFURmF-BF, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, stylesheet:1, script:18
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /boletas/reportes

### planes
- Final path: /auth/login
- Status: auth-redirect
- Screenshot: /tmp/massdte-audit-2026-07-05T20-29-41-638Z/09-planes.png
- Page title: App Contable
- H1: Iniciar sesión
- DOMContentLoaded ms: 127
- Load event ms: 165
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 6
- Visible text chars: 14871
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:1, buttons:2, disabledButtons:0, links:2, inputs:2, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: email:1, password:1
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:3bYdtxnASGrFY1rVFbq4W, __next_debug_channel:6Xi4o72xlPwP3qtqSYxGB, __next_debug_channel:8xM3UKER05qONpAa6yEWp, __next_debug_channel:UT3jlMRz2ew_3iOMi1HMK, __next_debug_channel:aqFw8OEHxsKOl97U0OEdo, __next_debug_channel:tF1T6UdvPNqUbpKtSL2YV, __next_debug_channel:x8gNvm0oyMobzkRUMd9x7, __next_debug_channel:xC79CM-nMf0gKFURmF-BF, __next_debug_channel:yhFMzJvtMgPBxJckLuuLB
- Network total responses: 23
- Network status counts: 200:3, 304:19, 307:1
- Network method counts: GET:23
- Network resource types: document:2, font:2, script:18, stylesheet:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1se9-m_._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0tgpm7y.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(auth)_auth_login_page_tsx_0tgpm7y._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_Toast_tsx_10-8h_0._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /auth/login
  - 1x /planes


## Business Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|
| dev-flow | skipped | Sin sesion dev esperada; no se entro a detalle ni modo cliente. |  |
| support-plan-readonly-matrix | skipped | Sin sesion dev esperada; no se audito matriz read-only por plan. |  |
| app-business-signals | skipped | Sin sesion autenticada. |  |

## Browser Diagnostics

### Console
- Sin errores ni warnings de consola registrados.

### Page Errors
- Sin pageerror.

### Network
- Sin fallos de red ni HTTP 4xx/5xx registrados.

### Network Totals
- Total responses: 207
- Status counts: 200:46, 304:152, 307:9
- Method counts: GET:207
- Resource types: document:18, stylesheet:9, font:18, script:162

## Storage Privacy Snapshot

- cookies: (sin cookies)
- Valores de cookies, localStorage y sessionStorage no se escriben en este reporte.

## Lighthouse

- No solicitado.

## Validation

- Script ejecutado localmente contra la app en Chrome/Playwright.
- Validacion autenticada pendiente: ejecutar captura manual o login por env y repetir.
- No se probo extension SII ni flujos reales contra SII.

## Timeline

- 2026-07-05T20:29:41.638Z: corrida generada por scripts/audit-app-devtools.mjs.

