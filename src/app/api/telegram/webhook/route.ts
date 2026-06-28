import { NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { enqueueDocumentProcessingJob, processDocumentQueue } from "@/lib/document-processing/queue";
import { subirDocumentoR2 } from "@/lib/storage";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  getFileBase64,
  type TelegramUpdate,
  type TelegramMessage,
  type TelegramPhotoSize,
  type TelegramCallbackQuery,
  type InlineKeyboardMarkup,
} from "@/lib/telegram/api";
import {
  crearDocumentoTelegram,
  procesarComprobanteTelegram,
  contarComprobantesTelegramHoy,
  nombreComprobanteTelegram,
} from "@/lib/telegram/ingesta";
import {
  propuestaPorId,
  propuestasPendientesEmpresa,
  tipoContribuyenteEmpresa,
  tipoBoletaDeContribuyente,
  mensajeBoleta,
  mensajeMovimientoSinBoleta,
  mensajeDuplicado,
  kbCampos,
  kbConfirmarIngreso,
  kbConfirmarDuplicado,
  labelCampo,
  valorActual,
  aprobarBot,
  editarCampoBot,
  setPendingEdit,
  getPendingEdit,
  clearPendingEdit,
  setTipoContribuyente,
  registrarMensajeTelegram,
  markMensajeEstado,
  movimientoPorId,
  ignorarMovimientoSalidaBot,
  convertirMovimientoEnIngresoBot,
  prepararConfirmacionDuplicado,
  setDuplicadoMessage,
  descartarDuplicadoBot,
  aceptarDuplicadoBot,
  propuestasDeDocumento,
  movimientosSinPropuestaDeDocumento,
  duplicadosDeDocumento,
} from "@/lib/telegram/propuestas";

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
    "Estoy preparando la boleta — te la muestro en unos segundos.",
  recibidoElegirEmpresa:
    "📥 <b>Recibí el comprobante.</b>\n" +
    "¿Para qué empresa lo cargo?",
  soloFotos:
    "📸 Solo proceso <b>fotos de comprobantes</b>.\n" +
    "Mándame la foto y la dejo en Agregados, lista para boletear.",
};

type Svc = ReturnType<typeof getServiceClient>;

type TelegramEmpresaOpcion = {
  id: string;
  rut: string | null;
  nombre: string;
};

type TelegramPendienteOpciones = TelegramEmpresaOpcion[];

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
  return (await empresaDelChat(chatId)) !== null;
}

/** empresa_id del chat si está vinculado y activo, si no null. */
async function empresaDelChat(chatId: number): Promise<string | null> {
  const { data } = await getServiceClient()
    .from("telegram_chats")
    .select("empresa_id, activo")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data?.activo ? data.empresa_id : null;
}

function pendingToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function empresaLabel(empresa: TelegramEmpresaOpcion) {
  return [empresa.rut, empresa.nombre].filter(Boolean).join(" - ");
}

function parseOpciones(value: Json | null): TelegramPendienteOpciones {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, Json | undefined> : null)
    .filter((item): item is Record<string, Json | undefined> => Boolean(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      rut: typeof item.rut === "string" ? item.rut : null,
      nombre: typeof item.nombre === "string" ? item.nombre : "",
    }))
    .filter((item) => item.id && item.nombre);
}

function kbElegirEmpresa(token: string, opciones: TelegramEmpresaOpcion[], selectedEmpresaId?: string | null): InlineKeyboardMarkup {
  return {
    inline_keyboard: opciones.map((empresa, index) => [{
      text: `${selectedEmpresaId === empresa.id ? "OK? " : ""}${empresaLabel(empresa)}`,
      callback_data: `tgemp:${token}:${index}`,
    }]),
  };
}

async function empresasParaTelegramMultiempresa(svc: Svc, empresaId: string): Promise<{ cuentaId: string; empresas: TelegramEmpresaOpcion[] } | null> {
  const cuenta = await contextoCuentaPorEmpresa(svc, empresaId);
  if (!cuenta?.planActivo || !cuenta.multiempresa || cuenta.empresasActivas < 2) return null;

  const { data: membresias, error: membresiasError } = await svc
    .from("cuenta_empresas")
    .select("empresa_id")
    .eq("cuenta_id", cuenta.cuentaId)
    .eq("activa", true)
    .order("es_principal", { ascending: false })
    .order("created_at", { ascending: true });
  if (membresiasError) throw new Error(`TELEGRAM_EMPRESAS_QUERY_FAILED:${membresiasError.message}`);

  const ids = (membresias ?? []).map((row) => row.empresa_id);
  if (ids.length < 2) return null;

  const { data: empresas, error: empresasError } = await svc
    .from("empresas")
    .select("id, rut, razon_social")
    .in("id", ids);
  if (empresasError) throw new Error(`TELEGRAM_EMPRESAS_DATA_FAILED:${empresasError.message}`);

  const byId = new Map((empresas ?? []).map((empresa) => [empresa.id, empresa]));
  const opciones = ids
    .map((id) => byId.get(id))
    .filter((empresa): empresa is NonNullable<typeof empresa> => Boolean(empresa))
    .map((empresa) => ({
      id: empresa.id,
      rut: empresa.rut ?? null,
      nombre: empresa.razon_social,
    }));

  return opciones.length >= 2 ? { cuentaId: cuenta.cuentaId, empresas: opciones } : null;
}

async function tipoChat(empresaId: string) {
  return tipoBoletaDeContribuyente(await tipoContribuyenteEmpresa(empresaId));
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
    else if (update?.callback_query) await handleCallback(update.callback_query);
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

  if (text === "/config") {
    await mostrarConfig(chatId);
    return;
  }

  if (text === "/cancelar") {
    await clearPendingEdit(chatId);
    await say(chatId, "✅ Cancelé la edición pendiente. No voy a aplicar el próximo texto a una boleta vieja.");
    return;
  }

  if (text === "/pendientes") {
    await mostrarPendientes(chatId);
    return;
  }

  if (text === "/ultimo") {
    await mostrarUltimo(chatId);
    return;
  }

  // Si hay una edición pendiente, este texto es el nuevo valor del campo.
  if (text && !text.startsWith("/")) {
    const pending = await getPendingEdit(chatId);
    if (pending) {
      await aplicarEdicion(chatId, pending, text);
      return;
    }
  }

  if (msg.photo?.length) {
    await recibirComprobante(chatId, msg.photo, msg.date, msg.media_group_id);
    return;
  }

  await say(chatId, MSG.soloFotos);
}

// --- Botones (callback_query): aprobar / editar / volver / config ---

async function handleCallback(cq: TelegramCallbackQuery) {
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  const data = cq.data ?? "";
  if (!chatId) { await answerCallbackQuery(cq.id); return; }

  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await answerCallbackQuery(cq.id, "Tu Telegram no está conectado."); return; }

  if (data.startsWith("tgemp:")) {
    await handleEmpresaComprobanteCallback(chatId, messageId, cq.id, data);
    return;
  }

  // Responder de inmediato a Telegram quita el spinner del botón. Las llamadas
  // posteriores a answerCallbackQuery son no-op para este callback.
  void answerCallbackQuery(cq.id);

  // Config del tipo de boleta (global de la empresa).
  if (data === "cfg:afecto" || data === "cfg:exento") {
    const tipo = data === "cfg:exento" ? "exento" : "afecto";
    await setTipoContribuyente(empresaId, tipo);
    if (messageId) await editMessageText(chatId, messageId, textoConfig(tipo), { html: true, replyMarkup: kbConfig(tipo) });
    await answerCallbackQuery(cq.id, tipo === "exento" ? "Ahora exentas" : "Ahora afectas");
    return;
  }

  // Acciones sobre una propuesta: <accion>:<propId>[:<campo>]
  const [accion, propId, campo] = data.split(":");
  if (!propId) { await answerCallbackQuery(cq.id); return; }
  const tipo = await tipoChat(empresaId);

  if (accion === "mv") {
    await handleMovimientoCallback(chatId, messageId, cq.id, empresaId, propId, campo);
    return;
  }

  if (accion === "du") {
    await handleDuplicadoCallback(chatId, messageId, cq.id, empresaId, propId, campo);
    return;
  }

  if (accion === "ap") {
    const status = await aprobarBot(propId, empresaId);
    const prop = await propuestaPorId(propId, empresaId);
    if ((status === "aprobado" || status === "ya_aprobado") && prop) {
      const text = mensajeBoleta(prop, tipo).text;
      const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true }) : false;
      if (!edited) {
        const msg = await sendMessage(chatId, text, { html: true });
        await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta", estado: "aprobado" });
      } else {
        await markMensajeEstado(chatId, messageId, "aprobado");
      }
    }
    const answer =
      status === "aprobado" ? "✅ Aprobada — está en Agregados" :
      status === "ya_aprobado" ? "Ya estaba aprobada" :
      status === "estado_invalido" ? "Esta boleta ya no está pendiente" :
      "No encontré la boleta";
    await answerCallbackQuery(cq.id, answer);
    return;
  }

  if (accion === "ed") {
    const prop = await propuestaPorId(propId, empresaId);
    if (prop && messageId) {
      const text = mensajeBoleta(prop, tipo).text + "\n\n¿Qué querés cambiar?";
      const edited = await editMessageText(chatId, messageId, text, { html: true, replyMarkup: kbCampos(propId) });
      if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: kbCampos(propId) });
    }
    await answerCallbackQuery(cq.id);
    return;
  }

  if (accion === "bk") {
    const prop = await propuestaPorId(propId, empresaId);
    if (prop && messageId) {
      const { text, keyboard } = mensajeBoleta(prop, tipo);
      const edited = await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard });
      if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    }
    await answerCallbackQuery(cq.id);
    return;
  }

  if (accion === "ec" && campo) {
    const prop = await propuestaPorId(propId, empresaId);
    if (!prop) { await answerCallbackQuery(cq.id, "No encontré la boleta"); return; }
    await setPendingEdit(chatId, propId, campo, messageId ?? null);
    await say(chatId, `✏️ Escribí ${labelCampo(campo)} nuevo.\nActual: <b>${valorActual(prop, campo)}</b> 👇`);
    await answerCallbackQuery(cq.id);
    return;
  }

  await answerCallbackQuery(cq.id);
}

async function handleMovimientoCallback(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
  empresaId: string,
  movId: string,
  accion: string | undefined,
) {
  const tipo = await tipoChat(empresaId);
  const mov = await movimientoPorId(movId, empresaId);
  if (!mov) {
    await answerCallbackQuery(callbackId, accion === "d" ? "Ya estaba ignorado" : "No encontré el movimiento");
    return;
  }

  if (accion === "bk") {
    const { text, keyboard } = mensajeMovimientoSinBoleta(mov);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "d") {
    const status = await ignorarMovimientoSalidaBot(movId, empresaId, chatId);
    const text = status === "con_propuesta"
      ? "⚠️ Esta operación ya tiene una propuesta asociada. Revisala en Agregados."
      : "🚫 <b>No es ingreso.</b>\nNo generé boleta y quité esta transferencia del flujo contable.";
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true });
    await markMensajeEstado(chatId, messageId, "descartado");
    await answerCallbackQuery(callbackId, status === "ignorado" ? "Ignorado" : "Ya estaba resuelto");
    return;
  }

  if (accion === "i1") {
    const text =
      "⚠️ <b>Confirmá esto antes de crear la boleta.</b>\n\n" +
      "Este comprobante parece una transferencia enviada. Por defecto no genera boleta.\n\n" +
      "Solo seguí si realmente fue un pago recibido por tu empresa. ¿Confirmás?";
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: kbConfirmarIngreso(movId) }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: kbConfirmarIngreso(movId) });
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "i2") {
    const prop = await convertirMovimientoEnIngresoBot(movId, empresaId, chatId);
    if (!prop) { await answerCallbackQuery(callbackId, "No pude crear la boleta"); return; }
    const { text, keyboard } = mensajeBoleta(prop, tipo);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) {
      const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
      await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
    } else {
      await registrarMensajeTelegram({ chatId, empresaId, messageId, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
    }
    await answerCallbackQuery(callbackId, "Boleta creada para revisar");
    return;
  }

  await answerCallbackQuery(callbackId);
}

async function handleDuplicadoCallback(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
  empresaId: string,
  actionId: string,
  accion: string | undefined,
) {
  const tipo = await tipoChat(empresaId);

  if (accion === "bk") {
    const d = await prepararConfirmacionDuplicado(actionId, empresaId);
    if (!d) { await answerCallbackQuery(callbackId, "No encontré el duplicado"); return; }
    const { text, keyboard } = mensajeDuplicado(d);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "d") {
    const status = await descartarDuplicadoBot(actionId, empresaId, chatId);
    const text = status === "ya_aceptado"
      ? "Ese duplicado ya había sido aceptado."
      : "🗑️ <b>Duplicado descartado.</b>\nNo se creará otra boleta por esta operación.";
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true });
    await markMensajeEstado(chatId, messageId, "descartado");
    await answerCallbackQuery(callbackId, status === "descartado" ? "Descartado" : "Ya estaba resuelto");
    return;
  }

  if (accion === "a1") {
    const d = await prepararConfirmacionDuplicado(actionId, empresaId);
    if (!d) { await answerCallbackQuery(callbackId, "No encontré el duplicado"); return; }
    const text =
      "⚠️ <b>¿Seguro?</b>\n\n" +
      `Esta operación ya parece registrada: <b>${Math.round(d.monto).toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })}</b>.\n` +
      "Si aceptás igual, voy a crear otra propuesta y podrías duplicar la boleta.";
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: kbConfirmarDuplicado(actionId) }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: kbConfirmarDuplicado(actionId) });
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "a2") {
    const res = await aceptarDuplicadoBot(actionId, empresaId, chatId);
    if (res.estado === "procesando") { await answerCallbackQuery(callbackId, "Ya estoy procesando ese duplicado"); return; }
    if (res.estado === "descartado") { await answerCallbackQuery(callbackId, "Ya estaba descartado"); return; }
    if (res.estado === "no_encontrado") { await answerCallbackQuery(callbackId, "No encontré el duplicado"); return; }
    if (res.estado === "error") { await answerCallbackQuery(callbackId, "No pude aceptar el duplicado"); return; }
    if (res.estado !== "aceptado" && res.estado !== "ya_aceptado") { await answerCallbackQuery(callbackId); return; }
    const prop = res.prop;
    if (!prop) { await answerCallbackQuery(callbackId, "Aceptado, pero sin propuesta"); return; }

    const { text, keyboard } = mensajeBoleta(prop, tipo);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) {
      const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
      await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
    } else {
      await registrarMensajeTelegram({ chatId, empresaId, messageId, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
    }
    await answerCallbackQuery(callbackId, res.estado === "ya_aceptado" ? "Ya estaba aceptado" : "Duplicado aceptado");
    return;
  }

  await answerCallbackQuery(callbackId);
}

async function handleEmpresaComprobanteCallback(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
  data: string,
) {
  const [, token, indexRaw] = data.split(":");
  const index = Number(indexRaw);
  if (!token || !Number.isInteger(index)) {
    await answerCallbackQuery(callbackId, "No pude leer esa opción.");
    return;
  }

  const svc = getServiceClient();
  const nowIso = new Date().toISOString();
  const { data: pending, error } = await svc
    .from("telegram_comprobante_pendientes")
    .select("token, chat_id, cuenta_id, empresa_origen_id, selected_empresa_id, file_id, file_size, received_at, opciones, estado, expires_at")
    .eq("token", token)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (error || !pending) {
    await answerCallbackQuery(callbackId, "Ese comprobante ya no está disponible.");
    return;
  }
  if (pending.expires_at <= nowIso || !["pendiente", "confirmando"].includes(pending.estado)) {
    await svc
      .from("telegram_comprobante_pendientes")
      .update({ estado: "expirado", updated_at: nowIso })
      .eq("token", token)
      .in("estado", ["pendiente", "confirmando"]);
    if (messageId) {
      await editMessageText(chatId, messageId, "⌛ Ese comprobante venció. Mándalo de nuevo y elige la empresa.", { html: true });
    }
    await answerCallbackQuery(callbackId, "El comprobante venció.");
    return;
  }

  const opciones = parseOpciones(pending.opciones);
  const selected = opciones[index];
  if (!selected) {
    await answerCallbackQuery(callbackId, "No encontré esa empresa.");
    return;
  }

  const { data: membresia } = await svc
    .from("cuenta_empresas")
    .select("empresa_id, activa")
    .eq("cuenta_id", pending.cuenta_id)
    .eq("empresa_id", selected.id)
    .maybeSingle();
  if (!membresia?.activa) {
    await answerCallbackQuery(callbackId, "Esa empresa ya no está disponible.");
    return;
  }

  if (pending.selected_empresa_id !== selected.id) {
    await svc
      .from("telegram_comprobante_pendientes")
      .update({ selected_empresa_id: selected.id, estado: "confirmando", updated_at: nowIso })
      .eq("token", token);
    if (messageId) {
      await editMessageText(chatId, messageId, MSG.recibidoElegirEmpresa, {
        html: true,
        replyMarkup: kbElegirEmpresa(token, opciones, selected.id),
      });
    }
    await answerCallbackQuery(callbackId, "Toca de nuevo para confirmar.");
    return;
  }

  const { count: confirmedCount, error: confirmedError } = await svc
    .from("telegram_comprobante_pendientes")
    .update({ estado: "procesando", updated_at: nowIso }, { count: "exact" })
    .eq("token", token)
    .eq("selected_empresa_id", selected.id)
    .eq("estado", "confirmando");
  if (confirmedError || !confirmedCount) {
    await answerCallbackQuery(callbackId, "Ya estoy procesando ese comprobante.");
    return;
  }

  const text =
    `📥 <b>Recibido para ${empresaLabel(selected)}.</b>\n` +
    "Estoy preparando la boleta — te la muestro en unos segundos.";
  if (messageId) await editMessageText(chatId, messageId, text, { html: true });
  await answerCallbackQuery(callbackId, "Empresa confirmada.");

  after(() =>
    guardarYProcesarComprobanteTelegram({
      chatId,
      empresaId: selected.id,
      fileId: pending.file_id,
      fileSize: pending.file_size,
      receivedAt: pending.received_at ?? undefined,
      pendingToken: token,
      sendReceivedMessage: false,
    }),
  );
}

/** Aplica el valor que el usuario escribió para el campo en edición. */
async function aplicarEdicion(
  chatId: number,
  pending: { propuesta_id: string; campo: string; message_id: number | null },
  valor: string,
) {
  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await clearPendingEdit(chatId); return; }
  const tipo = await tipoChat(empresaId);
  const res = await editarCampoBot(pending.propuesta_id, empresaId, pending.campo, valor, tipo);
  if (!res.ok) {
    await say(chatId, "⚠️ " + res.error); // sin limpiar: deja reintentar
    return;
  }
  await clearPendingEdit(chatId);
  const { text, keyboard } = mensajeBoleta(res.prop, tipo);
  if (pending.message_id) {
    const edited = await editMessageText(chatId, pending.message_id, text, { html: true, replyMarkup: keyboard });
    if (!edited) {
      const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
      await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: res.prop.documento_id, propuestaId: res.prop.id, kind: "propuesta" });
    }
  } else {
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: res.prop.documento_id, propuestaId: res.prop.id, kind: "propuesta" });
  }
  await say(chatId, "✅ Listo, actualizado.");
}

async function mostrarPendientes(chatId: number) {
  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await say(chatId, MSG.noVinculado); return; }
  const props = await propuestasPendientesEmpresa(empresaId, 10);
  if (props.length === 0) {
    await say(chatId, "✅ No tenés boletas pendientes para revisar por ahora.");
    return;
  }
  const tipo = await tipoChat(empresaId);
  await say(chatId, `📌 Tenés <b>${props.length}</b> boleta${props.length === 1 ? "" : "s"} pendiente${props.length === 1 ? "" : "s"}. Te las reenvío:`);
  for (const prop of props) {
    const { text, keyboard } = mensajeBoleta(prop, tipo);
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
  }
}

async function mostrarUltimo(chatId: number) {
  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await say(chatId, MSG.noVinculado); return; }
  const { data: doc } = await getServiceClient()
    .from("documentos_subidos")
    .select("id, nombre_archivo, estado, created_at, movimientos_detectados, progreso_ia")
    .eq("empresa_id", empresaId)
    .like("nombre_archivo", "Telegram %")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc) {
    await say(chatId, "Todavía no tengo comprobantes de Telegram para esta cuenta.");
    return;
  }

  if (doc.estado === "procesando") {
    await say(chatId, `⏳ El último comprobante (<b>${doc.nombre_archivo}</b>) sigue procesándose.`);
    return;
  }
  if (doc.estado === "error") {
    const progreso = doc.progreso_ia && typeof doc.progreso_ia === "object" && !Array.isArray(doc.progreso_ia)
      ? doc.progreso_ia as Record<string, unknown>
      : {};
    await say(chatId, `😕 El último comprobante quedó con error: <b>${String(progreso.error ?? "sin detalle")}</b>.`);
    return;
  }

  const progreso = doc.progreso_ia && typeof doc.progreso_ia === "object" && !Array.isArray(doc.progreso_ia)
    ? doc.progreso_ia as Record<string, unknown>
    : {};
  if (progreso.telegram_estado === "ignorado_no_ingreso") {
    await say(chatId, `🚫 Último comprobante: <b>${doc.nombre_archivo}</b>.\nFue marcado como <b>no ingreso</b>, no generó boleta.`);
    return;
  }

  const props = await propuestasDeDocumento(doc.id, empresaId);
  const dups = await duplicadosDeDocumento(doc.id, empresaId);
  const movs = await movimientosSinPropuestaDeDocumento(doc.id, empresaId);
  const tipo = await tipoChat(empresaId);

  await say(chatId, `📄 Último comprobante: <b>${doc.nombre_archivo}</b>.`);
  if (props.length > 0) {
    await say(chatId, `🧾 Tiene <b>${props.length}</b> boleta${props.length === 1 ? "" : "s"} para revisar:`);
    for (const prop of props) {
      const { text, keyboard } = mensajeBoleta(prop, tipo);
      const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
      await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: prop.documento_id, propuestaId: prop.id, kind: "propuesta" });
    }
    return;
  }
  if (dups.length > 0) {
    await say(chatId, `⚠️ Tiene <b>${dups.length}</b> duplicado${dups.length === 1 ? "" : "s"} pendiente${dups.length === 1 ? "" : "s"}. Te reenvío los botones:`);
    for (const d of dups) {
      const { text, keyboard } = mensajeDuplicado(d);
      const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
      await setDuplicadoMessage(d.actionId, empresaId, msg?.message_id);
      await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: doc.id, kind: "duplicado" });
    }
    return;
  }
  if (movs.length > 0) {
    const m = movs[0];
    const { text, keyboard } = mensajeMovimientoSinBoleta(m);
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await registrarMensajeTelegram({ chatId, empresaId, messageId: msg?.message_id, documentoId: doc.id, kind: "salida" });
    return;
  }
  await say(chatId, "✅ El último comprobante quedó procesado, sin acciones pendientes.");
}

// --- /config: tipo de boleta por defecto (afecta/exenta) de la empresa ---

async function mostrarConfig(chatId: number) {
  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await say(chatId, MSG.noVinculado); return; }
  const tipo = (await tipoContribuyenteEmpresa(empresaId)) === "exento" ? "exento" : "afecto";
  await sendMessage(chatId, textoConfig(tipo), { html: true, replyMarkup: kbConfig(tipo) });
}

function textoConfig(tipo: "afecto" | "exento"): string {
  const actual = tipo === "exento" ? "Exenta (41)" : "Afecta (39)";
  return (
    "⚙️ <b>Configuración</b>\n\n" +
    `Tus boletas se generan como <b>${actual}</b> por defecto.\n` +
    "Elige el tipo (también lo podés cambiar en massDTE → Empresa):"
  );
}

function kbConfig(tipo: "afecto" | "exento"): InlineKeyboardMarkup {
  return { inline_keyboard: [[
    { text: (tipo !== "exento" ? "✓ " : "") + "Afecta (39)", callback_data: "cfg:afecto" },
    { text: (tipo === "exento" ? "✓ " : "") + "Exenta (41)", callback_data: "cfg:exento" },
  ]] };
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

async function guardarYProcesarComprobanteTelegram(args: {
  chatId: number;
  empresaId: string;
  fileId: string;
  fileSize?: number | null;
  receivedAt?: number;
  pendingToken?: string;
  sendReceivedMessage: boolean;
}) {
  const svc = getServiceClient();
  try {
    const subidosHoy = await contarComprobantesTelegramHoy(args.empresaId);
    if (subidosHoy >= TOPE_DIARIO) {
      if (args.pendingToken) {
        await svc
          .from("telegram_comprobante_pendientes")
          .update({ estado: "cancelado", updated_at: new Date().toISOString() })
          .eq("token", args.pendingToken);
      }
      await say(args.chatId, MSG.topeDiario);
      return;
    }

    if ((args.fileSize ?? 0) > MAX_FOTO_BYTES) {
      if (args.pendingToken) {
        await svc
          .from("telegram_comprobante_pendientes")
          .update({ estado: "fallido", updated_at: new Date().toISOString() })
          .eq("token", args.pendingToken);
      }
      await say(args.chatId, MSG.muyGrande);
      return;
    }

    const { base64, mime, size } = await getFileBase64(args.fileId);
    if (size > MAX_FOTO_BYTES) {
      if (args.pendingToken) {
        await svc
          .from("telegram_comprobante_pendientes")
          .update({ estado: "fallido", updated_at: new Date().toISOString() })
          .eq("token", args.pendingToken);
      }
      await say(args.chatId, MSG.muyGrande);
      return;
    }

    const nombreArchivo = nombreComprobanteTelegram();
    const creado = await crearDocumentoTelegram({
      empresaId: args.empresaId,
      base64,
      mime,
      nombreArchivo,
    });
    if (!creado.ok) {
      console.error("[telegram-webhook] ingesta fallo:", creado.error);
      if (args.pendingToken) {
        await svc
          .from("telegram_comprobante_pendientes")
          .update({ estado: "fallido", updated_at: new Date().toISOString() })
          .eq("token", args.pendingToken);
      }
      await say(args.chatId, MSG.errorGuardar);
      return;
    }

    if (args.sendReceivedMessage) await say(args.chatId, MSG.recibido);

    const run = async () => {
      await procesarComprobanteTelegram({
        documentoId: creado.documentoId,
        empresaId: args.empresaId,
        base64,
        mime,
        nombreArchivo,
        chatId: args.chatId,
        receivedAt: args.receivedAt,
      });
      if (args.pendingToken) {
        await getServiceClient()
          .from("telegram_comprobante_pendientes")
          .update({ estado: "completado", updated_at: new Date().toISOString() })
          .eq("token", args.pendingToken);
      }
    };

    if (args.pendingToken) await run();
    else after(run);
  } catch (error) {
    console.error("[telegram-webhook] procesar comprobante fallo:", error);
    if (args.pendingToken) {
      await svc
        .from("telegram_comprobante_pendientes")
        .update({ estado: "fallido", updated_at: new Date().toISOString() })
        .eq("token", args.pendingToken);
    }
    await say(args.chatId, MSG.errorGuardar);
  }
}

// Cliente acotado para la tabla nueva telegram_album_buffer (types sin regenerar).
function albumBuffer(svc: ReturnType<typeof getServiceClient>) {
  return (svc as unknown as {
    from: (t: string) => {
      insert: (v: { empresa_id: string; media_group_id: string; image: Json }) => PromiseLike<{ error: { message: string } | null }>;
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => PromiseLike<{ data: { image: Json }[] | null }> } };
      delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => PromiseLike<unknown> } };
    };
  }).from("telegram_album_buffer");
}

// Una foto de un álbum (v1: chats de una empresa). Sube a R2, deja su imagen en el
// buffer e intenta ser el "creador" (único por empresa+media_group_id). El creador
// espera un debounce a que lleguen las hermanas y encola UN job multi-imagen = 1 venta.
async function recibirAlbumFoto(chatId: number, empresaId: string, foto: TelegramPhotoSize, mediaGroupId: string) {
  const svc = getServiceClient();

  let foto64: { base64: string; mime: string; size: number };
  try { foto64 = await getFileBase64(foto.file_id); } catch { return; }
  if (foto64.size > MAX_FOTO_BYTES) return;

  const nombre = nombreComprobanteTelegram();
  let key: string;
  try {
    const up = await subirDocumentoR2(empresaId, `album_${mediaGroupId}_${nombre}`, Buffer.from(foto64.base64, "base64"), foto64.mime);
    key = up.key;
  } catch { return; }

  await albumBuffer(svc).insert({ empresa_id: empresaId, media_group_id: mediaGroupId, image: { path: key, mime: foto64.mime, name: nombre } as Json });

  // Intentar ser el creador (índice único por empresa+media_group_id).
  const { data: doc, error: insErr } = await svc
    .from("documentos_subidos")
    .insert({
      empresa_id: empresaId,
      nombre_archivo: `Álbum ${nombre}`,
      tipo: "imagen",
      storage_path: key,
      storage_provider: "r2",
      estado: "subido",
      media_group_id: mediaGroupId,
      progreso_ia: { origen: "telegram", album: true } as Json,
    } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Insert"])
    .select("id")
    .single();
  if (insErr || !doc) return; // conflicto (foto hermana) o error → solo quedó la imagen en el buffer

  // Soy el creador. Tope diario (un álbum cuenta como 1 comprobante).
  if ((await contarComprobantesTelegramHoy(empresaId)) > TOPE_DIARIO) {
    await svc.from("documentos_subidos").delete().eq("id", doc.id);
    await albumBuffer(svc).delete().eq("empresa_id", empresaId).eq("media_group_id", mediaGroupId);
    await say(chatId, MSG.topeDiario);
    return;
  }
  await say(chatId, "📸 Álbum recibido — junto las fotos y queda como una venta.");

  after(async () => {
    await new Promise((r) => setTimeout(r, 4000)); // debounce: esperar a las fotos hermanas
    const svc2 = getServiceClient();
    const { data: imgs } = await albumBuffer(svc2).select("image").eq("empresa_id", empresaId).eq("media_group_id", mediaGroupId);
    const grouped = (imgs ?? []).map((r) => r.image).filter(Boolean);
    if (grouped.length === 0) return;
    try {
      const job = await enqueueDocumentProcessingJob(svc2, {
        documentoId: doc.id, empresaId, usuarioId: null, tipo: "imagen", storagePath: key,
        metadata: { grouped_images: grouped, origen: "telegram", album: true },
      });
      await svc2.from("documentos_subidos").update({ estado: "procesando", progreso_ia: { estado: "queued", job_id: job.id, origen: "telegram", album: true } as Json }).eq("id", doc.id);
      await albumBuffer(svc2).delete().eq("empresa_id", empresaId).eq("media_group_id", mediaGroupId);
      processDocumentQueue({ sb: svc2, limit: 1, lockOwner: "telegram-album-kick" }).catch(() => {});
      await say(chatId, `✅ Álbum de ${grouped.length} foto${grouped.length === 1 ? "" : "s"} en proceso — queda como una venta en la mesa.`);
    } catch {
      await svc2.from("documentos_subidos").update({ estado: "error", progreso_ia: { estado: "error", error: "No se pudo encolar el álbum" } as Json }).eq("id", doc.id);
      await say(chatId, MSG.errorGuardar);
    }
  });
}

async function recibirComprobante(chatId: number, photos: TelegramPhotoSize[], receivedAt?: number, mediaGroupId?: string) {
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

  // Telegram manda los tamaños de menor a mayor: el último es la mejor resolución.
  const foto = photos[photos.length - 1];
  if ((foto.file_size ?? 0) > MAX_FOTO_BYTES) {
    await say(chatId, MSG.muyGrande);
    return;
  }

  const multiempresa = await empresasParaTelegramMultiempresa(svc, chat.empresa_id).catch((error) => {
    console.error("[telegram-webhook] selector multiempresa fallo:", error);
    return null;
  });

  // Álbum (v1: solo chats de UNA empresa). Las fotos del set se agrupan en UNA venta.
  // Multiempresa + álbum → cae al flujo normal (foto suelta), no soportado en v1.
  if (mediaGroupId && !multiempresa) {
    await recibirAlbumFoto(chatId, chat.empresa_id, foto, mediaGroupId);
    return;
  }

  if (multiempresa) {
    const token = pendingToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await svc
      .from("telegram_comprobante_pendientes")
      .update({ estado: "cancelado", updated_at: new Date().toISOString() })
      .eq("chat_id", chatId)
      .in("estado", ["pendiente", "confirmando"]);

    const { error: insertError } = await svc.from("telegram_comprobante_pendientes").insert({
      token,
      chat_id: chatId,
      cuenta_id: multiempresa.cuentaId,
      empresa_origen_id: chat.empresa_id,
      file_id: foto.file_id,
      file_size: foto.file_size ?? null,
      received_at: receivedAt ?? null,
      opciones: multiempresa.empresas as unknown as Json,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("[telegram-webhook] pendiente multiempresa fallo:", insertError.message);
      await say(chatId, MSG.errorGuardar);
      return;
    }

    const msg = await sendMessage(chatId, MSG.recibidoElegirEmpresa, {
      html: true,
      replyMarkup: kbElegirEmpresa(token, multiempresa.empresas),
    });
    if (msg?.message_id) {
      await svc
        .from("telegram_comprobante_pendientes")
        .update({ message_id: msg.message_id })
        .eq("token", token);
    }
    return;
  }

  await guardarYProcesarComprobanteTelegram({
    chatId,
    empresaId: chat.empresa_id,
    fileId: foto.file_id,
    fileSize: foto.file_size,
    receivedAt,
    sendReceivedMessage: true,
  });
}

export const dynamic = "force-dynamic";
// El OCR (visión) + clasificación corren en after(); darles margen para que no
// se corten a mitad ("This operation was aborted"). Fluid Compute permite 300s.
export const maxDuration = 300;
