# Anexo de Transferencia Internacional de Datos — AlphaCode SpA

> Ampara el envío de datos personales fuera de Chile. Se firma/incorpora con cada proveedor extranjero. Mecanismo: **Cláusulas Contractuales Modelo** aprobadas por el Ministerio de Economía (Resolución RAEX202503748, Diario Oficial 19-12-2025), en `sources/clausulas-modelo-transferencia-economia.pdf`.

## 1. Exportador
AlphaCode SpA, RUT 78.448.088-7, Av. Apoquindo 6410 Of. 605, Las Condes, Santiago (Chile). Contacto de datos personales: privacidad@massdte.cl.

## 2. Importadores (proveedores con procesamiento fuera de Chile)

| Proveedor | País/región | Datos | Finalidad | Mecanismo |
|---|---|---|---|---|
| Fireworks.ai, Inc. (desde 2026-09-27) | EE.UU.; sub-encargados en EE.UU./Japón/Reino Unido/Alemania (DPA Schedule 4) | texto seudonimizado de cartolas y comprobantes; imágenes solo si la mini (OCR local) está caída | extracción, clasificación y OCR de respaldo (**retención cero, sin entrenamiento**) | DPA incorporado a los términos (§2.4): obligaciones del encargado como garantía adecuada, art. 27 b)/28. Las SCC de la UE no rigen para AlphaCode (DPA 12.1) |
| ~~OpenCode / Anomaly Innovations, Inc.~~ | — | **ya no recibe datos en producción desde el 2026-09-27** | — | — |
| Supabase (producción) | EE.UU. (us-east-1) | base de datos y almacenamiento (todos los datos de cuenta) | infraestructura | DPA del proveedor vigente. Cláusulas modelo PENDIENTES de suscribir |
| Supabase (respaldo sellado) | Brasil (sa-east-1) | copia congelada al 2026-08-22, sin escrituras nuevas | resguardo de continuidad | Sin transferencias desde el 2026-08-22. Destrucción comprometida al 2026-12-31 |
| Vercel | EE.UU. | datos en tránsito (hosting/funciones) | hosting | DPA del proveedor. Cláusulas modelo PENDIENTES |
| Cloudflare R2 | **JURISDICCIÓN INDETERMINADA** (`region: "auto"` en src/lib/r2.ts) | PDF de boletas, nómina SII | almacenamiento de archivos | Fijar jurisdicción del bucket ANTES de poder declarar el país de destino |
| Resend | EE.UU. (us-east-1) | email y nombre | correo saliente | DPA del proveedor. Cláusulas modelo PENDIENTES |
| ImprovMX | EE.UU./internacional | email en tránsito (no almacena) | correo entrante | PENDIENTE |
| Google (Gmail) | EE.UU./internacional | buzón de soporte y de ejercicio de derechos | recepción | Términos de consumidor. PENDIENTE evaluar cuenta con DPA |
| Telegram | internacional | imágenes de comprobantes (el bot las borra del chat tras copiarlas) y respuestas minimizadas del bot | recepción opcional | **Sin mecanismo del Art. 27**: Telegram no ofrece DPA. Riesgo aceptado y medidas en el RAT, sección "Riesgo aceptado — Telegram" |

## 2.bis Destinatarios elegidos por el cliente (no son encargados de AlphaCode)
Solo existen si el usuario conecta su propio asistente de IA (conector MCP). AlphaCode no los contrata, no les transfiere por iniciativa propia y no puede exigirles cláusulas: el usuario elige el destinatario y acepta los términos de ese proveedor. Por eso no caben en la tabla de importadores.

| Destinatario | País/región | Datos | Finalidad | Mecanismo |
|---|---|---|---|---|
| Anthropic (Claude) — solo si el usuario lo conecta | EE.UU. | pendientes de emisión seudonimizados (sin RUT, contacto, giro ni nombre de archivo de contrapartes; nombre acortado + etiqueta), razones de clasificación, confianza en baldes; motivo que el propio asistente escribe | copiloto de revisión del propio usuario (lee y ordena; no emite) | Consentimiento y elección del titular (activación expresa desde Empresa → Conector, OAuth PKCE, revocable de inmediato). El proveedor trata los datos bajo **su** contrato con el usuario |
| OpenAI (ChatGPT) — ídem | EE.UU. | ídem | ídem | ídem |
| Otro cliente MCP en la lista permitida — ídem | según proveedor | ídem | ídem | ídem |
| Mercado Pago | Latam/internacional | datos de pago, email | cobro | **TRANSITORIO** — se reemplaza por Reveniu (en construcción). No se gestiona DPA con un proveedor que sale |
| Telegram | internacional | imágenes de comprobantes que el usuario decide enviar | recepción opcional | **NO ofrece DPA** (servicio de consumo). Declarado en los T&C §5.1 y aceptado por el usuario. Canal OPCIONAL: la app funciona sin él |

## 3. Mecanismo de transferencia
Las partes adoptan las **Cláusulas Contractuales Modelo** del Ministerio de Economía como garantía adecuada (Ley 21.719). No basta el DPA estándar del proveedor por sí solo; estas cláusulas (o adecuación / normas corporativas vinculantes / consentimiento del titular) deben respaldar la transferencia.

## 4. Compromisos del importador
Tratar los datos solo según instrucciones, seguridad equivalente, no transferir a terceros sin garantías, y colaborar ante solicitudes de los titulares y de la Agencia.

## 5. Declaración en la política
Estas transferencias se declaran en la política de privacidad ("Con quién compartimos los datos").

---
*Borrador generado con compliance-cl (pack ley-21719). No constituye asesoría legal; revisar con un abogado.*
