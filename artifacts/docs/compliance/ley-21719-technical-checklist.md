---
kind: doc
status: active
created_at: 2026-06-24
tags: [compliance, ley-21719, privacy, checklist]
---

# Checklist técnico Ley 21.719 (por flujo)

Convierte el cumplimiento en evidencia por flujo, no solo textos públicos.
Estado posible por flujo: `pendiente` / `beta` / `revisado` / `externo`.

## Plantilla por flujo

Para cada flujo registrar: **finalidad · datos tratados · base legal ·
proveedor/subencargado · transferencia internacional · retención · derechos ARCO
· borrado/exportación · logs/evidencia · riesgos · responsable · estado**.

## Flujos a cubrir (vista rápida)

| Flujo | Datos clave | Proveedor | Transf. int'l | Estado |
|---|---|---|---|---|
| Registro/cuenta | email, nombre | Supabase | sí | beta |
| Uploads/cartolas | movimientos, montos | Supabase Storage | sí | beta |
| OCR/IA | contenido de documentos | Mistral / DeepSeek | sí | beta |
| Telegram | imágenes de comprobantes | Telegram | sí | beta |
| Pagos | datos de pago | Mercado Pago | sí | beta |
| Emisión | RUT, montos, folios | SII / SimpleAPI (cred. del usuario) | n/a | beta |
| Soporte dev | lectura de cuenta | interno (read-only) | no | beta |
| Extensión SII | sesión SII local | local del usuario | no | beta |
| Observabilidad | metadata sanitizada | Supabase | sí | beta |

Empezar a llenar la plantilla completa por **OCR/IA** y **emisión** (mayor
riesgo). El egress de contenido a Mistral/DeepSeek es **transferencia
internacional** — anotarla explícitamente y aplicar la regla de minimizar (no
mandar datos crudos innecesarios).

## Para un 9/10 real (necesita humanos/plata — diferido hasta revenue)

- Revisión legal externa.
- DPAs firmados/aceptados con cada proveedor.
- Oficial de privacidad formal.
- Canal formal ARCO / incidentes.
- EIPD para OCR/IA financiera-tributaria.
- MPD proporcional (Ley 21.595 / 20.393).

## Postura producto/legal

MassDTE es herramienta de automatización asistida: el usuario autorizado revisa,
aprueba y ordena la emisión; la app responde por seguridad, autorización,
trazabilidad y corrección asistida. No se autodeclara "10/10" ni "certificado".
