---
id: COMPLIANCE-001
title: Readiness Ley 21.719 y Ley 21.595 para MassDTE
status: in_progress
priority: critical
created_at: 2026-06-21
owner: product-engineering
tags: [compliance, chile, privacy, ley-21719, ley-21595, launch-readiness]
---

# COMPLIANCE-001 - Ley 21.719 y Ley 21.595

## Objetivo

Convertir compliance chileno en un bloque real de launch readiness para MassDTE,
antes de beta pagada o lanzamiento abierto.

Este trabajo no reemplaza revision legal externa. Es la preparacion tecnica y
operativa para que un abogado pueda revisar un sistema ordenado, no una caja
negra.

## Fuentes revisadas

- Repositorio `compliance-cl`: https://github.com/Lelemon-studio/compliance-cl
- Fuentes versionadas: https://raw.githubusercontent.com/Lelemon-studio/compliance-cl/main/sources/FUENTES.md
- Ley 21.719, Diario Oficial: https://www.diariooficial.interior.gob.cl/publicaciones/2024/12/13/44023/01/2583630.pdf
- Ley 21.719, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1209272
- Ley 21.595, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1195119
- Ley 20.393, LeyChile XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1008668

## Hallazgo

MassDTE procesa datos personales, tributarios, financieros y comerciales:
usuarios, clientes, RUT, emails, cartolas, PDFs/XML, boletas, comprobantes
Telegram, datos de pago, logs de soporte, prompts/respuestas IA y eventos de
auditoria.

La base tecnica tiene controles utiles: RLS, cuenta pagadora, soporte read-only,
auditoria de cuenta, enmascaramiento dev, locks de emision y separacion de
empresas. Pero no existe un programa formal de privacidad, derechos, retencion,
proveedores, brechas ni modelo de prevencion de delitos.

## Alcance Ley 21.719

Entregables minimos:

1. Inventario/RAT de tratamientos.
2. Mapa de datos por flujo: registro, cartolas, OCR/IA, emision, Telegram,
   billing, soporte dev, logs y artifacts.
3. Matriz de base legal/consentimiento por flujo.
4. Politica de privacidad y terminos SaaS versionados.
5. DPA/encargo de tratamiento para clientes B2B.
6. Registro de proveedores/subencargados: Supabase, Vercel, IA, Telegram,
   Mercado Pago, GitHub/logs y storage.
7. Analisis de transferencias internacionales.
8. Proceso de derechos ARCO: acceso, rectificacion, supresion, oposicion,
   portabilidad y bloqueo.
9. Politica de retencion/borrado para documentos, XML/PDF, cartolas, imagenes,
   prompts/respuestas IA, logs y artifacts.
10. Plan de brechas: registro, clasificacion, contencion, notificacion,
    comunicacion a titulares cuando aplique y postmortem.
11. EIPD/analisis de alto riesgo para IA/OCR sobre informacion financiera y
    tributaria.

## Alcance Ley 21.595 / Ley 20.393

Entregables minimos:

1. Responsable/oficial de prevencion definido.
2. Matriz de riesgos por proceso: emision, soporte, pagos, SII/extension, IA,
   Telegram, datos tributarios, acceso dev y deploys.
3. Codigo de conducta/etica para operadores y desarrolladores.
4. Canal de denuncias anonimo y regla de no represalias.
5. Controles internos escritos para pagos, soporte, datos sensibles, cambios en
   produccion, incidentes y proveedores.
6. Evidencia de capacitacion/aceptacion de politicas.
7. Plan de supervision/revision externa periodica.

## Criterios de cierre

- Existe carpeta/documentacion versionada para privacy/compliance o se define
  explicitamente que vive fuera del repo.
- El reporte CTO `artifacts/runs/2026-06-21-cto-project-audit.md` queda
  actualizado con estado final de esta tarea.
- Hay matriz de datos/proveedores y lista de decisiones pendientes para abogado.
- Hay proceso operativo manual para ARCO y brechas antes de beta pagada.
- Hay MPD minimo proporcional antes de lanzamiento abierto.
- Si se usa `compliance-cl`, se ejecuta en rama separada y sus documentos se
  revisan antes de adoptar contenido.

## No alcance inicial

- No instalar automaticamente el repo externo.
- No copiar documentos legales sin revision.
- No ejecutar cambios destructivos de borrado/retencion en produccion sin plan.
- No tratar esto como consejo legal final.

## Timeline

- 2026-06-21 - Documento operativo minimo creado en
  `artifacts/docs/compliance/massdte-compliance-minimo-2026-06-21.md` con RAT
  inicial, proveedores, ARCO manual, retencion, brechas y MPD minimo. Queda
  pendiente revision legal externa y bajada a flujos/producto antes de
  lanzamiento abierto.
