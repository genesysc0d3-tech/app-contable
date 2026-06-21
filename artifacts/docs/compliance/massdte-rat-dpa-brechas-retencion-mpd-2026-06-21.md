---
kind: doc
status: active
created_at: 2026-06-21
tags: [compliance, rat, dpa, breach, retention, mpd, chile]
---

# RAT, DPA, Brechas, Retencion Y MPD

Documento operativo inicial. Requiere revision legal externa antes de
lanzamiento abierto.

## RAT Inicial

| Tratamiento | Datos | Finalidad | Acceso | Retencion |
|---|---|---|---|---|
| Cuenta SaaS | nombre, email, auth id, rol, empresa activa | operar cuenta y soporte | usuario, soporte read-only | vida cuenta + auditoria |
| Empresas/clientes | RUT, razon social, giro, direccion, comuna | configurar emision y reportes | miembros cuenta | plazo contractual/tributario |
| Uploads/cartolas | archivos, movimientos, montos, fechas, glosas | clasificar y proponer documentos | miembros autorizados | plan + obligacion tributaria |
| OCR/IA | texto extraido, resultado estructurado | extraer movimientos y propuestas | backend/proveedor IA | minimizar, no retener crudo innecesario |
| Telegram | file id, empresa seleccionada, comprobante confirmado | ingresar comprobantes | usuario, backend | pendientes expiran; resultado segun plan |
| Pagos | plan, addons, estado, proveedor ref | cobro y cupos | titular/admin, backend | plazo contable/legal |
| Emision | jobs, locks, folios, resultado, PDF/XML si aplica | evitar doble emision y guardar respaldo | roles emision | plazo tributario |
| Soporte dev | cuenta/empresa observada, eventos | soporte y seguridad | Genesys operador | minimo necesario |
| Observabilidad | severidad, fuente, ids, resumen, metadata sanitizada | salud operacional | operador dev | 90-180 dias inicial |

## Subencargados / DPA

| Proveedor | Rol | Datos posibles | Control minimo |
|---|---|---|---|
| Supabase | hosting BD, auth, storage | datos app, documentos, auth | DPA, RLS, service role restringida |
| Vercel | hosting/serverless/logs | requests, metadata, errores | DPA, logs sin payloads |
| Mistral | OCR/IA | imagen/texto necesario | minimizacion, no enviar secretos |
| DeepSeek | IA opcional | prompts configurados | desactivar si no se usa, minimizacion |
| Telegram | canal usuario | file_id, mensajes, metadata | informar canal y expiracion |
| Mercado Pago | pagos | checkout/pago | informar proveedor y conciliacion |
| GitHub | CI/repos | codigo, artifacts | no subir secretos ni documentos reales |

Checklist DPA:

1. Identificar rol contractual del proveedor.
2. Confirmar region/transferencia internacional si aplica.
3. Confirmar medidas tecnicas y canal de incidentes.
4. Registrar en inventario.
5. Informar en politica publica.

## Respuesta A Brechas

1. Contener: revocar token, pausar endpoint, cortar proveedor o bloquear cuenta.
2. Preservar evidencia segura: hora, ruta, deployment, cuenta afectada, ids.
3. Clasificar: datos afectados, cantidad, sensibilidad, origen y proveedor.
4. Evaluar riesgo para titulares y necesidad de notificacion con asesor legal.
5. Comunicar internamente a responsable producto/tecnico.
6. Corregir causa raiz con test/control.
7. Registrar cierre y postmortem sin datos personales crudos.

SLA interno beta: triage en 24h, contencion urgente el mismo dia, evaluacion
legal antes de cualquier notificacion externa.

## Retencion Y Borrado

| Dato | Retencion inicial | Borrado |
|---|---|---|
| `ops_events` | 90-180 dias | job futuro por fecha |
| `document_processing_jobs` | 90 dias tras terminal | borrar metadata, conservar doc si aplica |
| pendientes Telegram | hasta expiracion | borrar pendiente no confirmado |
| uploads/documentos | segun plan y obligacion tributaria | solicitud cuenta + excepciones legales |
| pagos/suscripciones | plazo contable/legal | no borrar si debe conservarse |
| soporte/auditoria | minimo necesario | anonimizar si procede |

## MPD Inicial Ley 21.595 / 20.393

Riesgos:

- Acceso indebido con service role o modo soporte.
- Manipulacion de folios, pagos, estados o documentos.
- Uso excesivo de datos en IA/OCR.
- Omision de incidentes o solicitudes de titulares.
- Deploy sin controles en rutas de pago/emision/auth.

Controles:

- CI, tests y build antes de merge.
- Soporte read-only y auditado.
- `ops_events` y cola durable con metadata sanitizada.
- Separacion de roles Start/Pro/Business y permisos de emision.
- Rate limits en rutas sensibles.
- DPA/inventario y politica publica versionados.

Evidencias:

- PRs/checks de GitHub.
- Migraciones Supabase.
- Reportes de auditoria en `artifacts/runs`.
- Logs `ops_events` sin contenido crudo.
- `loops/LOG.md` y `docs/MEMORIA.md`.
