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
    "👋 <b>Hola, soy el bot de massDTE.</b>\n\n" +
    "Para conectar tu cuenta:\n" +
    "1. Entra a massDTE\n" +
    "2. Abre <b>Empresa → Bot de Telegram</b>\n" +
    "3. Toca <b>Conectar Telegram</b> y abre el link\n\n" +
    "Después mándame las fotos de tus comprobantes y las dejo en Agregados.",
  tokenInvalido:
    "⌛ <b>Ese link ya venció</b> (dura 15 minutos y es de un solo uso).\n\n" +
    "Si ya te conectaste antes, no tienes que hacer nada más: solo mándame una foto.\n" +
    "Si todavía no, genera un link nuevo en massDTE → <b>Empresa → Bot de Telegram</b>.",
  errorVincular: "😕 No pude conectar tu cuenta. Inténtalo de nuevo desde massDTE en un momento.",
  bienvenida:
    "✅ <b>Listo, tu cuenta quedó conectada.</b>\n\n" +
    "Mándame las <b>fotos de tus comprobantes</b> de pago y las dejo en <b>Agregados</b>, listas para boletear.\n\n" +
    "💡 Tip: manda un <b>screenshot</b> — se lee mucho mejor que una foto de la pantalla.",
  yaConectado:
    "✅ <b>Ya estás conectado.</b>\n" +
    "Mándame una foto de tu comprobante y la dejo en Agregados, lista para boletear.",
  noVinculado:
    "🔌 <b>Tu Telegram aún no está conectado.</b>\n" +
    "Conéctalo en massDTE → <b>Empresa → Bot de Telegram</b> y volvemos a empezar.",
  topeDiario:
    `🌙 Llegaste al tope de <b>${TOPE_DIARIO} comprobantes</b> por hoy.\n` +
    "Mañana seguimos — los de hoy ya quedaron en Agregados.",
  muyGrande:
    "📦 Esa foto pesa más de <b>6 MB</b> y no la puedo procesar.\n" +
    "Mándala un poco más liviana (un screenshot normal basta).",
  errorGuardar: "😕 No pude guardar tu comprobante. Inténtalo de nuevo en un rato.",
  recibido:
    "📥 <b>Recibido.</b>\n" +
    "Lo dejé en <b>Agregados</b> y lo estoy procesando — en unos segundos queda listo.",
  soloFotos:
    "📸 Solo proceso <b>fotos de comprobantes</b>.\n" +
    "Mándame la foto y la dejo en Agregados, lista para boletear.",
};

/** Todos los mensajes del bot usan formato HTML (negritas). */
const say = (chatId: number, text: string) => sendMessage(chatId, text, { html: true });

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** ¿Este chat ya está vinculado y activo? */
async function chatVinculado(chatId: number): Promise<boolean> {
  const { data } = await getServiceClient()
    .from("telegram_chats")
    .select("chat_id")
    .eq("chat_id", chatId)
    .eq("activo", true)
    .maybeSingle();
  return Boolean(data);
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
    else if (await chatVinculado(chatId)) await say(chatId, MSG.yaConectado);
    else await say(chatId, MSG.instruccionesVincular);
    return;
  }

  if (msg.photo?.length) {
    await recibirComprobante(chatId, msg.photo);
    return;
  }

  await say(chatId, MSG.soloFotos);
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
    // Token usado/expirado. Si el chat ya está vinculado no es un error:
    // probablemente reabrió un link viejo estando ya conectado.
    if (await chatVinculado(chatId)) await say(chatId, MSG.yaConectado);
    else await say(chatId, MSG.tokenInvalido);
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
    await say(chatId, MSG.errorVincular);
    return;
  }

  await svc.from("telegram_link_tokens").update({ used_at: ahora }).eq("token", token);
  await say(chatId, MSG.bienvenida);
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
    await say(chatId, MSG.noVinculado);
    return;
  }

  const subidosHoy = await contarComprobantesTelegramHoy(chat.empresa_id);
  if (subidosHoy >= TOPE_DIARIO) {
    await say(chatId, MSG.topeDiario);
    return;
  }

  // Telegram manda los tamaños de menor a mayor: el último es la mejor resolución.
  const foto = photos[photos.length - 1];
  if ((foto.file_size ?? 0) > MAX_FOTO_BYTES) {
    await say(chatId, MSG.muyGrande);
    return;
  }

  const { base64, mime, size } = await getFileBase64(foto.file_id);
  if (size > MAX_FOTO_BYTES) {
    await say(chatId, MSG.muyGrande);
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
    await say(chatId, MSG.errorGuardar);
    return;
  }

  // Confirmar de inmediato, ANTES del OCR (que tarda ~segundos). Así el
  // usuario ve "Recibido" al toque; el procesamiento corre en segundo plano.
  await say(chatId, MSG.recibido);

  // OCR + clasificación después de responder; after() mantiene viva la
  // function hasta terminar (mismo pipeline del panel).
  after(() =>
    procesarComprobanteTelegram({
      documentoId: creado.documentoId,
      empresaId: chat.empresa_id,
      base64,
      mime,
      nombreArchivo,
      chatId,
    }),
  );
}

export const dynamic = "force-dynamic";
