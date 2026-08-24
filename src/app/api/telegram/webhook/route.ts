import { NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  abrirSesion,
  sesionDe,
  elegirEmpresa as sesionElegirEmpresa,
  elegirMesa as sesionElegirMesa,
  cerrarSesion,
  recordarMensaje,
  type EmpresaOpcion,
  type Sesion,
} from "@/lib/telegram/sesion";
import { contextoCuentaPorEmpresa, telegramHabilitadoEmpresa } from "@/lib/entitlements";
import { esRolEmision } from "@/lib/auth/roles";
import { enqueueDocumentProcessingJob } from "@/lib/document-processing/queue";
import { iniciarDrenaje } from "@/lib/document-processing/drain";
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
  mensajeConfirmarIngreso,
  mensajeConfirmarCompra,
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
// Fotos que se usan de UN álbum. Un comprobante P2P real son 2-4 capturas (Binance,
// el banco propio, el del cliente). Telegram permite álbumes de 10, y cada foto de
// más es una subida a R2 + una llamada de OCR por la MISMA venta: multiplica el
// costo por 10 sin agregar información. Se corta antes de bajar la foto.
const MAX_FOTOS_ALBUM = 4;

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
  demasiadasFotos:
    `📸 Máximo <b>${MAX_FOTOS_ALBUM} imágenes</b> por comprobante.\n` +
    "No procesé ninguna. Elige las que muestran la operación y mándamelas de nuevo.",
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
  sesionSaludo:
    "👋 <b>Hola.</b> ¿Con qué empresa vamos a trabajar?",
  sesionElegirMesa: (empresa: string) =>
    `🏢 Elegiste <b>${empresa}</b>.\n¿Qué vamos a hacer?`,
  sesionMandaFotos: (mesa: string) =>
    `📸 Dale, mándame las imágenes del comprobante para la <b>${mesa}</b>.\n` +
    `Hasta <b>${MAX_FOTOS_ALBUM}</b>, y con eso armo la propuesta.`,
  sesionCancelada:
    "✅ Listo, cancelado. Cuando quieras, escríbeme y partimos de nuevo.",
  sesionVencida:
    "⌛ Pasó mucho rato y cerré la sesión.\nEscríbeme y partimos de nuevo.",
  sesionFacturaAunNo:
    "🧾 Las facturas todavía no están listas — muy pronto.\nPor ahora te puedo dejar la boleta.",
  sesionListo: (mesa: string, monto: string, cuando: string) =>
    `✅ <b>Listo: ${mesa} ${monto}</b>\n` +
    `${cuando} — quedó en tu mesa.\n\n` +
    "Recuerda revisarla en la app para emitirla.",
  fotoSinSesion:
    "👋 <b>Hola.</b> Antes de la foto necesito saber dos cosas.\n¿Con qué empresa vamos a trabajar?",
  soloFotos:
    "📸 Solo proceso <b>fotos de comprobantes</b>.\n" +
    "Mándame la foto y la dejo en Agregados, lista para boletear.",
  noEnPlan:
    "🔒 <b>Telegram es parte del plan Pro.</b>\n" +
    "Tu plan actual no incluye comprobantes por Telegram.\n" +
    "Actívalo en massDTE → Empresa → Plan y vuelve a mandarme la foto.",
  reemplazado:
    "🔄 <b>Esta empresa se conectó desde otro Telegram.</b>\n" +
    "Este chat quedó desconectado y ya no puede mandar comprobantes.\n" +
    "Si no fuiste tú, revisa quién tiene acceso en massDTE → <b>Empresa → Bot de Telegram</b>.",
  sinPermisos:
    "🔒 <b>Este chat quedó desconectado.</b>\n" +
    "La cuenta que lo vinculó ya no tiene permisos de emisión en esta empresa.\n" +
    "Un usuario habilitado puede reconectarlo desde massDTE → <b>Empresa → Bot de Telegram</b>.",
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

/**
 * ¿El usuario que vinculó el chat sigue habilitado para operar esta empresa?
 * El chat HEREDA los permisos de quien lo vinculó: si a esa persona la vetan,
 * le bajan el rol o la sacan de la cuenta, el chat muere con ella (misma
 * filosofía fail-closed del resto del circuito de emisión). Multiempresa
 * Business: basta ser miembro activo de la cuenta dueña de la empresa (el
 * titular puede tener otra empresa activa en la app sin perder su Telegram).
 */
async function vinculadorHabilitado(svc: Svc, usuarioId: string | null, empresaId: string): Promise<boolean> {
  if (!usuarioId) return false; // vinculador borrado (FK set null) → chat huérfano, se corta
  const { data: u } = await svc
    .from("usuarios")
    .select("empresa_id, rol, vetado")
    .eq("id", usuarioId)
    .maybeSingle();
  if (!u || u.vetado === true || !esRolEmision(u.rol)) return false;
  if (u.empresa_id === empresaId) return true;
  const ctx = await contextoCuentaPorEmpresa(svc, empresaId);
  if (!ctx) return false;
  const { data: m } = await svc
    .from("cuenta_usuarios")
    .select("activo")
    .eq("cuenta_id", ctx.cuentaId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  return Boolean(m?.activo);
}

/**
 * empresa_id del chat si está vinculado, activo Y su vinculador sigue
 * habilitado; si no, null. La revalidación corre en CADA uso del bot (no solo
 * al vincular): un chat cuyo dueño perdió permisos se desactiva al tiro y se
 * le avisa — antes quedaba emitiendo para siempre (hallazgo 2026-08-22).
 */
async function empresaDelChat(chatId: number): Promise<string | null> {
  const svc = getServiceClient();
  const { data } = await svc
    .from("telegram_chats")
    .select("empresa_id, activo, usuario_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data?.activo) return null;
  if (!(await vinculadorHabilitado(svc, data.usuario_id, data.empresa_id))) {
    await svc.from("telegram_chats").update({ activo: false }).eq("chat_id", chatId);
    await say(chatId, MSG.sinPermisos);
    return null;
  }
  return data.empresa_id;
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

// --- Flujo con sesión: hola → empresa → mesa → fotos ------------------------
//
// Se pregunta ANTES de recibir fotos. Así la sesión —y no el `media_group_id`
// que arma Telegram— es la que dice qué imágenes son el MISMO comprobante, sin
// depender de si el usuario las mandó de una o una por una.

/** Botones de empresa + Cancelar. Con UNA empresa igual se muestra el botón. */
function kbSesionEmpresas(token: string, opciones: EmpresaOpcion[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...opciones.map((e, i) => [{
        text: [e.rut, e.nombre].filter(Boolean).join(" - ") || "Empresa",
        callback_data: `ses:emp:${token}:${i}`,
      }]),
      [{ text: "✖️ Cancelar", callback_data: `ses:cancel:${token}` }],
    ],
  };
}

/**
 * Boleta / Factura / Cancelar.
 *
 * Factura se MUESTRA pero apagada: su mesa todavía no existe (no hay columna de
 * mesa ni carril de emisión 33/34). Se enciende sola cuando exista, sin tocar el
 * bot de nuevo — el esquema ya acepta mesa='factura'.
 */
function kbSesionMesa(token: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🧾 Boleta", callback_data: `ses:mesa:${token}:boleta` }],
      [{ text: "📄 Factura (pronto)", callback_data: `ses:mesa:${token}:factura` }],
      [{ text: "✖️ Cancelar", callback_data: `ses:cancel:${token}` }],
    ],
  };
}

/**
 * Arranca (o reinicia) el flujo: muestra las empresas del chat.
 * `textoInicial` cambia si el disparador fue un saludo o una foto suelta.
 */
async function iniciarSesionChat(chatId: number, textoInicial: string): Promise<void> {
  const svc = getServiceClient();
  const empresaChat = await empresaDelChat(chatId);
  if (!empresaChat) {
    await say(chatId, MSG.noVinculado);
    return;
  }
  if (!(await telegramHabilitadoEmpresa(svc, empresaChat))) {
    await say(chatId, MSG.noEnPlan);
    return;
  }

  // Business con varias empresas → todas; si no, la del chat (igual con botón).
  const multi = await empresasParaTelegramMultiempresa(svc, empresaChat).catch(() => null);
  let opciones: EmpresaOpcion[] = multi?.empresas ?? [];
  if (opciones.length === 0) {
    const { data } = await svc
      .from("empresas")
      .select("id, rut, razon_social")
      .eq("id", empresaChat)
      .maybeSingle();
    opciones = [{ id: empresaChat, rut: data?.rut ?? null, nombre: data?.razon_social ?? null }];
  }

  const sesion = await abrirSesion(svc, chatId, opciones);
  if (!sesion) {
    await say(chatId, MSG.errorGuardar);
    return;
  }
  const msg = await sendMessage(chatId, textoInicial, {
    html: true,
    replyMarkup: kbSesionEmpresas(sesion.token, opciones),
  });
  if (msg?.message_id) await recordarMensaje(svc, chatId, msg.message_id);
}

/** Callbacks del flujo: ses:emp / ses:mesa / ses:cancel. */
async function handleSesionCallback(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
  data: string,
): Promise<void> {
  const svc = getServiceClient();
  const [, accion, token, valor] = data.split(":");

  const sesion: Sesion | null = await sesionDe(svc, chatId);
  if (!sesion || sesion.token !== token) {
    // Botón de un menú viejo: la sesión ya venció o fue reemplazada.
    if (messageId) await editMessageText(chatId, messageId, MSG.sesionVencida, { html: true });
    await answerCallbackQuery(callbackId, "Esa sesión ya no está activa.");
    return;
  }

  if (accion === "cancel") {
    await cerrarSesion(svc, chatId);
    if (messageId) await editMessageText(chatId, messageId, MSG.sesionCancelada, { html: true });
    await answerCallbackQuery(callbackId, "Cancelado");
    return;
  }

  if (accion === "emp") {
    const elegida = await sesionElegirEmpresa(svc, chatId, token, Number(valor));
    if (!elegida) { await answerCallbackQuery(callbackId, "No encontré esa empresa."); return; }
    const nombre = [elegida.empresa.rut, elegida.empresa.nombre].filter(Boolean).join(" - ") || "esa empresa";
    if (messageId) {
      await editMessageText(chatId, messageId, MSG.sesionElegirMesa(nombre), {
        html: true,
        replyMarkup: kbSesionMesa(token),
      });
    }
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "mesa") {
    // La mesa de facturas no existe todavía: se avisa y la sesión sigue en pie
    // para que pueda elegir boleta sin empezar de nuevo.
    if (valor === "factura") {
      await answerCallbackQuery(callbackId, "Facturas: muy pronto");
      await say(chatId, MSG.sesionFacturaAunNo);
      return;
    }
    const lista = await sesionElegirMesa(svc, chatId, token, "boleta");
    if (!lista) { await answerCallbackQuery(callbackId, "No pude continuar."); return; }
    if (messageId) await editMessageText(chatId, messageId, MSG.sesionMandaFotos("boleta"), { html: true });
    await answerCallbackQuery(callbackId);
    return;
  }

  await answerCallbackQuery(callbackId);
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

  // Responder 200 AL INSTANTE y procesar en after() (post-respuesta). Telegram entrega
  // el álbum EN ORDEN y espera el 200 de CADA foto antes de mandar la siguiente; si
  // tardáramos en responder (plan + inserts + OCR), escalonaría las fotos varios
  // segundos y la ventana del álbum se asentaría en el hueco → perdería fotos. Con el
  // 200 inmediato las fotos llegan casi juntas y el creador las junta bien.
  // SIEMPRE 200 (si Telegram no recibe ok reintenta el update infinito → duplicaría).
  let update: TelegramUpdate | null = null;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch (error) {
    console.error("[telegram-webhook] parse error:", error);
    return NextResponse.json({ ok: true });
  }
  const upd = update;
  after(async () => {
    try {
      if (upd?.message) await handleMessage(upd.message);
      else if (upd?.callback_query) await handleCallback(upd.callback_query);
    } catch (error) {
      console.error("[telegram-webhook] error:", error);
    }
  });
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

  // El cliente corta (o rechaza) la intervención de soporte desde el chat —
  // el mismo canal por donde le llegó el código de permiso.
  if (text === "/revocar") {
    const empresaId = await empresaDelChat(chatId);
    if (!empresaId) {
      await say(chatId, MSG.noVinculado);
      return;
    }
    const svcRevocar = getServiceClient();
    const { terminarIntervencion } = await import("@/lib/dev/intervencion");
    const res = await terminarIntervencion(svcRevocar, empresaId);
    if (res.habia) {
      const { recordCuentaAudit } = await import("@/lib/audit/account");
      await recordCuentaAudit({
        sb: svcRevocar,
        empresaId,
        accion: "soporte_intervencion_revocada",
        recursoTipo: "soporte_intervencion",
        resumen: "El cliente revocó la intervención de soporte desde Telegram",
      });
      await say(chatId, "✂️ <b>Listo, corté el acceso de soporte.</b>\nNadie puede tocar tus datos.");
    } else {
      await say(chatId, "✅ No hay ningún acceso de soporte activo ni pendiente. Todo tranquilo.");
    }
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
    // Sin sesión abierta la foto NO se procesa (ni OCR ni storage): se abre el
    // flujo y se le pide lo que falta. Es la puerta de entrada más probable —
    // a las 11 de la noche nadie escribe "hola", pega la captura y ya.
    const sesion = await sesionDe(getServiceClient(), chatId);
    if (!sesion?.empresa_id || !sesion.mesa) {
      await iniciarSesionChat(chatId, MSG.fotoSinSesion);
      return;
    }
    await recibirComprobante(chatId, msg.photo, msg.date, msg.media_group_id, sesion);
    return;
  }

  // Cualquier texto suelto (un "hola", un "buenas") arranca el flujo.
  await iniciarSesionChat(chatId, MSG.sesionSaludo);
}

// --- Botones (callback_query): aprobar / editar / volver / config ---

async function handleCallback(cq: TelegramCallbackQuery) {
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  const data = cq.data ?? "";
  if (!chatId) { await answerCallbackQuery(cq.id); return; }

  const empresaId = await empresaDelChat(chatId);
  if (!empresaId) { await answerCallbackQuery(cq.id, "Tu Telegram no está conectado."); return; }

  if (data.startsWith("ses:")) {
    await handleSesionCallback(chatId, messageId, cq.id, data);
    return;
  }

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
    // Cierre del flujo: decirle DÓNDE quedó y que todavía falta emitirla — el bot
    // deja propuesta, no emite. Y se cierra la sesión: el comprobante terminó.
    if (status === "aprobado" && prop) {
      const svcCierre = getServiceClient();
      const sesion = await sesionDe(svcCierre, chatId);
      const monto = typeof prop.total === "number"
        ? "$" + Math.round(prop.total).toLocaleString("es-CL")
        : "";
      const cuando = new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date());
      await say(chatId, MSG.sesionListo(sesion?.mesa ?? "boleta", monto, cuando));
      if (sesion) await cerrarSesion(svcCierre, chatId);
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
      const text = mensajeBoleta(prop, tipo).text + "\n\n¿Qué quieres cambiar?";
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

  if (accion === "d" || accion === "c2") {
    const status = await ignorarMovimientoSalidaBot(movId, empresaId, chatId);
    const text = status === "con_propuesta"
      ? "⚠️ Esta operación ya tiene una propuesta asociada. Revisala en Agregados."
      : "🛒 <b>Marcada como compra.</b>\nNo emití boleta y la quité del flujo (massDTE es solo de ventas).";
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true });
    await markMensajeEstado(chatId, messageId, "descartado");
    await answerCallbackQuery(callbackId, status === "ignorado" ? "Descartada" : "Ya estaba resuelto");
    return;
  }

  if (accion === "i1") {
    const { text, keyboard } = mensajeConfirmarIngreso(mov);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await answerCallbackQuery(callbackId);
    return;
  }

  if (accion === "c1") {
    const { text, keyboard } = mensajeConfirmarCompra(mov);
    const edited = messageId ? await editMessageText(chatId, messageId, text, { html: true, replyMarkup: keyboard }) : false;
    if (!edited) await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
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

  // Ya estamos dentro del after() del POST → trabajo pesado directo (sin anidar after()).
  await guardarYProcesarComprobanteTelegram({
    chatId,
    empresaId: selected.id,
    fileId: pending.file_id,
    fileSize: pending.file_size,
    receivedAt: pending.received_at ?? undefined,
    pendingToken: token,
    sendReceivedMessage: false,
  });
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
    await say(chatId, "✅ No tienes boletas pendientes para revisar por ahora.");
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
    "Elige el tipo (también lo puedes cambiar en massDTE → Empresa):"
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

  // Regla: 1 empresa = 1 chat activo (índice único parcial en la base).
  // Vincular un Telegram nuevo es un TAKEOVER explícito: los chats activos
  // anteriores de la empresa se desactivan primero (libera el índice) y se
  // les avisa — así nunca queda un tercero emitiendo en silencio.
  const { data: anteriores } = await svc
    .from("telegram_chats")
    .select("chat_id")
    .eq("empresa_id", linkToken.empresa_id)
    .eq("activo", true)
    .neq("chat_id", chatId);
  const chatsAnteriores = (anteriores ?? []).map((c) => c.chat_id);
  if (chatsAnteriores.length > 0) {
    const { error: bajaError } = await svc
      .from("telegram_chats")
      .update({ activo: false })
      .in("chat_id", chatsAnteriores);
    if (bajaError) {
      // Fail-closed: si no se pudo desactivar al anterior, NO se vincula el
      // nuevo (el índice único además lo rechazaría con dos activos).
      console.error("[telegram-webhook] baja de chats anteriores fallo:", bajaError.message);
      await say(chatId, MSG.errorVincular);
      return;
    }
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
  // Avisar a los desconectados DESPUÉS de consolidar el nuevo vínculo (si el
  // upsert hubiera fallado, no queremos haber gritado un takeover que no fue).
  for (const anterior of chatsAnteriores) {
    try { await say(anterior, MSG.reemplazado); } catch { /* chat cerrado/bloqueado: da igual */ }
  }
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

    // Dentro del after() del POST → corremos el OCR directo (sin anidar after()).
    await run();
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

// Una foto de un álbum (v1: chats de una empresa). Sube a R2, deja su imagen en el
// buffer e intenta ser el "creador" (único por empresa+media_group_id). El creador
// espera un debounce a que lleguen las hermanas y encola UN job multi-imagen = 1 venta.
/**
 * ¿Este álbum fue rechazado por pasarse del tope de fotos?
 *
 * La marca vive en el `documentos_subidos` del álbum (índice único por
 * empresa+media_group_id), no en el buffer: así también BLOQUEA que una foto
 * tardía cree un álbum nuevo con las sobras del rechazado.
 */
async function albumRechazado(svc: Svc, empresaId: string, mediaGroupId: string): Promise<boolean> {
  const { data } = await svc
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("empresa_id", empresaId)
    .eq("media_group_id", mediaGroupId)
    .maybeSingle();
  const prog = data?.progreso_ia;
  return Boolean(prog && typeof prog === "object" && !Array.isArray(prog) && (prog as Record<string, unknown>).error === "album_excede_tope");
}

async function recibirAlbumFoto(chatId: number, empresaId: string, foto: TelegramPhotoSize, mediaGroupId: string) {
  const svc = getServiceClient();

  if (!(await telegramHabilitadoEmpresa(svc, empresaId))) { await say(chatId, MSG.noEnPlan); return; }

  const nombre = nombreComprobanteTelegram();
  // Parte SÍNCRONA mínima (para responder 200 RÁPIDO): registrar la foto en el buffer
  // + intentar crear el doc creador. La descarga+subida pesada va a after().
  // Por qué importa: Telegram entrega el álbum EN ORDEN y espera el 200 de cada foto
  // antes de mandar la siguiente; si el handler tarda (download+upload ~3s), escalona
  // las fotos varios segundos y la ventana se asienta en el hueco → pierde fotos.
  // 200 rápido ⇒ todas las fotos llegan casi juntas ⇒ la ventana las junta.
  const { data: bufRow, error: bufErr } = await svc
    .from("telegram_album_buffer")
    .insert({ empresa_id: empresaId, media_group_id: mediaGroupId, image: { pending: true } as Json })
    .select("id, created_at")
    .single();
  if (bufErr || !bufRow) return;

  // Tope de fotos por álbum. Se rankea por antigüedad (cada foto cuenta las que
  // llegaron ANTES que ella) en vez de un count() a secas: las fotos del álbum
  // llegan en webhooks distintos y concurrentes, y un count compartido haría que
  // dos se descartaran mutuamente. Rankear sólo puede admitir una de más ante un
  // empate exacto de created_at, nunca perder una que iba dentro del tope.
  const { count: fotosPrevias } = await svc
    .from("telegram_album_buffer")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("media_group_id", mediaGroupId)
    .lt("created_at", bufRow.created_at);
  if ((fotosPrevias ?? 0) >= MAX_FOTOS_ALBUM) {
    // Se RECHAZA el álbum entero, no se recortan las primeras 4: procesar un
    // subconjunto silencioso emitiría una propuesta sobre evidencia parcial sin
    // que nadie sepa qué quedó afuera. Telegram manda las fotos del álbum en
    // serie (espera el 200 de cada una), así que para cuando llega la 5ª el
    // documento creador ya existe y la marca lo alcanza.
    await svc.from("telegram_album_buffer").delete().eq("id", bufRow.id);
    await svc
      .from("documentos_subidos")
      .update({ estado: "error", progreso_ia: { estado: "error", error: "album_excede_tope" } as Json })
      .eq("empresa_id", empresaId)
      .eq("media_group_id", mediaGroupId);
    // Un solo aviso por álbum: lo manda la PRIMERA que se pasa del tope.
    if ((fotosPrevias ?? 0) === MAX_FOTOS_ALBUM) await say(chatId, MSG.demasiadasFotos);
    return;
  }

  // Intentar ser el creador (índice único por empresa+media_group_id). Instantáneo;
  // el storage_path real se completa tras la subida en after().
  const { data: doc } = await svc
    .from("documentos_subidos")
    .insert({
      empresa_id: empresaId,
      nombre_archivo: `Álbum ${nombre}`,
      tipo: "imagen",
      storage_path: "album",
      storage_provider: "r2",
      estado: "subido",
      media_group_id: mediaGroupId,
      fuente_datos: "telegram",
      progreso_ia: { origen: "telegram", album: true } as Json,
    })
    .select("id")
    .single();
  const esCreador = Boolean(doc);

  if (esCreador && doc) {
    // Tope diario (un álbum cuenta como 1 comprobante).
    if ((await contarComprobantesTelegramHoy(empresaId)) > TOPE_DIARIO) {
      await svc.from("documentos_subidos").delete().eq("id", doc.id);
      await svc.from("telegram_album_buffer").delete().eq("id", bufRow.id);
      await say(chatId, MSG.topeDiario);
      return;
    }
    await say(chatId, "📸 Álbum recibido — leo las fotos y te muestro la boleta en unos segundos.");
  }

  // Ya corremos dentro del after() del POST (el 200 ya salió). Trabajo pesado directo
  // (IIFE awaited): subir esta foto y, si soy el creador, esperar a las hermanas.
  await (async () => {
    const svc2 = getServiceClient();

    // Si una foto posterior ya rechazó el álbum, esta no se sube: el corte tiene
    // que pasar ANTES de R2 y del OCR, que es lo que cuesta.
    if (await albumRechazado(svc2, empresaId, mediaGroupId)) {
      await svc2.from("telegram_album_buffer").delete().eq("id", bufRow.id);
      return;
    }

    // (TODAS las fotos) descargar + subir ESTA foto a R2 y completar su fila del buffer.
    try {
      const foto64 = await getFileBase64(foto.file_id);
      if (foto64.size > MAX_FOTO_BYTES) {
        await svc2.from("telegram_album_buffer").delete().eq("id", bufRow.id);
      } else {
        const up = await subirDocumentoR2(empresaId, `album_${mediaGroupId}_${nombre}`, Buffer.from(foto64.base64, "base64"), foto64.mime);
        await svc2.from("telegram_album_buffer").update({ image: { path: up.key, mime: foto64.mime, name: nombre } as Json }).eq("id", bufRow.id);
        if (esCreador && doc) await svc2.from("documentos_subidos").update({ storage_path: up.key }).eq("id", doc.id);
      }
    } catch {
      await svc2.from("telegram_album_buffer").delete().eq("id", bufRow.id);
    }

    if (!esCreador || !doc) return; // los no-creadores solo suben su foto

    // Creador: ventana — esperar a que lleguen TODAS las fotos y terminen de subir
    // (image.path), y recién ahí encolar UN job con todas = 1 venta.
    const SETTLE_MS = 3000, MAX_WAIT_MS = 60000, POLL_MS = 750;
    const inicio = Date.now();
    let filas: Array<{ id: string; image: Json; created_at: string }> = [];
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { data } = await svc2
        .from("telegram_album_buffer")
        .select("id, image, created_at")
        .eq("empresa_id", empresaId)
        .eq("media_group_id", mediaGroupId);
      filas = (data ?? []) as Array<{ id: string; image: Json; created_at: string }>;
      if (filas.length === 0) return;
      // Rechazado a mitad de la ventana: limpiar el buffer y NO encolar. El doc
      // ya quedó en error y el aviso al chat lo mandó la foto que se pasó.
      if (await albumRechazado(svc2, empresaId, mediaGroupId)) {
        await svc2.from("telegram_album_buffer").delete().in("id", filas.map((f) => f.id));
        return;
      }
      const conPath = (img: Json) => Boolean(img && typeof img === "object" && !Array.isArray(img) && (img as Record<string, unknown>).path);
      const todasSubidas = filas.every((f) => conPath(f.image));
      const ultima = Math.max(...filas.map((f) => new Date(f.created_at).getTime()));
      if (todasSubidas && Date.now() - ultima >= SETTLE_MS) break; // todas registradas + subidas + asentado
      if (Date.now() - inicio >= MAX_WAIT_MS) break;               // tope de seguridad
    }
    const grouped = filas.map((f) => f.image).filter((img) => img && typeof img === "object" && !Array.isArray(img) && (img as Record<string, unknown>).path);
    if (grouped.length === 0) return;
    try {
      const job = await enqueueDocumentProcessingJob(svc2, {
        documentoId: doc.id, empresaId, usuarioId: null, tipo: "imagen", storagePath: (grouped[0] as Record<string, unknown>).path as string,
        metadata: { grouped_images: grouped, origen: "telegram", album: true, chat_id: chatId },
      });
      await svc2.from("documentos_subidos").update({ estado: "procesando", progreso_ia: { estado: "queued", job_id: job.id, origen: "telegram", album: true } as Json, album_imagenes: grouped as Json }).eq("id", doc.id);
      // delete-by-id (no por grupo): una foto que llegue entre la lectura y el borrado sobrevive en el buffer (la rescata el reaper).
      await svc2.from("telegram_album_buffer").delete().in("id", filas.map((f) => f.id));
      // Drenaje en invocación FRESCA vía /kick: el webhook ya gastó parte de sus
      // 300s bajando fotos; el worker nuevo parte con presupuesto completo y, si el
      // modelo es lento, hace yield con checkpoint y se encadena solo. La boleta la
      // manda el worker al chat (clasificarComprobanteTelegram con chat_id).
      await iniciarDrenaje("telegram-album-kick").catch(() => {});
    } catch {
      await svc2.from("documentos_subidos").update({ estado: "error", progreso_ia: { estado: "error", error: "No se pudo encolar el álbum" } as Json }).eq("id", doc.id);
      await say(chatId, MSG.errorGuardar);
    }
  })();
}

async function recibirComprobante(
  chatId: number,
  photos: TelegramPhotoSize[],
  receivedAt?: number,
  mediaGroupId?: string,
  sesion?: Sesion,
) {
  const svc = getServiceClient();

  // Chat no vinculado = CERO procesamiento (ni OCR ni storage): el costo
  // y el abuso se cortan acá. empresaDelChat además REVALIDA al vinculador
  // (vetado/rol/miembro) y desactiva el chat si perdió permisos.
  const empresaChat = await empresaDelChat(chatId);
  if (!empresaChat) {
    await say(chatId, MSG.noVinculado);
    return;
  }
  const chat = { empresa_id: empresaChat };

  // Gate de plan: Start no incluye Telegram. Único choke point (cubre foto suelta,
  // álbum y multiempresa) y corta el costo de OCR/storage antes de trabajar.
  if (!(await telegramHabilitadoEmpresa(svc, chat.empresa_id))) {
    await say(chatId, MSG.noEnPlan);
    return;
  }

  // Telegram manda los tamaños de menor a mayor: el último es la mejor resolución.
  const foto = photos[photos.length - 1];
  if ((foto.file_size ?? 0) > MAX_FOTO_BYTES) {
    await say(chatId, MSG.muyGrande);
    return;
  }

  // Con sesión abierta la empresa YA la eligió el usuario, así que no hay nada
  // que preguntar. Y todas las fotos se agrupan por el TOKEN de la sesión en vez
  // del media_group_id de Telegram: así da lo mismo si las mandó de una o una
  // por una — lo que las une es que el usuario abrió un comprobante, no cómo las
  // empaquetó la app. De paso, el tope de 4 pasa a ser del comprobante.
  if (sesion?.empresa_id && sesion.mesa) {
    if (sesion.empresa_id !== chat.empresa_id) {
      // Multiempresa: la sesión manda, pero solo dentro de la misma cuenta.
      const permitida = sesion.opciones.some((o) => o.id === sesion.empresa_id);
      if (!permitida) { await say(chatId, MSG.sinPermisos); return; }
    }
    await recibirAlbumFoto(chatId, sesion.empresa_id, foto, `ses_${sesion.token}`);
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
