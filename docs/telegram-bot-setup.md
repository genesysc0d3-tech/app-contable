# Bot de Telegram — Setup (dropzone remoto)

Qué hace: el cliente le manda una **foto de un comprobante** al bot y queda en
**Agregados** por el mismo pipeline que una imagen subida en el panel
(OCR Mistral → clasificación). El bot **NO emite boletas** — decisión de producto cerrada.

## 1. Crear el bot (una vez)

1. En Telegram, hablar con **@BotFather** → `/newbot`.
2. Nombre visible: `massDTE` (o el que corresponda). Username: debe terminar en `bot`, ej `massdte_bot`.
3. BotFather entrega el token tipo `123456789:ABC-DEF...` → ese es `TELEGRAM_BOT_TOKEN`.

## 2. Variables de entorno

| Variable | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de BotFather |
| `TELEGRAM_BOT_USERNAME` | Username **sin @** (ej `massdte_bot`) |
| `TELEGRAM_WEBHOOK_SECRET` | String seguro inventado: `openssl rand -hex 32` |

En local: `.env.local`. En Vercel: Settings → Environment Variables.
Sin estas envs la app degrada elegante: el menú tira toast "Telegram próximamente"
(`/api/telegram/link` responde 503) y el webhook responde 503.

## 3. Registrar el webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<dominio>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

El `secret_token` es obligatorio: el webhook rechaza con 401 cualquier request
cuyo header `x-telegram-bot-api-secret-token` no calce.

Verificar:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

Debe mostrar la `url` correcta, `last_error_message` vacío y `pending_update_count` en 0.

## 4. Prueba e2e

1. En la app: menú (engranaje) → **Conectar Telegram** → **Abrir Telegram** → apretar **Iniciar** en el chat.
2. El bot responde "✓ Cuenta vinculada a massDTE."
3. Mandarle una foto de un comprobante.
4. El bot responde "📥 Recibido — tu comprobante quedó en Agregados y se está procesando."
5. En la app, el comprobante aparece en **Agregados** como `Telegram dd-mm HH:mm comprobante.jpg`, primero "procesando" y al rato clasificado (mismo pipeline que subir la imagen a mano).

## 5. Reglas operativas

- Chats **no vinculados** = cero procesamiento (ni OCR ni storage); solo reply pidiendo vincular.
- El link de vinculación expira en **15 minutos** y es de **un solo uso**.
- Tope: **50 comprobantes diarios** por empresa vía Telegram (día en hora de Chile). Fotos sobre **6MB** se rechazan.
- Solo procesa **fotos** (tipo photo de Telegram). Texto, stickers o archivos adjuntos → reply explicando que solo van fotos de comprobantes.
- El bot jamás emite: solo deja el comprobante en Agregados, listo para boletear desde la app.
- Trazabilidad: los comprobantes quedan con `progreso_ia.origen = "telegram"` y el prefijo `Telegram ` en el nombre.
