---
kind: run
status: done
created_at: 2026-06-21
tags: [audit, cto, production-readiness, security, saas, compliance, chile, massdte]
---

# Auditoria CTO Proyecto App Contable / MassDTE

## Alcance

Auditoria critica de codigo, arquitectura, seguridad, SaaS readiness, testing,
DevOps y riesgos de produccion del proyecto privado `app-contable`, con foco en
la app activa MassDTE (`/massdte`, `src/app/(app)/escritorio/v5`), panel dev,
emision local/SimpleAPI, multiempresa, billing y Telegram.

La emision real con extension/SII/CAF fue reportada OK por el usuario en smoke
manual controlado el 2026-06-21 y quedo registrada sin secretos en
`artifacts/runs/2026-06-21-launch-001-user-smoke.md`. El agente no toco claves
SII, certificados, cookies, CAF ni XML/PDF tributarios crudos.

## Evidencia Usada

- Inspeccion de codigo actual en `src/app`, `src/lib`, `extensions`,
  `supabase/migrations`, `scripts`, `package.json`, `next.config.ts`,
  `vercel.json`.
- Reportes productivos previos:
  - `artifacts/runs/2026-06-21-massdte-production-audit-summary.md`
  - `artifacts/runs/2026-06-21-massdte-emission-lock-audit.md`
  - `artifacts/docs/massdte-production-audit-launch-readiness-2026-06-21.md`
- Validaciones ejecutadas en esta auditoria:
  - `npm run test`: OK, 11 archivos, 83 tests.
  - `npm run build`: OK, Next.js 16.2.9, 39 paginas estaticas/dinamicas listadas.
  - `npm run lint`: OK.
  - `npm audit --audit-level=moderate`: OK, 0 vulnerabilidades.
  - `git diff --check`: OK.
- Referencias externas oficiales:
  - OWASP Top 10:2025: https://owasp.org/Top10/2025/
  - OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Referencias compliance Chile revisadas:
  - Repositorio `compliance-cl`: https://github.com/Lelemon-studio/compliance-cl
  - Fuentes versionadas del repo: https://raw.githubusercontent.com/Lelemon-studio/compliance-cl/main/sources/FUENTES.md
  - Ley 21.719, Diario Oficial: https://www.diariooficial.interior.gob.cl/publicaciones/2024/12/13/44023/01/2583630.pdf
  - Ley 21.719, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1209272
  - Ley 21.595, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1195119
  - Ley 20.393, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1008668

## Scores

| Area | Score | Lectura CTO |
|---|---:|---|
| Arquitectura y estructura | 7.6/10 | Buena separacion app/dev/lib/migrations/artifacts y ahora existe cola durable para documentos/OCR/IA; persisten componentes grandes, estilos inline extensos y algunos caminos duplicados. |
| Calidad y mantenibilidad | 7.3/10 | TypeScript estricto, lint verde, dominios claros y helpers de cola testeados; aun falta reducir componentes largos y estandarizar mas mutaciones service-role. |
| Seguridad | 8.1/10 | Auth/RLS/guards, headers, preview Excel seguro, upload hardening, rate limits, soporte read-only, ops sanitizados y validacion de paths agrupados. Falta rate limit distribuido y alertas externas. |
| Escalabilidad y performance | 7.4/10 | Upload/OCR/IA ya no depende de background volatil: hay job durable, idempotencia, reintentos, watchdog y limite por empresa. Falta worker dedicado/frecuencia subdiaria y load test real. |
| Testing y cobertura | 7.1/10 | CI, Lighthouse, lint, build y 93 tests pasan; faltan coverage threshold, API/billing/extension reproducible y pruebas reales Excel/PDF/imagen post-cola. |
| DevOps / CI-CD readiness | 7.6/10 | PRs reales verdes, Vercel preview/prod OK, migraciones remotas aplicadas, Lighthouse CI y cron versionado. Falta branch protection formal, alertas externas y menos deploy manual. |
| Deuda tecnica / riesgos prod | 7.2/10 | Observabilidad base y cola durable bajan los riesgos rojos de upload/IA; quedan deuda de billing, flags, retention automation y smoke extension reproducible. |
| Mejores practicas SaaS | 7.8/10 | Cuenta pagadora, planes/cupos, multiempresa, equipo Business, soporte read-only, Account 360, locks y legal pages publicas son buena base. Faltan flags auditables y billing E2E reforzado. |
| Compliance Chile | 8.0/10 | RAT/DPA/subencargados, privacidad, terminos, seguridad, brechas, retencion y MPD inicial quedan versionados para beta controlada. No reemplaza revision legal externa. |

**Score tecnico original: 65/100. Score general post-readiness: 70/100. Score
general post-LAUNCH-001 + rate limits iniciales: 74/100. Score actual post
observabilidad + cola durable + compliance beta: 82/100 para beta controlada.**

## Resumen Ejecutivo

El proyecto esta bien encaminado para una beta controlada de la capa SaaS web y
la emision real dejo de ser el bloqueo principal despues del smoke manual
reportado OK con extension/SII/CAF. Desde el cierre posterior, observabilidad
base, cola durable OCR/IA/documentos y compliance chileno 8/10 beta quedaron
implementados/versionados. Aun no esta listo para lanzamiento abierto masivo:
faltan revision legal externa, alertas externas, runbook operativo validado y
mas pruebas de billing/API/documentos reales.

La parte fuerte es producto/tenancy: cuenta pagadora, planes Start/Pro/Business,
modo soporte Genesys, read-only, Account 360, lock remoto de emision y folios
reservados muestran pensamiento de SaaS real. La auditoria productiva web quedo
verde con 0 hallazgos, y el lock remoto tambien fue probado sin ejecutar SII.

La parte debil sigue siendo readiness operacional avanzada y compliance formal:
ya hay CI versionado, lint/test/build/audit verdes, headers, upload hardening,
preview Excel sin HTML, rate limit inicial, observabilidad sanitizada y cola
durable. Para un SaaS chileno que procesa RUT, cartolas, boletas, clientes,
documentos, Telegram e IA, el paquete compliance 8 beta es una base ordenada
para operar beta controlada y para que un abogado revise, no un dictamen legal
final.

## Riesgos Criticos Rojos

### R1 - Emision real SII/CAF validada manualmente, no automatizada

Evidencia: `LAUNCH-001` quedo `done` por smoke manual informado por el usuario
el 2026-06-21. El artifact versionado solo registra resumen no sensible:
`artifacts/runs/2026-06-21-launch-001-user-smoke.md`.

Impacto: baja el riesgo P0 de emision real, pero sigue faltando una corrida
reproducible con checklist versionado: version de extension, tipo DTE, job/lock,
folio reservado/liberado y resultado persistido, todo enmascarado.

Decision: permitir beta controlada con emision real y soporte presente. No
prometer operacion masiva abierta hasta tener alertas externas, runbook validado
y smoke repetible sin datos sensibles.

### R2 - CI/CD verde, falta enforcement formal

Evidencia: los PRs posteriores corrieron checks reales en GitHub: CI principal,
Lighthouse y Vercel preview quedaron verdes antes del merge.

Impacto: el riesgo bajo, pero no desaparece hasta exigir branch protection y
checks requeridos en GitHub.

Decision: mantener PR obligatorio y configurar branch protection formal en
`dev`/`main`.

### R3 - Superficie de upload/IA mitigada con cola durable base

Evidencia:

- `src/app/api/subir-procesar/route.ts` quedo mitigado con validacion previa de
  base64, limite decoded 10 MiB, allowlist de tipo/MIME/extension y nombre
  sanitizado.
- `src/lib/security/rate-limit.ts` agrega rate limit in-memory y se aplica a
  upload/procesar, OCR comprobante, checkout y jobs de emision.
- `document_processing_jobs` persiste jobs con idempotencia, reintentos,
  backoff, watchdog de jobs atascados y metadata sin contenido crudo.
- `/api/subir-procesar` y `/api/procesar-documento` encolan antes de trabajo
  pesado; el kick oportunista solo acelera, no es la fuente de durabilidad.

Impacto: baja fuerte el riesgo de perder trabajos o quemar serverless/IA por
background volatil. Sigue existiendo riesgo de costo/tiempo si la frecuencia
del cron diario no alcanza o si entran muchos documentos simultaneos.

Decision: beta controlada puede usar esta cola base. Para escala abierta,
subir frecuencia con scheduler externo/Vercel Pro o worker dedicado y agregar
metricas de duracion/costo por proveedor.

### R4 - Riesgo XSS en preview de Excel mitigado

Evidencia: esta rama elimina `XLSX.utils.sheet_to_html` y
`dangerouslySetInnerHTML`; ahora el preview renderiza celdas como React desde
datos estructurados.

Impacto: baja el riesgo XSS de preview Excel. Queda pendiente mantener tests y
revisar otros previews/parsers con la misma regla.

Decision: no reintroducir HTML generado desde documentos de usuario.

### R5 - Dependencias auditadas; supply chain `xlsx` sigue rara

Evidencia: `npm audit --audit-level=moderate` queda en 0 vulnerabilidades.
Se actualizo DOMPurify transitivo y se agrego override de PostCSS parcheado sin
degradar Next.

Riesgo residual: `xlsx` viene desde tarball CDN directo
(`https://cdn.sheetjs.com/...`), lo que sigue siendo una decision de supply
chain a revisar.

Impacto: readiness de dependencias mejora, pero conviene formalizar Renovate o
Dependabot y revisar reemplazo/aislamiento de `xlsx`.

Decision: mantener `npm audit` en CI y abrir tarea futura de supply chain para
`xlsx`.

### R6 - Ley 21.719: programa de datos personales no implementado

Evidencia: el producto procesa datos personales, tributarios y financieros:
usuarios, clientes, correos, RUT, cartolas bancarias, PDFs/XML, boletas,
comprobantes Telegram, logs de soporte, prompts/respuestas IA y datos de pago.
No se observa aun un programa formal de privacidad: RAT/inventario de
tratamientos, politica de privacidad versionada, base legal/consentimiento por
flujo, canal de derechos ARCO, retencion/borrado, DPA con encargados,
transferencias internacionales, EIPD para tratamientos de alto riesgo ni plan
operativo de brechas.

Contexto legal: segun las fuentes revisadas, Ley 21.719 modifica Ley 19.628 y
su entrada sustantiva esta programada para el 1 de diciembre de 2026. El pack
`compliance-cl` mapea obligaciones como informacion al titular, consentimiento
cuando corresponda, seguridad, privacidad por diseno, respuesta a derechos,
registro de incidentes, notificacion de brechas y transferencias.

Impacto: si el SaaS llega a beta pagada o lanzamiento abierto sin esto, el
riesgo pasa de tecnico a regulatorio, contractual y reputacional. La ventana de
tiempo existe, pero no conviene dejarlo para el final.

Decision: abrir `COMPLIANCE-001` y tratar Ley 21.719 como parte de launch
readiness, no como documentacion posterior.

### R7 - Ley 21.595 / Ley 20.393: MPD inexistente para operacion SaaS

Evidencia: el repo tiene trazabilidad tecnica y auditoria de cuenta, pero no un
Modelo de Prevencion de Delitos: responsable/oficial, matriz de riesgos,
codigo de etica, canal de denuncias anonimo, controles internos, capacitacion,
regimen disciplinario ni supervision externa periodica.

Contexto legal: segun las fuentes revisadas, Ley 21.595 esta vigente desde el
1 de septiembre de 2024 y refuerza la responsabilidad penal de personas
juridicas bajo Ley 20.393. El pack `compliance-cl` la trata como aplicable
incluso a sociedades pequenas, con foco en que el modelo sea proporcional,
efectivo y demostrable.

Impacto: MassDTE toca datos tributarios, flujos de pago, boletas, SII,
proveedores IA y soporte con modo operador. Eso no exige burocracia gigante
desde el dia uno, pero si exige controles escritos y evidenciables antes de
operar comercialmente con clientes reales.

Decision: crear MPD minimo proporcional para beta: responsable, mapa de riesgos,
canal, codigo de conducta, controles de pagos/datos/SII y evidencias de
capacitacion/supervision.

## Seguridad OWASP / ASVS

Base OWASP considerada: Top 10:2025 y ASVS. Los riesgos mas relevantes para
este proyecto son:

- Broken Access Control: bien trabajado en RLS, cuenta pagadora y guards, pero
  hay service role en muchas rutas y el modo soporte depende de bloqueos por
  endpoint. Recomendacion: centralizar policy de write-block y tests de contrato
  por endpoint.
- Security Misconfiguration: faltan headers de seguridad explicitos en
  `next.config.ts` o middleware: CSP, frame-ancestors/X-Frame, HSTS,
  Referrer-Policy, Permissions-Policy.
- Software Supply Chain Failures: `npm audit` rojo, CDN tarball para `xlsx`,
  sin CI de audit/dependency review.
- Cryptographic Failures: vault local de extension usa AES-GCM + PBKDF2 250k,
  pero PIN SII permite 4-8 digitos. Hay bloqueo de intentos, aun asi es bajo
  para secreto tributario; conviene preferir passphrase larga o WebAuthn/local
  keychain.
- Injection/XSS: SQL va por Supabase query builder, bien. XSS pendiente en
  preview Excel. AI prompt/data injection no esta modelado formalmente.
- Auth Failures: Supabase Auth esta bien integrado; login propio no aplica tanto
  porque Supabase protege. APIs internas criticas ya tienen throttling inicial,
  falta hacerlo distribuido y con metricas.
- Logging and Alerting: hay `ops_events`, `/dev/diagnostico`, cron ops y
  hallazgos de cola/jobs; falta Sentry/log drain, uptime checks y alertas
  externas.
- Mishandling Exceptional Conditions: muchos catch devuelven mensajes internos
  o `detalle`; util para beta, debe endurecerse antes de produccion abierta.

## Addendum Compliance Chile

Este bloque no reemplaza una revision de abogado. Es una lectura tecnica de
readiness de SaaS chileno usando `compliance-cl` y sus fuentes oficiales
referenciadas como insumo.

### Ley 21.719 - Datos personales

Score beta controlada: **8.0/10**.

La app tiene buena base tecnica en aislamiento por empresa/cuenta, soporte
read-only, auditoria, locks y enmascaramiento del panel dev. Eso ayuda, pero no
equivale por si solo a cumplimiento de datos personales. Despues del cierre
post-auditoria quedan versionados RAT inicial, politica de privacidad,
terminos, pagina de seguridad, DPA/subencargados, retencion/borrado, brechas y
cola durable que evita guardar contenido crudo en jobs.

Queda pendiente para 9/10:

- Revision legal externa de privacidad, terminos, DPA, transferencias
  internacionales y bases legales por flujo.
- Nombramiento formal de responsable/oficial de privacidad.
- Canal operativo para derechos ARCO con registro de solicitudes y SLA.
- EIPD/analisis de alto riesgo para IA/OCR sobre informacion financiera y
  tributaria.
- Automatizar retencion/borrado cuando el volumen real lo justifique.

Prioridad: alta antes de beta pagada. La entrada sustantiva indicada por las
fuentes revisadas es el 1 de diciembre de 2026, pero el costo de arreglar datos
mal gobernados crece rapido una vez que hay clientes reales.

### Ley 21.595 / Ley 20.393 - Delitos economicos

Score beta controlada: **7.8/10**.

La app ya tiene controles tecnicos que sirven como evidencia parcial:
auditoria de cuenta, soporte read-only, modo Genesys acotado, locks de emision,
validaciones de pago, logs de acciones sensibles y documentos iniciales de MPD.
Es una base proporcional para beta controlada, no un modelo certificado.

Pendiente para 9/10:

- Responsable/oficial de prevencion nombrado formalmente.
- Codigo de etica/conducta y canal de denuncia anonimo aplicable al equipo.
- Evidencia de capacitacion/aceptacion de politicas.
- Controles escritos mas detallados para pagos, soporte, cambios productivos y
  manejo de incidentes.
- Supervision o revision externa periodica del modelo.

Prioridad: alta para operar como SaaS que toca impuestos, documentos y pagos.
No bloquea beta controlada, pero si deberia bloquear venta abierta sin revision
legal/externa.

### Plan compliance incorporado

Quick wins (1-3 dias):

1. Hecho beta: inventario de tratamientos/RAT inicial con datos, finalidad,
   origen, destinatarios, retencion, seguridad y proveedor.
2. Hecho beta: politica de privacidad, terminos SaaS y DPA/subencargados
   versionados, mas paginas publicas `/legal/*`.
3. Hecho beta: proceso ARCO manual asistido: correo/canal, SLA interno,
   checklist de busqueda/exportacion/borrado y log de respuesta.
4. Hecho beta: mapa de proveedores y transferencias: Supabase, Vercel, IA, Telegram, Mercado
   Pago, GitHub/logs. Decidir que datos puede recibir cada uno.
5. Hecho beta: plan de brechas v0: severidad, registro, comunicacion interna,
   contencion, notificacion, evidencias y postmortem.
6. Hecho beta: MPD minimo: responsable, matriz de riesgos, codigo de conducta,
   canal de denuncias, controles, capacitacion y revision periodica.
7. Usar `compliance-cl` solo como herramienta/referencia en rama separada si se
   decide adoptarla; no copiar codigo ni documentos sin revision.

Medio plazo (1-3 semanas):

1. Implementar flujos internos para exportar/borrar datos por cliente/cuenta sin
   romper obligaciones tributarias o de auditoria.
2. Agregar retencion/borrado programado para uploads temporales, previews,
   artifacts sensibles, logs IA y comprobantes Telegram.
3. Agregar etiquetas de sensibilidad y minimizacion: que la IA reciba solo lo
   necesario y que los logs no guarden contenido completo innecesario.
4. Versionar consentimiento/avisos de privacidad en onboarding, Telegram,
   upload de cartolas y soporte dev.
5. Convertir auditoria de cuenta en evidencia de compliance: quien accedio,
   que cambio, que dato sensible se exporto o borro, y por que.
6. Preparar revision legal externa antes de beta pagada o lanzamiento abierto.

## Hallazgos Por Area

### Arquitectura

Fortalezas:

- App activa separada en `src/app/(app)` y dev panel en `src/app/(dev)`.
- Dominio SaaS separado en `src/lib/entitlements.ts`, `src/lib/pagos`,
  `src/lib/emission`, `src/lib/dev`.
- Migrations Supabase ordenadas y con RLS/hardening.
- Artifacts/loops/specs documentan decisiones y backlog.

Debilidades:

- 45 API route handlers: la superficie ya pide guard comun, rate limiting y
  convenciones obligatorias.
- Logica de negocio mezclada en route handlers/server actions grandes.
- El legacy esta declarado muerto, pero aun hay rutas/redirects/scripts y carga
  mental.
- Extension, auditorias, scripts SII reales y app viven en el mismo repo sin
  frontera operacional fuerte.

### Calidad

Fortalezas:

- `strict: true` en TypeScript.
- Tests puros para metering, SII validation, emission locks, Telegram
  deterministico.
- Comentarios buenos en zonas complejas: locks, folios, billing, RLS.

Debilidades:

- `npm run lint` ya esta verde en esta rama.
- UI v5 tiene componentes grandes con inline styles extensos; dificil testear y
  revisar.

### Seguridad

Fortalezas:

- Supabase Auth SSR/proxy correctamente usado.
- RLS base por `empresa_id`; `usuarios` endurecido para self-select.
- Service role se usa server-side y normalmente con scope por empresa/cuenta.
- Mercado Pago webhook valida firma si hay secreto y en produccion falla cerrado
  si falta `MP_WEBHOOK_SECRET`.
- Telegram webhook exige secret header.
- Logo SVG bloqueado por riesgo XSS.
- Extension valida origen app/SII y mantiene secretos localmente cifrados.
- Headers base agregados en `next.config.ts`.
- Preview Excel renderiza React desde datos estructurados, sin HTML generado.
- `/api/subir-procesar` valida base64/tamano/tipo/MIME/extension/nombre antes
  de decodificar o guardar.
- `npm audit --audit-level=moderate` queda en 0 vulnerabilidades.

Debilidades:

- Rate limiting inicial existe, pero es in-memory por instancia; falta backend
  distribuido si aumenta trafico o concurrencia.
- Upload/IA aun tiene limites inconsistentes fuera de `/api/subir-procesar`.
- `getDevSupportWriteBlock` esta distribuido por endpoint/action, no garantizado
  por una politica central de mutacion.
- DeepSeek/Mistral calls no muestran timeout/retry/circuit breaker uniforme.
- `api/config/ai-key` guarda clave global en DB; solo dev_mode escribe, pero
  deberia auditar/rotar y restringir lectura operacional.

### Escalabilidad / Performance

Fortalezas:

- Muchas queries tienen `.limit()`.
- Dashboard usa `Promise.all` para paralelizar lecturas.
- Lock por cuenta evita doble emision remota.
- SimpleAPI usa reserva central de folios.

Debilidades:

- Dashboard `/massdte` hace muchas queries server-side y algunas traen hasta
  5000 boletas.
- OCR/parse/AI ya pasa por cola durable base, pero el worker corre en Vercel
  Functions y el cron actual es diario por configuracion conservadora.
- Lighthouse CI queda integrado para rutas publicas sin sesion; falta extender
  budgets a `/massdte` y `/dev/cuentas` con estado autenticado controlado.
- No hay load test ni simulacion de multiples cuentas/equipos.

### Testing

Estado:

- `npm run test`: 14 archivos, 93 tests, OK.
- Playwright audits productivos cubren dev/support/roles/locks.
- Nuevos tests cubren upload validation, preview Excel estructurado, headers,
  rate limits, sanitizacion ops y helpers de cola durable.

Brechas:

- Sin coverage threshold.
- Falta test de API para cada mutacion service-role.
- Falta test de billing: webhook firmado, idempotencia, estados morosa/pausada,
  addon pendiente.
- Falta ampliar upload tests a ruta HTTP completa, PDFs maliciosos y corrida
  real post-cola con Excel/PDF/imagen.
- Falta automatizar o repetir con checklist versionado el smoke extension/SII
  real ya informado OK por el usuario.

### DevOps

Fortalezas:

- GitHub Actions agregado con install, lint, test, build y audit production.
- Lighthouse CI agregado para rutas publicas sin sesion.
- Vercel preview/prod OK en PRs reales.
- `vercel.json` tiene cron de pagos, ops y documentos.
- Supabase migrations y scripts locales existen.
- `.gitignore` ignora `.vercel/token` y `.supabase/token`; no aparecen
  versionados en `git ls-files`.

Debilidades:

- Falta activar branch protection formal.
- Deploy manual/agent-driven.
- Hay observabilidad base en `ops_events` y `/dev/diagnostico`; falta Sentry,
  log drain, uptime checks y alertas externas.
- Runbook beta inicial creado; falta validarlo con primera cuenta beta real.

### SaaS

Fortalezas:

- Cuenta pagadora central.
- Planes Start/Pro/Business con cupos.
- Multiempresa y equipo Business.
- Addons/personas adicionales.
- Modo soporte Genesys read-only auditado.
- Account 360 con datos enmascarados.
- Locks de emision por cuenta y visibilidad Business vs Start/Pro.

Brechas:

- Feature flags aun parecen env/manuales, no un sistema auditable.
- Billing necesita mas pruebas end-to-end y reconciliacion operacional.
- Runbook beta inicial existe; falta prueba operativa con usuario/cuenta beta.
- Politica inicial de retencion/borrado existe como artefacto compliance, pero
  falta convertirla en jobs/producto y revision legal.

## Plan Priorizado

### Quick Wins (1-3 dias)

1. Hecho: `npm run lint` en verde.
2. Hecho: CI minimo con `npm ci`, lint, test, build y audit production.
3. Hecho: `npm audit --audit-level=moderate` en 0 vulnerabilidades.
4. Hecho: headers base de seguridad en `next.config.ts`.
5. Hecho: preview Excel sin `dangerouslySetInnerHTML`.
6. Hecho: `/api/subir-procesar` valida base64, tamano, tipo, MIME, extension y
   nombre, y encola job durable antes del trabajo pesado.
7. Hecho parcial: rate limit inicial en upload/procesar, OCR comprobante,
   checkout y jobs de emision.
8. Pendiente: centralizar guard de modo soporte read-only para mutaciones.
9. Pendiente: crear tests de contrato para endpoints mutantes principales: soporte mode,
   account guard, upload, checkout, emision jobs.
10. Hecho parcial: `LAUNCH-002` tiene runbook beta inicial; falta validar
   post-deploy.
11. Hecho beta: `COMPLIANCE-001` tiene RAT/DPA/proveedores/ARCO/retencion/
    brechas/MPD, paginas publicas legales y score 8/10 para beta controlada;
    falta revision legal externa.

### Medio Plazo (1-3 semanas)

1. Convertir `LAUNCH-001` en smoke reproducible: checklist versionado,
   evidencia enmascarada, version de extension, job/lock/folio y resultado.
2. Escalar cola durable OCR/IA/procesamiento:
   scheduler subdiario, worker dedicado o proveedor tipo Inngest/Trigger.dev/
   Cloud Tasks si el volumen supera Vercel cron diario.
3. Observabilidad avanzada: Sentry, Vercel log drain, alertas por 5xx, errores
   IA, pagos fallidos, jobs atascados, locks expirados, webhook retries.
4. Feature flags/auditoria de flags para proveedores de emision, Telegram,
   billing y modo beta.
5. Test suite API/integration para billing completo:
   checkout, webhook firmado, idempotencia, cron morosidad, addons.
6. Modelo formal de privacidad/retencion:
   documentos subidos, PDFs/XML tributarios, logs IA, artifacts, soporte dev.
7. Load/performance pass:
   10, 100, 1000 documentos; empresas con 5000 boletas; multiempresa Business;
   tiempos de dashboard y queries.
8. Separar extension release:
   versionado, checklist de permisos, store/local package, smoke reproducible.
9. Revision legal externa previa a beta pagada/lanzamiento abierto para validar
   Ley 21.719, Ley 21.595, contratos, proveedores y transferencias.

## Decision Go / No-Go

Go para beta controlada de la app web, con mensaje acotado:

- Gestion de cartolas, propuestas, reportes, soporte y pruebas controladas.
- Emision real permitida solo como prueba controlada con soporte y evidencia no
  sensible.

No-go para lanzamiento abierto o venta fuerte de emision SII masiva:

- Falta runbook operacional validado con primera cuenta beta.
- Falta revision legal externa del paquete compliance 8 beta y contratos/DPA.
- Falta alertas externas/log drain/Sentry para emision real, upload, IA, pagos
  y locks.
- Falta smoke reproducible de extension/SII/CAF versionado y enmascarado.
- Falta prueba real post-cola con Excel/PDF/imagen y monitoreo de costos IA.

## Score Final

**82/100 para beta controlada despues de observabilidad base, cola durable
OCR/IA/documentos y compliance Chile 8/10 beta.**

Referencia interna: el score ajustado con compliance antes de esta rama era
62/100. Sube por lint/CI/audit/headers/upload/Excel/runbook/compliance minimo,
smoke manual SII/CAF, rate limits iniciales, observabilidad base, cola durable
y paquete compliance 8 beta. Sigue bloqueado para lanzamiento abierto por
revision legal externa, alertas externas, smoke reproducible y pruebas reales
de carga/documentos.

Lectura directa: producto bien pensado, base SaaS prometedora, pero aun no es
produccion madura. Esta en el punto correcto para ordenar fundamentos
operacionales y compliance antes de meter clientes reales con obligaciones
tributarias.
