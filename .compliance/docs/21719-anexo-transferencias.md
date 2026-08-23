# Anexo de Transferencia Internacional de Datos — AlphaCode SpA

> Ampara el envío de datos personales fuera de Chile. Se firma/incorpora con cada proveedor extranjero. Mecanismo: **Cláusulas Contractuales Modelo** aprobadas por el Ministerio de Economía (Resolución RAEX202503748, Diario Oficial 19-12-2025), en `sources/clausulas-modelo-transferencia-economia.pdf`.

## 1. Exportador
AlphaCode SpA, RUT 78.448.088-7, Av. Apoquindo 6410 Of. 605, Las Condes, Santiago (Chile). Contacto de datos personales: privacidad@massdte.cl.

## 2. Importadores (proveedores con procesamiento fuera de Chile)

| Proveedor | País/región | Datos | Finalidad | Mecanismo |
|---|---|---|---|---|
| OpenCode / Anomaly Innovations, Inc. | EE.UU. (San Francisco). **Regiones de subprocesamiento NO declaradas por el proveedor** | imágenes y texto de cartolas/comprobantes (RUT, montos, nombres) | OCR + clasificación por IA (**zero-retention, sin entrenamiento**) | Cláusulas modelo [COMPLETAR firma] |
| Supabase (producción) | EE.UU. (us-east-1) | base de datos y almacenamiento (todos los datos de cuenta) | infraestructura | DPA del proveedor vigente. Cláusulas modelo PENDIENTES de suscribir |
| Supabase (respaldo sellado) | Brasil (sa-east-1) | copia congelada al 2026-08-22, sin escrituras nuevas | resguardo de continuidad | Sin transferencias desde el 2026-08-22. Destrucción comprometida al 2026-12-31 |
| Vercel | EE.UU. | datos en tránsito (hosting/funciones) | hosting | DPA del proveedor. Cláusulas modelo PENDIENTES |
| Cloudflare R2 | **JURISDICCIÓN INDETERMINADA** (`region: "auto"` en src/lib/r2.ts) | PDF de boletas, nómina SII | almacenamiento de archivos | Fijar jurisdicción del bucket ANTES de poder declarar el país de destino |
| Resend | EE.UU. (us-east-1) | email y nombre | correo saliente | DPA del proveedor. Cláusulas modelo PENDIENTES |
| ImprovMX | EE.UU./internacional | email en tránsito (no almacena) | correo entrante | PENDIENTE |
| Google (Gmail) | EE.UU./internacional | buzón de soporte y de ejercicio de derechos | recepción | Términos de consumidor. PENDIENTE evaluar cuenta con DPA |
| Telegram | internacional | imágenes de comprobantes | recepción | [verificar mecanismo] |
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
