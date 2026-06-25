---
kind: run
status: done
created_at: 2026-06-21T03:18:04.680Z
tags: [audit, devtools, playwright, massdte]
---

# MassDTE DevTools Audit

## Trigger

Auditoria real de app con Playwright como reproductor verificable y Chrome DevTools MCP como inspector interactivo configurado localmente. La extension SII queda fuera del alcance.

## Run

- Base URL: http://localhost:3001
- Auth source: storage-state
- Storage state path: /tmp/e2e-state.json
- Screenshots: /tmp/massdte-audit-2026-06-21T03-18-04-680Z
- Report: <repo>/artifacts/runs/2026-06-20-massdte-dev-audit.md
- Base status: 307

## Summary

- Routes visited: 10
- Business checks: 10
- Console errors: 4
- Console warnings: 0
- Page errors: 0
- Failed requests: 0
- HTTP 4xx/5xx: 4
- Findings: 0

## Findings

- Sin hallazgos en esta corrida.

## Routes

| Route | Status | Final path | HTTP | ms | Screenshot | Signals |
|---|---|---|---:|---:|---|---|
| dev-cuentas | ok | /dev/cuentas | 200 | 24755 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/01-dev-cuentas.png | no:Panel operador<br>yes:Account 360<br>yes:Ver cliente<br>yes:Detalle |
| dev-diagnostico | ok | /dev/diagnostico | 200 | 1924 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/02-dev-diagnostico.png | no:Diagnostico<br>yes:Genesys<br>no:operador |
| massdte | ok | /massdte | 200 | 6419 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/03-massdte.png | yes:Uso del mes<br>no:Equipo<br>no:Modo soporte Genesys<br>no:Cambiar empresa<br>no:Emitir bloqueado |
| empresa | ok | /empresa | 200 | 3064 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/04-empresa.png | yes:Empresa<br>yes:Datos del emisor<br>yes:Formatos de cartola<br>yes:Folios CAF<br>no:Agregar persona |
| revisar | ok | /revisar | 200 | 2243 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/05-revisar.png | yes:Revisar<br>yes:propuestas<br>yes:pendientes |
| subir | ok | /subir | 200 | 2717 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/06-subir.png | no:Subir<br>yes:documento<br>yes:cartola |
| clientes | ok | /clientes | 200 | 2381 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/07-clientes.png | yes:Clientes<br>yes:cliente |
| boletas-reportes | ok | /boletas/reportes | 200 | 2739 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/08-boletas-reportes.png | yes:Reporte RCV<br>yes:Registro de ventas |
| planes | ok | /planes | 200 | 2826 | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/09-planes.png | no:Start<br>no:Pro<br>no:Business<br>yes:Mercado Pago |
| dev-cuenta-detalle | ok | /dev/cuentas/:uuid |  |  | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/10-dev-cuenta-detalle.png | dynamic |

## Route Deep Detail

### dev-cuentas
- Final path: /dev/cuentas
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/01-dev-cuentas.png
- Page title: App Contable
- H1: Cuentas
- DOMContentLoaded ms: 23123
- Load event ms: 23246
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 825
- Visible text chars: 28008
- Scroll height / viewport: 900 / 900
- UI counts: headings:2, h1:1, sections:1, main:1, forms:1, buttons:2, disabledButtons:0, links:7, inputs:1, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: text:1
- Allowed text hits: Account 360, Buscar, Detalle, Diagnostico, Empresa, Ver cliente
- Allowed button labels: Buscar, Ver cliente
- Allowed link labels: Diagnostico, Detalle
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr
- Network total responses: 22
- Network status counts: 200:22
- Network method counts: GET:22
- Network resource types: document:1, stylesheet:1, font:2, script:18
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1kq8p01._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(dev)_dev_cuentas_page_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /dev/cuentas

### dev-diagnostico
- Final path: /dev/diagnostico
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/02-dev-diagnostico.png
- Page title: App Contable
- H1: Diagnóstico de acceso dev
- DOMContentLoaded ms: 446
- Load event ms: 449
- Resource count from Performance API: 19
- Transfer size KB from Performance API: 5
- Visible text chars: 22713
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:1, main:1, forms:0, buttons:0, disabledButtons:0, links:1, inputs:0, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: n/a
- Allowed text hits: n/a
- Allowed button labels: n/a
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8
- Network total responses: 20
- Network status counts: 200:3, 304:17
- Network method counts: GET:20
- Network resource types: document:1, font:2, stylesheet:1, script:16
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /dev/diagnostico

### massdte
- Final path: /massdte
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/03-massdte.png
- Page title: App Contable
- H1:
- DOMContentLoaded ms: 3905
- Load event ms: 4798
- Resource count from Performance API: 40
- Transfer size KB from Performance API: 768
- Visible text chars: 153451
- Scroll height / viewport: 900 / 900
- UI counts: headings:3, h1:0, sections:1, main:0, forms:0, buttons:22, disabledButtons:0, links:33, inputs:1, images:1, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: text:1
- Allowed text hits: Emitir, Empresa, Revisar, Uso del mes
- Allowed button labels: Revisar, Emitir
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8
- Network total responses: 41
- Network status counts: 200:24, 304:17
- Network method counts: GET:41
- Network resource types: document:1, font:2, stylesheet:1, script:34, image:2, fetch:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_124uk5i._.js
  - 1x /_next/static/chunks/node_modules_1ey150g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/node_modules_xlsx_xlsx_mjs_210h3t3._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_1d9kjl7._.js
  - 1x /_next/static/chunks/src_app_(app)_empresa_0rj504d._.js
  - 1x /_next/static/chunks/src_app_(app)_escritorio_v5_1_7dlmd._.js
  - 1x /_next/static/chunks/src_app_(app)_escritorio_v5_DocCardList_tsx_1ga-lb_._.js
  - 1x /_next/static/chunks/src_app_(app)_escritorio_v5_EmitirDirectaView_tsx_0quv8qy._.js
  - 1x /_next/static/chunks/src_app_(app)_escritorio_v5_LeftQuickActions_tsx_1sw80wd._.js

### empresa
- Final path: /empresa
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/04-empresa.png
- Page title: App Contable
- H1: Empresa
- DOMContentLoaded ms: 1021
- Load event ms: 1447
- Resource count from Performance API: 27
- Transfer size KB from Performance API: 158
- Visible text chars: 27164
- Scroll height / viewport: 3504 / 900
- UI counts: headings:11, h1:1, sections:6, main:1, forms:2, buttons:15, disabledButtons:2, links:3, inputs:8, images:1, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: text:5, email:2, select:1
- Allowed text hits: Emitir, Empresa, Folios CAF, Revisar, Subir
- Allowed button labels: ⇧ Subir archivo, SimpleAPIEmitira con nuestra API key y datos cifrados en la extension.
- Allowed link labels: Emitir, Revisar3, Empresa
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8
- Network total responses: 28
- Network status counts: 200:8, 304:20
- Network method counts: GET:28
- Network resource types: document:1, font:2, stylesheet:1, script:22, fetch:1, image:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/0lo9_dist_build_webpack_loaders_next-flight-loader_action-client-wrapper_11kekkr.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_0kxzm46._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_empresa_page_tsx_07txxx3._.js
  - 1x /_next/static/chunks/src_app_(app)_layout_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2

### revisar
- Final path: /revisar
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/05-revisar.png
- Page title: App Contable
- H1: Revisar
- DOMContentLoaded ms: 751
- Load event ms: 803
- Resource count from Performance API: 25
- Transfer size KB from Performance API: 35
- Visible text chars: 34789
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:0, buttons:5, disabledButtons:0, links:3, inputs:0, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: n/a
- Allowed text hits: Emitir, Empresa, Revisar
- Allowed button labels: n/a
- Allowed link labels: Emitir, Revisar3, Empresa
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:1QtBlB_TFgm6-vUWb4Ndp, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8
- Network total responses: 26
- Network status counts: 200:6, 304:20
- Network method counts: GET:26
- Network resource types: document:1, font:2, stylesheet:1, script:22
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0qghkeb._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_00a7_go._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_layout_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_(app)_revisar_page_tsx_07txxx3._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2

### subir
- Final path: /subir
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/06-subir.png
- Page title: App Contable
- H1: Emitir
- DOMContentLoaded ms: 827
- Load event ms: 884
- Resource count from Performance API: 28
- Transfer size KB from Performance API: 61
- Visible text chars: 18844
- Scroll height / viewport: 900 / 900
- UI counts: headings:3, h1:1, sections:1, main:0, forms:0, buttons:2, disabledButtons:0, links:3, inputs:0, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: n/a
- Allowed text hits: Emitir, Empresa, Revisar, Subir
- Allowed button labels: n/a
- Allowed link labels: Emitir, Revisar3, Empresa
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:1QtBlB_TFgm6-vUWb4Ndp, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8, __next_debug_channel:qunTu2lhdXJOv8hUOBMNz
- Network total responses: 29
- Network status counts: 200:9, 304:20
- Network method counts: GET:29
- Network resource types: document:1, font:2, script:23, stylesheet:1, fetch:2
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_1mkqqcl._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/node_modules_xlsx_xlsx_mjs_0mnip76._.js
  - 1x /_next/static/chunks/src_1c8qh6v._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_layout_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_(app)_subir_page_tsx_07txxx3._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2

### clientes
- Final path: /clientes
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/07-clientes.png
- Page title: App Contable
- H1: Clientes
- DOMContentLoaded ms: 925
- Load event ms: 934
- Resource count from Performance API: 24
- Transfer size KB from Performance API: 18
- Visible text chars: 25203
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:0, buttons:1, disabledButtons:0, links:3, inputs:1, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: text:1
- Allowed text hits: Emitir, Empresa, Revisar
- Allowed button labels: n/a
- Allowed link labels: Emitir, Revisar3, Empresa
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:1QtBlB_TFgm6-vUWb4Ndp, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:dKtY8HyCKkZRwJQLr5MfY, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8, __next_debug_channel:qunTu2lhdXJOv8hUOBMNz
- Network total responses: 25
- Network status counts: 200:5, 304:20
- Network method counts: GET:25
- Network resource types: document:1, font:2, stylesheet:1, script:21
- Top endpoints:
  - 1x /_next/static/chunks/_191xoza._.js
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_clientes_page_tsx_07txxx3._.js
  - 1x /_next/static/chunks/src_app_(app)_layout_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /clientes

### boletas-reportes
- Final path: /boletas/reportes
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/08-boletas-reportes.png
- Page title: App Contable
- H1: Reporte RCV
- DOMContentLoaded ms: 819
- Load event ms: 852
- Resource count from Performance API: 25
- Transfer size KB from Performance API: 13
- Visible text chars: 15758
- Scroll height / viewport: 900 / 900
- UI counts: headings:2, h1:1, sections:0, main:1, forms:0, buttons:2, disabledButtons:0, links:3, inputs:1, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: month:1
- Allowed text hits: Detalle, Emitir, Empresa, Reporte RCV, Revisar
- Allowed button labels: n/a
- Allowed link labels: Emitir, Revisar3, Empresa
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:1QtBlB_TFgm6-vUWb4Ndp, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:dKtY8HyCKkZRwJQLr5MfY, __next_debug_channel:mbWa_HDO01q8QHq-VxyFU, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8, __next_debug_channel:qunTu2lhdXJOv8hUOBMNz
- Network total responses: 26
- Network status counts: 200:6, 304:20
- Network method counts: GET:26
- Network resource types: document:1, font:2, script:21, stylesheet:1, fetch:1
- Top endpoints:
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/_1wpb8cg._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_0y5z1ec._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_21b846o._.js
  - 1x /_next/static/chunks/src_app_(app)_boletas_reportes_page_tsx_07txxx3._.js
  - 1x /_next/static/chunks/src_app_(app)_layout_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /api/sii-mock/rcv?mes=%3Avalue

### planes
- Final path: /planes
- Status: ok
- Screenshot: /tmp/massdte-audit-2026-06-21T03-18-04-680Z/09-planes.png
- Page title: App Contable
- H1: Planes
- DOMContentLoaded ms: 1335
- Load event ms: 1348
- Resource count from Performance API: 21
- Transfer size KB from Performance API: 14
- Visible text chars: 38659
- Scroll height / viewport: 900 / 900
- UI counts: headings:1, h1:1, sections:0, main:0, forms:0, buttons:3, disabledButtons:0, links:1, inputs:0, images:0, imagesWithoutAlt:0, tables:0, dialogs:0, ariaLive:0
- Input types: n/a
- Allowed text hits: Contratar con Mercado Pago, Equipo
- Allowed button labels: Contratar con Mercado Pago
- Allowed link labels: n/a
- Storage keys: local=n/a; session=__next_debug_channel:0Mj6uVQrpwU485ZioXYKr, __next_debug_channel:1F5IlbI9b1I157o82i1H6, __next_debug_channel:1QtBlB_TFgm6-vUWb4Ndp, __next_debug_channel:QP3DKvO0Gv6TfhEkOOStu, __next_debug_channel:dKtY8HyCKkZRwJQLr5MfY, __next_debug_channel:mbWa_HDO01q8QHq-VxyFU, __next_debug_channel:nLLzFmNy8VieedzsvwJNz, __next_debug_channel:pW-pT-ojd9npOXMA6-Gk8, __next_debug_channel:qunTu2lhdXJOv8hUOBMNz
- Network total responses: 22
- Network status counts: 200:5, 304:17
- Network method counts: GET:22
- Network resource types: document:1, font:2, stylesheet:1, script:18
- Top endpoints:
  - 1x /_next/static/chunks/_0gq6_yp._.js
  - 1x /_next/static/chunks/_1anvha4._.js
  - 1x /_next/static/chunks/%5Broot-of-the-server%5D__1athiux._.css
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xch-cm._.js
  - 1x /_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1xx01vv._.js
  - 1x /_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js
  - 1x /_next/static/chunks/node_modules_0ff_g_g._.js
  - 1x /_next/static/chunks/node_modules_next_dist_1ybzpk2._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_0r5nbpw._.js
  - 1x /_next/static/chunks/node_modules_next_dist_client_components_builtin_global-error_0g8hac8.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_1amofcm._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js
  - 1x /_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js
  - 1x /_next/static/chunks/src_app_(paywall)_planes_page_tsx_0g8hac8._.js
  - 1x /_next/static/chunks/src_app_layout_tsx_007e4b2._.js
  - 1x /_next/static/chunks/src_components_0w5w-8z._.js
  - 1x /_next/static/chunks/turbopack-_01_ro95._.js
  - 1x /_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2
  - 1x /_next/static/media/83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2
  - 1x /planes


## Business Checks

| Check | Status | Detail | Evidence |
|---|---|---|---|
| detalle-cuenta | pass | Detalle de cuenta carga con prioridad. | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/10-dev-cuenta-detalle.png |
| modo-cliente-banner | pass | Banner de modo soporte visible. | /tmp/massdte-audit-2026-06-21T03-18-04-680Z/11-modo-cliente-massdte.png |
| support-block-upload | pass | Escritura bloqueada con DEV_SUPPORT_READ_ONLY. |  |
| support-block-checkout | pass | Escritura bloqueada con DEV_SUPPORT_READ_ONLY. |  |
| support-block-emission-job | pass | Escritura bloqueada con DEV_SUPPORT_READ_ONLY. |  |
| support-block-emitir-boleta | pass | Escritura bloqueada con DEV_SUPPORT_READ_ONLY. |  |
| modo-cliente-volver | pass | Volver a dev retorna a /dev/cuentas. |  |
| uso-del-mes | pass | Contador Uso del mes visible. |  |
| plan-equipo-signal | pass | Cuenta no Business: Equipo oculto. |  |
| lock-emision-visible | skipped | No hay lock activo para validar bloqueo visual. |  |

## Browser Diagnostics

### Console
- error: http://localhost:3001/massdte :: Failed to load resource: the server responded with a status of 403 (Forbidden)

### Page Errors
- Sin pageerror.

### Network
- HTTP 403 POST http://localhost:3001/api/subir-procesar (esperado: modo soporte read-only)
- HTTP 403 POST http://localhost:3001/api/pagos/checkout (esperado: modo soporte read-only)
- HTTP 403 POST http://localhost:3001/api/emision/jobs (esperado: modo soporte read-only)
- HTTP 403 POST http://localhost:3001/api/intermediaria/emitir-boleta (esperado: modo soporte read-only)

### Network Totals
- Total responses: 398
- Status counts: 200:185, 304:209, 403:4
- Method counts: GET:392, POST:6
- Resource types: document:13, stylesheet:13, font:28, script:319, image:7, fetch:18

## Storage Privacy Snapshot

- cookies: sb-aluuuyecwifaakehvcam-auth-token
- Valores de cookies, localStorage y sessionStorage no se escriben en este reporte.

## Lighthouse

- No solicitado.

## Validation

- Script ejecutado localmente contra la app en Chrome/Playwright.
- No se probo extension SII ni flujos reales contra SII.

## Timeline

- 2026-06-21T03:18:04.680Z: corrida generada por scripts/audit-app-devtools.mjs.
