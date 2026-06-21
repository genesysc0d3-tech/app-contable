---
kind: doc
status: active
created_at: 2026-06-21
tags: [compliance, chile, privacy, ley-21719, ley-21595, mpd, massdte]
---

# Compliance Minimo MassDTE

Este documento es preparacion tecnica/operativa. No reemplaza revision legal.

## RAT / Inventario Inicial

| Tratamiento | Datos | Finalidad | Base inicial | Retencion inicial |
|---|---|---|---|---|
| Registro y login | nombre, email, auth id, empresa activa | operar cuenta SaaS | contrato/interes legitimo | mientras la cuenta este activa |
| Empresa y clientes | RUT, razon social, direccion, comuna, giro | configurar emision y documentos | contrato/obligacion tributaria | vida de cuenta + plazo tributario aplicable |
| Cartolas/documentos | movimientos, montos, fechas, PDFs/XML/Excel/CSV | generar propuestas y respaldos | contrato | definir por plan y obligacion legal |
| IA/OCR | extractos de documentos, texto OCR, prompts/respuestas | clasificar y proponer documentos | contrato/interes legitimo | minimizar; no retener contenido crudo innecesario |
| Telegram | file_id, comprobantes, empresa elegida, resultado OCR | evitar digitacion de comprobantes | contrato/consentimiento canal | expirar pendientes; retener solo resultado necesario |
| Billing | plan, pagos, addons, estados, referencias proveedor | cobro y control de cupos | contrato/obligacion legal | plazo contable/tributario |
| Soporte Genesys | modo soporte, eventos auditados, cuenta/empresa observada | soporte y seguridad | interes legitimo/contrato | minimo necesario para auditoria |
| Emision local | jobs, locks, folio reservado, estado, resultado | evitar doble emision y persistir resultado | contrato/obligacion tributaria | plazo tributario aplicable |

## Proveedores Y Transferencias

| Proveedor | Rol esperado | Datos posibles | Decision |
|---|---|---|---|
| Supabase | base de datos, auth, storage | datos app, documentos, auth | DPA/subencargado requerido |
| Vercel | hosting/serverless/logs | requests, logs, metadata | DPA/subencargado requerido |
| Mistral | OCR/IA | texto/imagenes necesarias | minimizar payload y revisar transferencia |
| DeepSeek | IA opcional | prompts configurados | desactivar o minimizar si no es necesario |
| Telegram | canal comprobantes | file_id, mensajes, metadata | informar uso y expiracion |
| Mercado Pago | pagos | datos de checkout/pago | informar proveedor de pago |
| GitHub/logs | desarrollo/CI | metadata, errores, artifacts | no subir secretos ni documentos crudos |

## Proceso ARCO Manual

Canal inicial: correo/canal soporte definido antes de beta pagada.

Pasos:

1. Registrar solicitud con fecha, titular, cuenta, empresa y derecho pedido.
2. Verificar identidad del solicitante sin pedir mas datos de los necesarios.
3. Clasificar: acceso, rectificacion, supresion, oposicion, portabilidad o
   bloqueo.
4. Buscar datos por usuario, cuenta y empresa.
5. Separar datos eliminables de datos que deban conservarse por obligacion
   tributaria, seguridad o auditoria.
6. Responder con resultado y evidencias internas, sin exponer datos de terceros.
7. Registrar cierre y plazo.

SLA operativo inicial: responder internamente en 5 dias habiles y cerrar dentro
del plazo legal aplicable con revision legal si hay duda.

## Retencion Y Borrado

Politica inicial:

- No retener uploads temporales, previews ni errores con contenido completo mas
  alla de lo necesario para procesar y depurar.
- No guardar prompts/respuestas IA completos si basta con resultado estructurado.
- Mantener documentos tributarios solo cuando sean necesarios para historial,
  respaldo legal o servicio contratado.
- Borrar pendientes Telegram expirados que no fueron confirmados.
- Mantener audit events sin metadata cruda sensible.
- Definir job de limpieza antes de abrir beta pagada.

## Plan De Brechas

1. Contener: revocar token, pausar endpoint, bloquear cuenta o cortar proveedor.
2. Clasificar: datos afectados, cantidad, sensibilidad, proveedor, causa.
3. Registrar: fecha, responsable, sistemas, acciones y evidencia.
4. Notificar internamente a responsable tecnico/producto.
5. Evaluar notificacion externa y titulares con asesor legal.
6. Corregir causa raiz y agregar test/control.
7. Hacer postmortem sin secretos ni datos personales crudos.

## MPD Minimo Ley 21.595 / 20.393

Responsable inicial: fundador/operador principal hasta designacion formal.

Riesgos principales:

- Uso indebido de soporte dev o service role.
- Emision/folio/resultado tributario incorrecto o manipulado.
- Pagos/addons duplicados o mal conciliados.
- Exposicion de documentos, cartolas, RUTs o claves.
- Proveedor IA recibiendo mas datos de los necesarios.
- Deploy sin revision que rompa auth, billing o soporte read-only.

Controles minimos:

- Soporte Genesys siempre read-only y auditado.
- CI obligatorio antes de merge.
- No guardar secretos ni documentos crudos en artifacts.
- Cambios de pagos/emision con tests y revision.
- Canal de denuncia/contacto interno para reportar abuso o incidente.
- Checklist de capacitacion: privacidad, soporte, pagos, SII/extension y
  manejo de incidentes.

Pendiente antes de lanzamiento abierto:

- Revision legal externa.
- Responsable/oficial formal.
- Codigo de conducta firmado.
- Canal anonimo formal.
- Supervision externa periodica proporcional al tamano de la empresa.
