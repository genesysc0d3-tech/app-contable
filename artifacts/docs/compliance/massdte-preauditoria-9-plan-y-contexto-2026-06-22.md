---
kind: doc
status: active
created_at: 2026-06-22
tags: [compliance, chile, preaudit, security, performance, extension, massdte]
---

# MassDTE Preauditoria 9.3 - Plan, Contexto Y Decisiones

Documento de continuidad para retomar contexto con otro agente o despues de un
reinicio. No contiene secretos, credenciales, documentos tributarios, XML, PDFs,
imagenes, base64 ni datos reales de clientes. No reemplaza revision legal
externa.

## Resumen Ejecutivo

MassDTE parte desde un estado tecnico/compliance estimado de 82/100 para beta
controlada, con compliance Chile 8/10 ya versionado en el paquete del
2026-06-21. La meta acordada es subir a un estado preauditoria de 9.2-9.4/10
en seguridad, compliance, extension y performance antes de pagar auditoria
externa.

El 10/10 no debe autodeclararse. El objetivo correcto es dejar evidencia tecnica
y operativa suficiente para que un abogado/auditor pueda validar, ajustar o
certificar. La realidad nacional probable de muchas pymes/SaaS chilenos esta
por debajo de este nivel, pero MassDTE procesa cartolas, RUT, boletas, SII,
PDF/XML, IA y pagos, por lo que el promedio nacional no sirve como meta.

Puntaje esperado al cerrar este plan:

```text
Compliance Chile tecnico:        9.3-9.4/10
Seguridad app web:               9.1-9.3/10
Seguridad extension:             9.1-9.3/10
Performance/escalabilidad:       9.1/10
Testing/readiness:               9.1/10
Score general proyecto:          92-95/100
```

## Fuentes Y Marco De Referencia

Fuentes oficiales consideradas:

- Ley 21.719, proteccion y tratamiento de datos personales:
  https://www.bcn.cl/leychile/navegar?idNorma=1209272
- Ley 21.663, marco de ciberseguridad:
  https://www.bcn.cl/leychile/navegar?idNorma=1202434
- Ley 21.595, delitos economicos:
  https://www.bcn.cl/leychile/navegar?idNorma=1195119
- Ley 20.393, responsabilidad penal de personas juridicas:
  https://www.bcn.cl/leychile/navegar?idNorma=1008668
- OWASP HTML5 Security Cheat Sheet y Cryptographic Storage Cheat Sheet:
  no usar `localStorage` para datos sensibles; minimizar almacenamiento y
  disenar con threat model, no solo "cifrar todo".
- Chrome Extension security guidance: permisos minimos, host allowlist, content
  scripts acotados y transparencia de permisos.

Insumos internos relevantes:

- `artifacts/runs/2026-06-21-cto-project-audit.md`
- `artifacts/docs/compliance/massdte-compliance-8-readiness-2026-06-21.md`
- `artifacts/docs/compliance/massdte-rat-dpa-brechas-retencion-mpd-2026-06-21.md`
- `extensions/sii-portal-rpa/ARQUITECTURA.md`
- `extensions/sii-portal-rpa/manifest.json`
- `src/app/(app)/escritorio/v5/page.tsx`
- `src/app/(app)/escritorio/v5/EmitirDirectaView.tsx`
- `src/app/api/sii-local/page-map/route.ts`
- `src/app/api/sii-local/result/route.ts`

## Postura De Producto Y Responsabilidad

Decision central:

> MassDTE es una herramienta de automatizacion asistida. El usuario autorizado
> revisa, aprueba y ordena la emision. La extension ejecuta acciones tecnicas
> equivalentes a teclado/mouse sobre una sesion SII/proveedor configurada por
> el propio usuario.

Esto ayuda legalmente, pero solo si el sistema lo prueba con controles reales.
No basta una frase en terminos.

Responsabilidad del usuario/contribuyente:

- Estar autorizado para operar la empresa/RUT.
- Revisar datos antes de emitir.
- Ordenar la emision.
- Responder por la veracidad tributaria/comercial del documento.
- Custodiar clave SII, certificado, passphrase y equipo.
- Cumplir obligaciones ante SII.

Responsabilidad de MassDTE:

- No emitir sin accion/autorizacion explicita.
- Mostrar que la accion ocurre en SII/proveedor.
- No guardar claves SII en servidores de MassDTE.
- Proteger bovedas locales, logs, PDFs/XML y datos personales.
- Evitar doble emision por bugs razonablemente previsibles.
- Mantener auditoria de jobs, folios, locks, resultados y soporte.
- Permitir cancelar, borrar boveda local y revocar uso.
- Dar soporte contable asistido cuando haya incidentes.

## Soporte Contable Asistido

El equipo cuenta con contador interno. Esto no debe presentarse como "la app
corrige por el usuario", sino como control operativo:

1. El usuario o la app detectan un problema.
2. Soporte clasifica severidad y, si hace falta, pausa o bloquea acciones de
   riesgo.
3. Se contacta al cliente.
4. El contador interno revisa el caso y valida la via correcta.
5. El cliente autoriza cualquier correccion tributaria real.
6. MassDTE guia o asiste la rectificacion/reversion.
7. Se cierra con evidencia sanitizada: job, folio, empresa, causa, accion,
   fecha y responsable, sin datos sensibles innecesarios.

Categorias minimas del runbook:

- Folio emitido en SII pero no registrado.
- PDF pendiente.
- Monto incorrecto.
- Empresa equivocada.
- Duplicado.
- Emision incompleta.
- Proveedor caido o inconsistente.

## Hallazgos Conciliados De Tres Revisiones

Se pidieron tres miradas independientes en modo solo analisis:

1. Legal/compliance chileno.
2. Seguridad/extension/secretos/OWASP.
3. Arquitectura/performance Next/Supabase.

Coincidencias principales:

- La base 8/10 existe y es defendible para beta controlada.
- Para pasar sobre 9 falta aceptar/versionar juridicamente la emision real.
- La extension es el punto mas sensible: clave SII, PFX, CAF, SimpleAPI,
  page-map, permisos y documentacion.
- El README de la extension esta desactualizado: dice que no lee claves SII,
  pero el codigo actual si permite boveda local cifrada.
- El PIN SII 4-8 digitos es bajo para secreto critico si alguien copia el
  perfil Chrome y ataca offline.
- SimpleAPI vault necesita lockout por intentos fallidos.
- `page-map` y `sii_local_resultados` pueden retener mas evidencia cruda de la
  necesaria.
- `manifest.json` de produccion no debe incluir `localhost`/`127.0.0.1`.
- `/massdte` carga demasiados datos no visibles en el primer render.
- Cachear no basta: hay que dejar de pedir RCV 24 meses/5000 filas,
  search/history y pendientes completos al inicio.

## Plan Conciliado 9.3+

### 1. Autorizacion Real De Emision

Crear una aceptacion versionada antes de cualquier emision real:

- usuario;
- cuenta/empresa;
- proveedor (`sii_local`, `simpleapi`, etc.);
- version legal/terminos;
- timestamp;
- job id y folio si aplica;
- sin secretos, sin XML, sin PDF, sin payload tributario crudo.

Regla tecnica:

- `allow_final_emit: true` solo puede viajar a la extension si existe
  autorizacion vigente para usuario + empresa + proveedor + version.
- Si cambia empresa, proveedor, credenciales o version legal, se reconfirma.

Texto base para UI:

> Confirmo que estoy autorizado para emitir por esta empresa, que revise los
> datos del documento y que MassDTE ejecutara esta accion en mi sesion
> SII/proveedor configurada. Entiendo que la responsabilidad tributaria del
> documento corresponde al contribuyente/usuario autorizado.

### 2. Extension SII/SimpleAPI Sobre 9

Cambios minimos:

- Migrar boveda SII de PIN 4-8 a passphrase fuerte en produccion, minimo 12
  caracteres.
- Mantener AES-GCM/PBKDF2 como base suficiente si no se quiere complicar.
  Argon2id queda como mejora futura solo si no rompe compatibilidad de Chrome.
- Agregar lockout persistente a SimpleAPI vault: 5 fallos, bloqueo 5-15 min,
  sin guardar passphrase.
- Separar manifest dev/prod:
  - dev puede incluir localhost;
  - prod no incluye `localhost` ni `127.0.0.1`;
  - prod mantiene solo dominios estrictamente necesarios.
- Actualizar README/arquitectura:
  - la extension si puede guardar clave SII, PFX y CAF cifrados localmente;
  - no se envian claves SII a servidores de MassDTE;
  - la automatizacion es visible y autorizada.
- Agregar UI clara:
  - estado cifrado;
  - ultima actualizacion;
  - borrar boveda local;
  - guia de revocacion;
  - que hacer si se pierde el equipo.

### 3. Page-Map, Resultados Y Storage Local

Reglas:

- `page-map` apagado en produccion por defecto.
- Si se activa por operador:
  - solo con flag explicito;
  - solo para soporte/diagnostico;
  - sanitizado antes de salir de la extension;
  - sin `body_excerpt`;
  - sin RUT/email;
  - sin montos largos;
  - sin URLs completas;
  - sin formularios crudos;
  - TTL corto.
- `sii_local_resultados` no debe retener:
  - PDF base64;
  - XML completo;
  - HTML;
  - page excerpts crudos;
  - cookies/tokens;
  - payloads innecesarios.
- Los drafts de emision no deben persistir en `localStorage` con RUT, direccion,
  glosa o monto. Usar memoria o `sessionStorage` con TTL corto.
- Agregar boton global "Borrar datos locales de este navegador".

### 4. Performance Y Cache Seguro

Cuello de botella actual:

- `/massdte` carga muchas consultas iniciales en `page.tsx`.
- Carga al inicio datos que pertenecen a vistas aun no abiertas:
  - RCV 24 meses/5000 filas;
  - search/history;
  - propuestas completas;
  - pendientes completos;
  - listas largas.

Plan:

- Primer render de `/massdte` carga solo:
  - snapshot resumen;
  - top 20 documentos/boletas visibles;
  - contadores;
  - calendario mensual agregado;
  - locks frescos.
- Crear `DashboardSafeSnapshot` server-side por empresa + periodo + vista.
- RCV, busqueda e historial se cargan bajo demanda.
- `getPendientesEmision` debe entregar resumen inicial + primera pagina; el
  detalle completo solo cuando se abre Emitir.
- El worker OCR/IA durable actual se mantiene; al completar jobs debe invalidar
  snapshot.

Allowlist de cache:

- conteos;
- totales;
- estados;
- fechas;
- uso mensual;
- plan/flags;
- cantidad pendiente/lista/bloqueada.

Prohibido cachear:

- PDFs;
- XML;
- cartolas;
- OCR crudo;
- prompts/respuestas IA completas;
- `progreso_ia` completo;
- `storage_path`;
- RUT/email completos;
- receptor completo;
- CAF;
- certificados;
- tokens;
- pagos raw.

Cache local:

- preferir memoria Zustand;
- scoped por `userId/cuentaId/empresaId/periodKey`;
- no mezclar empresas/cuentas;
- purga en logout, cambio de empresa, cambio de cuenta, cambio de rol y modo
  soporte Genesys.

### 5. Compliance V2

Actualizar o crear paquete v2 con:

- RAT por flujo:
  - cuenta SaaS;
  - empresas/clientes;
  - upload/cartolas;
  - OCR/IA;
  - Telegram;
  - pagos;
  - emision SII/SimpleAPI;
  - extension/boveda local;
  - soporte dev;
  - observabilidad;
  - cache/dashboard snapshot.
- Matriz de base legal por flujo.
- DPA/proveedores y transferencias internacionales:
  Supabase, Vercel, Mistral, DeepSeek, Telegram, Mercado Pago, GitHub y
  proveedores futuros.
- Retencion:
  documentos tributarios, PDFs/XML, jobs, `ops_events`, resultados SII local,
  page-map, soporte y cache.
- ARCO:
  acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo, con
  excepciones por obligacion tributaria/auditoria.
- Brechas:
  contencion, clasificacion, contacto, evaluacion legal, correccion y cierre.
- EIPD para IA/OCR/documentos financieros.
- MPD proporcional Ley 21.595/20.393:
  responsable, matriz de riesgos, controles, canal, capacitacion minima y
  evidencias.
- Ley 21.663:
  documentar que MassDTE no es OIV/servicio esencial salvo designacion, pero
  adopta plan proporcional de incidentes.

## Interfaces Y Artifacts Esperados

Implementacion futura deberia agregar:

- Tabla `emission_authorizations`.
- Tabla/cache `dashboard_summary_cache`.
- Tipo interno `DashboardSafeSnapshot`.
- Endpoint `GET /api/dashboard/snapshot`.
- Control UI para borrar datos locales/cache/boveda.
- Documento `artifacts/docs/compliance/massdte-9-readiness-YYYY-MM-DD.md`.
- Runbook de incidentes tributarios y soporte contable asistido.
- Entradas en `docs/MEMORIA.md` y `loops/LOG.md`.

## Plan De Tests Y Auditoria

Unit tests:

- SII passphrase rechaza PIN debil.
- SimpleAPI bloquea intentos fallidos.
- Autorizacion inexistente/vencida impide emision real.
- Sanitizer elimina RUT/email/base64/XML/PDF/body excerpts.
- Snapshot falla si incluye campos sensibles.
- Cache key no mezcla cuenta/empresa/usuario.

Integration tests:

- No se crea job real sin aceptacion vigente.
- Modo soporte Genesys sigue read-only.
- SimpleAPI proxy exige job, usuario, empresa y folio reservado.
- Snapshot no mezcla cuentas/empresas.
- Mutaciones invalidan snapshot.
- `sii_local_resultados` no retiene payloads crudos.

Auditoria automatizada:

- `npm run lint`
- `npm run test`
- `rtk tsc --noEmit`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npm run audit:app`
- `npm run audit:roles`
- `npm run audit:locks`
- Lighthouse autenticado en `/massdte` y `/dev/cuentas`.
- Storage scan de `localStorage`, `sessionStorage` y `chrome.storage.local`.

Acceptance performance:

```text
Queries bloqueantes iniciales /massdte:  <= 5 grupos logicos
Filas iniciales transferidas:            <= 150-250
Sin RCV 5000 filas en primer render:      obligatorio
Sin search/history en primer render:      obligatorio
Reduccion payload inicial:                40-60%
Mejora TTFB/FCP autenticado:              30% vs baseline
Lighthouse auth /massdte performance:     >= 85 movil, >= 90 desktop
INP objetivo:                             < 200 ms
Cero secretos/datos crudos en storage:    obligatorio
```

## Que No Hacer

- No meter "todo cifrado en localStorage" como solucion.
- No guardar PDFs/XML/OCR/prompts completos en cache local.
- No mandar claves SII al backend.
- No abrir `<all_urls>` en la extension.
- No esconder la automatizacion; debe ser visible y autorizada.
- No depender solo de texto legal; el codigo debe probar autorizacion,
  trazabilidad y revocacion.
- No migrar a Redis/PlanetScale/Cloudflare Workers para esta fase si el
  problema se resuelve con snapshot/lazy loading.
- No tocar extension/SII real sin pruebas controladas y evidencia sanitizada.

## Riesgos Que Quedan Para Auditoria Externa

- Suficiencia legal del texto "herramienta, no emisor" bajo normativa SII,
  consumidor y contrato de adhesion.
- Bases legales por flujo: contrato, consentimiento, interes legitimo y
  obligacion tributaria.
- Transferencias internacionales con proveedores.
- Retencion tributaria exacta de XML/PDF/cartolas/logs.
- Restricciones propias del portal SII o de uso de clave tributaria.
- Alcance real de Ley 21.663 si MassDTE crece o atiende clientes regulados.
- Calidad formal del MPD Ley 20.393/21.595.
- Necesidad de certificacion o revision externa de textos legales/DPA.

## Prioridad De Implementacion Recomendada

1. Autorizacion versionada de emision y bloqueo de `allow_final_emit`.
2. Endurecimiento extension: passphrase SII, SimpleAPI lockout, manifest prod.
3. Page-map/resultados/drafts: sanitizar, apagar en prod, mover storage local.
4. DashboardSafeSnapshot y lazy loading de RCV/Search/pendientes.
5. Compliance v2, runbook tributario y textos publicos.
6. Auditorias automatizadas y reporte CTO actualizado.

## Timeline

- 2026-06-22: Plan conciliado con tres revisiones: legal/compliance,
  seguridad/extension y performance/arquitectura. Se acuerda apuntar a
  9.2-9.4/10 preauditoria y no autodeclarar 10/10 sin revision externa.
- 2026-06-23: Primera aplicacion del plan en `feature/preaudit-9-hardening`:
  autorizacion versionada de emision, gate en jobs, passphrase SII, lockout
  SimpleAPI, manifest prod sin localhost, page-map prod off/sanitizado,
  logs SII saneados, drafts en `sessionStorage` con TTL y RCV mensual bajo
  demanda para eliminar el primer render de 5000 boletas.
