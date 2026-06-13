/**
 * Cliente mínimo de la Bot API de Telegram. Fetch puro, sin dependencias.
 *
 * Si falta TELEGRAM_BOT_TOKEN se lanza un error controlado
 * "TELEGRAM_NO_CONFIGURADO" para que las rutas degraden elegante.
 */

const API_BASE = "https://api.telegram.org";

// Tipos mínimos de la Bot API (solo lo que el webhook usa).
export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

export interface TelegramCallbackQuery {
  id: string;
  from?: { id: number };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_NO_CONFIGURADO");
  return token;
}

/** Llama un método de la Bot API y devuelve el `result` ya desempaquetado. */
export async function tgCall<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = getBotToken();
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string }
    | null;
  if (!res.ok || !json?.ok) {
    throw new Error(
      `TELEGRAM_API_ERROR: ${method} -> ${json?.description ?? `HTTP ${res.status}`}`,
    );
  }
  return json.result as T;
}

/**
 * Manda un mensaje de texto al chat. HTML opcional (negritas, links).
 *
 * No lanza nunca: un mensaje que falla no debe cortar el flujo del webhook
 * (p. ej. dejar de procesar el comprobante). Si el envío con HTML es
 * rechazado, reintenta en texto plano antes de rendirse — mejor un mensaje
 * sin negritas que silencio. Cualquier fallo final queda logueado.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  opts?: { html?: boolean; replyMarkup?: InlineKeyboardMarkup | ForceReply },
): Promise<void> {
  const markup = opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {};
  try {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text,
      ...(opts?.html ? { parse_mode: "HTML" } : {}),
      ...markup,
    });
  } catch (err) {
    if (opts?.html) {
      try {
        await tgCall("sendMessage", { chat_id: chatId, text: text.replace(/<\/?[^>]+>/g, ""), ...markup });
        console.error("[telegram] sendMessage HTML rechazado, enviado en texto plano:",
          err instanceof Error ? err.message : err);
        return;
      } catch { /* cae al log de abajo */ }
    }
    console.error("[telegram] sendMessage falló:", err instanceof Error ? err.message : err);
  }
}

/** Edita un mensaje ya enviado (texto + botones). No lanza. */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  opts?: { html?: boolean; replyMarkup?: InlineKeyboardMarkup },
): Promise<void> {
  try {
    await tgCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(opts?.html ? { parse_mode: "HTML" } : {}),
      ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    });
  } catch (err) {
    console.error("[telegram] editMessageText falló:", err instanceof Error ? err.message : err);
  }
}

/** Responde el tap de un botón (quita el "reloj" de carga). No lanza. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await tgCall("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  } catch (err) {
    console.error("[telegram] answerCallbackQuery falló:", err instanceof Error ? err.message : err);
  }
}

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Descarga un archivo de Telegram por file_id y lo devuelve en base64.
 * El mime se infiere de la extensión del file_path (las fotos de Telegram
 * siempre llegan como jpg).
 */
export async function getFileBase64(
  fileId: string,
): Promise<{ base64: string; mime: string; size: number }> {
  const token = getBotToken();
  const file = await tgCall<{ file_path?: string; file_size?: number }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path) throw new Error("TELEGRAM_FILE_SIN_PATH");

  const res = await fetch(`${API_BASE}/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`TELEGRAM_FILE_DOWNLOAD_ERROR: HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = file.file_path.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "jpg";
  return {
    base64: buffer.toString("base64"),
    mime: MIME_POR_EXTENSION[ext] ?? "image/jpeg",
    size: buffer.length,
  };
}
