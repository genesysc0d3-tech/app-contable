import { NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  sendMessage,
  getFileBase64,
  type TelegramUpdate,
  type TelegramMessage,
  type TelegramPhotoSize,
} from "@/lib/telegram/api";
import {
  crearDocumentoTelegram,
  procesarComprobanteTelegram,
  contarComprobantesTelegramHoy,
  nombreComprobanteTelegram,
} from "@/lib/telegram/ingesta";

/**
 * Webhook del bot de Telegram: dropzone remoto de comprobantes.
 * El usuario manda una FOTO y queda en Agregados por el mismo pipeline
 * que una imagen subida en el panel. Desde Telegram NO se emite nada.
 */

const MAX_FOTO_BYTES = 6 * 1024 * 1024;
const TOPE_DIARIO = 50;

const MSG = {
  instruccionesVincular:
    "Hola, soy el bot de massDTE.\n" +
    "Para vincular tu cuenta: entra a massDTE → menú → Conectar Telegram y abre el link que te genera.\n" +
    "Después me mandas fotos de tus comprobantes y las dejo en Agregados.",
  tokenInvalido:
    "Ese link ya expiró o no es válido. Genera uno nuevo desde massDTE (menú → Conectar Telegram).",
  errorVincular: "No pude vincular tu cuenta. Intenta de nuevo desde massDTE.",
  bienvenida:
    "✓ Cuenta vinculada a massDTE.\n" +
    "Mándame fotos de tus comprobantes y las dejo en Agregados, listas para boletear.",
  noVinculado:
    "Tu Telegram no está vinculado — hazlo desde massDTE (menú → Conectar Telegram).",
  topeDiario: `Llegaste al tope de ${TOPE_DIARIO} comprobantes diarios por Telegram. Mañana puedes seguir mandando.`,
  muyGrande: "Esa foto pesa más de 6MB y no la puedo procesar. Mándala más liviana.",
  errorGuardar: "No pude guardar tu comprobante. Intenta de nuevo en un rato.",
  recibido: "📥 Recibido — tu comprobante quedó en Agregados y se está procesando.",
  soloFotos:
    "Solo proceso fotos de comprobantes. Mándame la foto y la dejo en Agregados, lista para boletear.",
};

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: "TELEGRAM_NO_CONFIGURADO" }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "NO_AUTORIZADO" }, { status: 401 });
  }

  // Pasado el control de seguridad, SIEMPRE 200: si Telegram no recibe ok
  // reintenta el update infinito y duplicaría comprobantes.
  try {
    const update = (await request.json()) as TelegramUpdate;
    if (update?.message) await handleMessage(update.message);
  } catch (error) {
    console.error("[telegram-webhook] error:", error);
  }
  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (text === "/start" || text?.startsWith("/start ")) {
    const token = text.slice("/start".length).trim();
    if (token) await vincularConToken(chatId, token);
    else await sendMessage(chatId, MSG.instruccionesVincular);
    return;
  }

  if (msg.photo?.length) {
    await recibirComprobante(chatId, msg.photo);
    return;
  }

  await sendMessage(chatId, MSG.soloFotos);
}

async function vincularConToken(chatId: number, token: string) {
  const svc = getServiceClient();
  const ahora = new Date().toISOString();

  const { data: linkToken } = await svc
    .from("telegram_link_tokens")
    .select("token, empresa_id, usuario_id")
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", ahora)
    .maybeSingle();
  if (!linkToken) {
    await sendMessage(chatId, MSG.tokenInvalido);
    return;
  }

  const { error: upsertError } = await svc.from("telegram_chats").upsert(
    {
      chat_id: chatId,
      empresa_id: linkToken.empresa_id,
      usuario_id: linkToken.usuario_id,
      activo: true,
      vinculado_at: ahora,
    },
    { onConflict: "chat_id" },
  );
  if (upsertError) {
    console.error("[telegram-webhook] vincular fallo:", upsertError.message);
    await sendMessage(chatId, MSG.errorVincular);
    return;
  }

  await svc.from("telegram_link_tokens").update({ used_at: ahora }).eq("token", token);
  await sendMessage(chatId, MSG.bienvenida);
}

async function recibirComprobante(chatId: number, photos: TelegramPhotoSize[]) {
  const svc = getServiceClient();

  // Chat no vinculado = CERO procesamiento (ni OCR ni storage): el costo
  // y el abuso se cortan acá.
  const { data: chat } = await svc
    .from("telegram_chats")
    .select("empresa_id, activo")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!chat?.activo) {
    await sendMessage(chatId, MSG.noVinculado);
    return;
  }

  const subidosHoy = await contarComprobantesTelegramHoy(chat.empresa_id);
  if (subidosHoy >= TOPE_DIARIO) {
    await sendMessage(chatId, MSG.topeDiario);
    return;
  }

  // Telegram manda los tamaños de menor a mayor: el último es la mejor resolución.
  const foto = photos[photos.length - 1];
  if ((foto.file_size ?? 0) > MAX_FOTO_BYTES) {
    await sendMessage(chatId, MSG.muyGrande);
    return;
  }

  const { base64, mime, size } = await getFileBase64(foto.file_id);
  if (size > MAX_FOTO_BYTES) {
    await sendMessage(chatId, MSG.muyGrande);
    return;
  }

  const nombreArchivo = nombreComprobanteTelegram();
  const creado = await crearDocumentoTelegram({
    empresaId: chat.empresa_id,
    base64,
    mime,
    nombreArchivo,
  });
  if (!creado.ok) {
    console.error("[telegram-webhook] ingesta fallo:", creado.error);
    await sendMessage(chatId, MSG.errorGuardar);
    return;
  }

  // OCR + clasificación corren después de responderle a Telegram (mismo
  // pipeline del panel); after() mantiene viva la function hasta terminar.
  after(() =>
    procesarComprobanteTelegram({
      documentoId: creado.documentoId,
      empresaId: chat.empresa_id,
      base64,
      mime,
      nombreArchivo,
    }),
  );

  await sendMessage(chatId, MSG.recibido);
}

export const dynamic = "force-dynamic";
