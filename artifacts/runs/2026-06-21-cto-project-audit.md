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
| Arquitectura y estructura | 7.0/10 | Buena separacion app/dev/lib/migrations/artifacts, pero aun hay legacy operativo, scripts de prueba SII y mucha logica pesada en route handlers/server actions. |
| Calidad y mantenibilidad | 7.0/10 | TypeScript estricto, lint verde y dominios claros; persisten componentes grandes, estilos inline extensos y caminos duplicados de procesamiento. |
| Seguridad | 7.6/10 | Auth/RLS/guards estan bastante trabajados; ahora hay headers, preview Excel sin HTML, limites de upload, audit limpio y rate limit inicial en endpoints caros/sensibles. Falta observabilidad. |
| Escalabilidad y performance | 6.1/10 | Build OK y queries con limites en varias rutas; LAUNCH-001 ya no bloquea, pero IA/OCR y parseo siguen en background volatil. La cola durable queda especificada en ENG-003. |
| Testing y cobertura | 6.4/10 | Tests pasan, incluyendo upload, preview Excel, headers y rate limit; faltan coverage threshold, API/billing/extension reproducible y corrida CI remota. |
| DevOps / CI-CD readiness | 6.7/10 | Se agrega GitHub Actions con lint/test/build/audit y audit limpio; falta branch protection, PR real verde y deploy menos manual. |
| Deuda tecnica / riesgos prod | 6.4/10 | LAUNCH-001 baja el riesgo de emision real, pero uploads/AI siguen fragiles sin cola durable y la superficie API ya es grande. |
| Mejores practicas SaaS | 7.3/10 | Cuenta pagadora, planes, cupos, multiempresa, soporte read-only, locks por cuenta y smoke real controlado son buenas bases; faltan flags, observabilidad, runbook beta validado y billing end-to-end. |
| Compliance Chile | 4.2/10 | Se agrego paquete operativo minimo RAT/proveedores/ARCO/retencion/brechas/MPD; falta revision legal, terminos/DPA formales y flujos producto. |

**Score tecnico original: 65/100. Score general post-readiness: 70/100. Score
general post-LAUNCH-001 + rate limits iniciales: 74/100.**

## Resumen Ejecutivo

El proyecto esta bien encaminado para una beta controlada de la capa SaaS web y
la emision real dejo de ser el bloqueo principal despues del smoke manual
reportado OK con extension/SII/CAF. Aun no esta listo para lanzamiento abierto:
faltan observabilidad, cola durable, runbook operativo validado, mas pruebas de
billing/API y cierre compliance/legal.

La parte fuerte es producto/tenancy: cuenta pagadora, planes Start/Pro/Business,
modo soporte Genesys, read-only, Account 360, lock remoto de emision y folios
reservados muestran pensamiento de SaaS real. La auditoria productiva web quedo
verde con 0 hallazgos, y el lock remoto tambien fue probado sin ejecutar SII.

La parte debil sigue siendo readiness operacional avanzada y compliance formal:
ya hay CI versionado, lint/test/build/audit verdes, headers, upload hardening,
preview Excel sin HTML y rate limit inicial en endpoints caros/sensibles, pero
faltan rate limiting distribuido, observabilidad/alertas, cola durable para
archivos/IA y revision legal externa. Para un SaaS chileno que procesa RUT, cartolas,
boletas, clientes, documentos, Telegram e IA, el paquete compliance minimo es
un avance operativo, no un cierre legal.

## Riesgos Criticos Rojos

### R1 - Emision real SII/CAF validada manualmente, no automatizada

Evidencia: `LAUNCH-001` quedo `done` por smoke manual informado por el usuario
el 2026-06-21. El artifact versionado solo registra resumen no sensible:
`artifacts/runs/2026-06-21-launch-001-user-smoke.md`.

Impacto: baja el riesgo P0 de emision real, pero sigue faltando una corrida
reproducible con checklist versionado: version de extension, tipo DTE, job/lock,
folio reservado/liberado y resultado persistido, todo enmascarado.

Decision: permitir beta controlada con emision real y soporte presente. No
prometer operacion masiva abierta hasta tener observabilidad, runbook y smoke
repetible sin datos sensibles.

### R2 - CI/CD recien agregado, aun sin corrida remota obligatoria

Evidencia: esta rama agrega `.github/workflows/ci.yml` con `npm ci`, lint, test,
build y audit production. Localmente `npm run lint`, `npm run test`,
`npm run build` y `npm audit` estan verdes.

Impacto: el riesgo bajo, pero no desaparece hasta correr el workflow en GitHub y
exigir branch protection antes de merge/deploy.

Decision: abrir PR y exigir que CI quede verde antes de mergear a `dev`.

### R3 - Superficie de upload/IA parcialmente mitigada, aun sin cola durable

Evidencia:

- `src/app/api/subir-procesar/route.ts` quedo mitigado con validacion previa de
  base64, limite decoded 10 MiB, allowlist de tipo/MIME/extension y nombre
  sanitizado.
- `src/lib/security/rate-limit.ts` agrega rate limit in-memory y se aplica a
  upload/procesar, OCR comprobante, checkout y jobs de emision.
- `src/app/api/procesar-documento/route.ts` procesa PDF/OCR/IA dentro del
  request.

Impacto: archivos grandes, multiples OCR o PDFs pesados pueden agotar memoria,
tiempo de funcion o presupuesto de IA. En serverless, el background no durable
puede quedar cortado.

Decision: mantener rate limits como defensa inmediata, pero mover procesamiento
pesado a cola/job durable (`ENG-003`) y agregar observabilidad de costos/errores.

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
- Logging and Alerting: hay audit events y artifacts, pero no Sentry/log drain,
  alertas ni dashboard operativo.
- Mishandling Exceptional Conditions: muchos catch devuelven mensajes internos
  o `detalle`; util para beta, debe endurecerse antes de produccion abierta.

## Addendum Compliance Chile

Este bloque no reemplaza una revision de abogado. Es una lectura tecnica de
readiness de SaaS chileno usando `compliance-cl` y sus fuentes oficiales
referenciadas como insumo.

### Ley 21.719 - Datos personales

Score preliminar: **3.5/10**.

La app tiene buena base tecnica en aislamiento por empresa/cuenta, soporte
read-only, auditoria, locks y enmascaramiento del panel dev. Eso ayuda, pero no
equivale a cumplimiento de datos personales.

Brechas principales:

- Sin inventario/RAT de tratamientos: usuarios, empresas, clientes, cartolas,
  boletas, PDFs/XML, Telegram, IA, pagos, logs, soporte dev y artifacts.
- Sin matriz de bases legales por flujo: registro, carga de cartolas,
  procesamiento IA/OCR, emision, soporte, Telegram, billing, logs.
- Sin canal/proceso de derechos ARCO: acceso, rectificacion, supresion,
  oposicion, portabilidad, bloqueo y trazabilidad de respuesta.
- Sin politica de privacidad/terminos/DPA versionados para clientes B2B SaaS.
- Sin mapa formal de encargados/subencargados: Supabase, Vercel, Mistral,
  DeepSeek, Telegram, Mercado Pago, GitHub/Vercel logs y cualquier storage.
- Sin decision documentada sobre transferencias internacionales y clausulas
  contractuales/protecciones equivalentes.
- Sin politica de retencion/borrado para documentos tributarios, cartolas,
  XML/PDF, imagenes Telegram, prompts/respuestas IA y logs.
- Sin plan de brechas: deteccion, registro, clasificacion, notificacion,
  comunicacion a titulares cuando aplique y postmortem.
- Sin EIPD/analisis de alto riesgo para IA/OCR sobre informacion financiera y
  tributaria.

Prioridad: alta antes de beta pagada. La entrada sustantiva indicada por las
fuentes revisadas es el 1 de diciembre de 2026, pero el costo de arreglar datos
mal gobernados crece rapido una vez que hay clientes reales.

### Ley 21.595 / Ley 20.393 - Delitos economicos

Score preliminar: **2.5/10**.

La app ya tiene controles tecnicos que sirven como evidencia parcial:
auditoria de cuenta, soporte read-only, modo Genesys acotado, locks de emision,
validaciones de pago y logs de acciones sensibles. Pero no hay un sistema de
prevencion como tal.

Brechas principales:

- Sin responsable/oficial de prevencion definido.
- Sin matriz de riesgos por proceso: emision, soporte, pagos, proveedores IA,
  SII/local extension, datos tributarios, Telegram, acceso dev y billing.
- Sin codigo de etica/conducta aplicable al equipo operador.
- Sin canal de denuncia anonimo y proteccion contra represalias.
- Sin controles escritos de segregacion/autorizacion para pagos, soporte,
  acceso a datos, cambios productivos y manejo de incidentes.
- Sin capacitacion ni evidencia de aceptacion de politicas.
- Sin supervision externa periodica del modelo.

Prioridad: alta para operar como SaaS que toca impuestos, documentos y pagos.
No bloquea programar, pero si deberia bloquear venta abierta sin documentos y
controles minimos.

### Plan compliance incorporado

Quick wins (1-3 dias):

1. Crear inventario de tratamientos/RAT inicial con datos, finalidad, base legal,
   origen, destinatarios, retencion, seguridad y proveedor.
2. Escribir politica de privacidad, terminos SaaS y DPA cliente-proveedor
   versionados en `artifacts/docs` o carpeta legal separada.
3. Definir proceso ARCO manual asistido: correo/canal, SLA interno, responsable,
   checklist de busqueda/exportacion/borrado y log de respuesta.
4. Mapear proveedores y transferencias: Supabase, Vercel, IA, Telegram, Mercado
   Pago, GitHub/logs. Decidir que datos puede recibir cada uno.
5. Crear plan de brechas v0: severidad, registro, comunicacion interna,
   contencion, notificacion, evidencias y postmortem.
6. Crear MPD minimo: responsable, matriz de riesgos, codigo de conducta,
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
- OCR/parse/AI puede exceder tiempo/memoria serverless.
- No hay cola durable implementada para documentos, OCR ni IA; `ENG-003`
  especifica el contrato de cierre.
- No vi budgets de performance ni Lighthouse integrado.
- No hay load test ni simulacion de multiples cuentas/equipos.

### Testing

Estado:

- `npm run test`: 11 archivos, 83 tests, OK.
- Playwright audits productivos cubren dev/support/roles/locks.
- Nuevos tests cubren upload validation, preview Excel estructurado y headers.

Brechas:

- Sin coverage threshold.
- Falta test de API para cada mutacion service-role.
- Falta test de billing: webhook firmado, idempotencia, estados morosa/pausada,
  addon pendiente.
- Falta ampliar upload tests a ruta HTTP completa y PDFs maliciosos.
- Falta automatizar o repetir con checklist versionado el smoke extension/SII
  real ya informado OK por el usuario.

### DevOps

Fortalezas:

- GitHub Actions agregado con install, lint, test, build y audit production.
- Vercel build OK.
- `vercel.json` tiene cron de pagos.
- Supabase migrations y scripts locales existen.
- `.gitignore` ignora `.vercel/token` y `.supabase/token`; no aparecen
  versionados en `git ls-files`.

Debilidades:

- Falta correr CI en PR real y activar branch protection.
- Deploy manual/agent-driven.
- No hay observabilidad formal: Sentry, alertas, log drains, uptime checks.
- Runbook beta inicial creado; falta validarlo post-deploy con auditorias.

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
6. Hecho parcial: `/api/subir-procesar` valida base64, tamano, tipo, MIME,
   extension y nombre; falta aplicar patron al resto de OCR/documentos.
7. Hecho parcial: rate limit inicial en upload/procesar, OCR comprobante,
   checkout y jobs de emision.
8. Pendiente: centralizar guard de modo soporte read-only para mutaciones.
9. Pendiente: crear tests de contrato para endpoints mutantes principales: soporte mode,
   account guard, upload, checkout, emision jobs.
10. Hecho parcial: `LAUNCH-002` tiene runbook beta inicial; falta validar
   post-deploy.
11. Hecho parcial: `COMPLIANCE-001` tiene RAT/proveedores/ARCO/retencion/
    brechas/MPD minimo; falta revision legal y bajada a producto.

### Medio Plazo (1-3 semanas)

1. Convertir `LAUNCH-001` en smoke reproducible: checklist versionado,
   evidencia enmascarada, version de extension, job/lock/folio y resultado.
2. Implementar cola durable para OCR/IA/procesamiento:
   Supabase queue/table jobs, Inngest/Trigger.dev/Cloud Tasks o worker propio.
3. Observabilidad: Sentry, Vercel log drain, alertas por 5xx, errores IA,
   pagos fallidos, jobs atascados, locks expirados, webhook retries.
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

- Falta observabilidad y alertas sobre emision real, upload, IA, pagos y locks.
- Falta cola durable para OCR/IA/procesamiento.
- Falta runbook operacional validado con primera cuenta beta.
- Falta programa minimo de privacidad/compliance chileno para datos personales,
  proveedores, derechos ARCO, retencion, brechas y MPD.

## Score Final

**74/100 post-LAUNCH-001 y hardening inicial.**

Referencia interna: el score ajustado con compliance antes de esta rama era
62/100. Sube por lint/CI/audit/headers/upload/Excel/runbook/compliance minimo,
smoke manual SII/CAF y rate limits iniciales, pero sigue bloqueado para
lanzamiento abierto por observabilidad, cola durable y revision legal externa.

Lectura directa: producto bien pensado, base SaaS prometedora, pero aun no es
produccion madura. Esta en el punto correcto para ordenar fundamentos
operacionales y compliance antes de meter clientes reales con obligaciones
tributarias.
