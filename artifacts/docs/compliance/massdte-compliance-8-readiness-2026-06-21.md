---
kind: doc
status: active
created_at: 2026-06-21
tags: [compliance, chile, ley-21719, ley-21595, privacy, dpa, rat, breach]
---

# MassDTE Compliance Readiness 8/10

Documento operativo. No reemplaza revision legal externa.

## Puntaje Objetivo

| Area | Antes | Ahora esperado |
|---|---:|---:|
| Ley 21.719 datos personales | 5.5/10 | 8.0/10 |
| Ley 21.595 / 20.393 MPD inicial | 4.5/10 | 7.8/10 |
| Contratos, DPA, proveedores | 4.8/10 | 8.0/10 |
| Retencion, brechas, ARCO | 5.5/10 | 8.0/10 |
| Trazabilidad y controles tecnicos | 7.0/10 | 8.3/10 |

Score compliance Chile esperado despues de este paquete: 8.0/10 para beta
controlada. Lanzamiento abierto sigue sujeto a revision legal externa.

## Controles Implementados O Versionados

- Inventario/RAT inicial por tratamiento, finalidad, datos, base operativa,
  proveedor y retencion.
- Politica publica de privacidad en `/legal/privacidad`.
- Terminos publicos de uso en `/legal/terminos`.
- Pagina publica de seguridad y contacto en `/legal/seguridad`.
- DPA/subencargados inicial para Supabase, Vercel, Mistral, DeepSeek,
  Telegram, Mercado Pago y GitHub.
- Procedimiento de respuesta a brechas con contencion, clasificacion,
  evaluacion legal, comunicacion y postmortem.
- Politica de retencion y borrado por tipo de dato.
- MPD inicial Ley 21.595/20.393: matriz de riesgos, controles, responsable,
  canal y evidencias.
- Observabilidad `ops_events` sin payloads crudos.
- Cola durable para OCR/IA/documentos con metadata operacional y sin guardar
  contenido crudo en jobs.

## Criterios No Negociables

- No guardar claves, tokens, cookies, certificados, XML, PDFs, base64, prompts
  completos, respuestas IA completas ni documentos crudos en logs, artifacts,
  `ops_events` ni `document_processing_jobs`.
- Soporte Genesys sigue read-only y auditado.
- Los documentos tributarios y respaldos se tratan como datos de alto impacto
  operativo aunque no todos sean sensibles por definicion legal.
- Todo proveedor que procese datos reales debe quedar informado en privacidad,
  inventario y matriz de subencargados.
- Las solicitudes ARCO se registran aunque parte de los datos no pueda borrarse
  por obligacion tributaria, seguridad o auditoria.

## Pendiente Para 9/10

- Revision legal externa de textos publicos y DPA.
- Confirmar DPAs firmados/aceptados en Supabase, Vercel, proveedores IA,
  Telegram y Mercado Pago.
- Nombramiento formal de responsable/oficial de privacidad.
- Canal formal de denuncias/incidentes con evidencia de seguimiento.
- Automatizar limpieza por retencion cuando el volumen real lo justifique.
