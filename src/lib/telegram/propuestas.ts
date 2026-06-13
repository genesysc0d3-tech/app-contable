/**
 * Bot de Telegram: resumen interactivo de las propuestas que genera un
 * comprobante, con botones para aprobar (→ Agregados) y editar campos.
 *
 * Todo corre con service client scoped a la empresa del chat (el webhook no
 * tiene sesión de usuario). El tipo afecta/exenta es config de la empresa
 * (`tipo_contribuyente`, editable con /config); acá solo se muestra.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sendMessage, type InlineKeyboardMarkup } from "@/lib/telegram/api";

function svc() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

/** Escapa texto para parse_mode HTML (el OCR puede traer < > &). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type TipoBoleta = "afecta" | "exenta";

/** Tipo de boleta por defecto según la config de la empresa. */
export function tipoBoletaDeContribuyente(tipoContribuyente: string | null): TipoBoleta {
  return tipoContribuyente === "exento" ? "exenta" : "afecta";
}

/** Convierte "$190.000", "190.000" o "190000" a número CLP. */
export function parseMontoClp(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PropuestaBot {
  id: string;
  total: number | null;
  monto_neto: number | null;
  iva: number | null;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  moneda_origen: string | null;
  monto_moneda_origen: number | null;
  confianza: number | null;
  estado: string;
  descripcion: string;
  fecha: string;
}

const SELECT_PROP =
  "id, total, monto_neto, iva, receptor_nombre, receptor_rut, moneda_origen, monto_moneda_origen, confianza, estado, movimientos_raw!inner(documento_id, descripcion, fecha)";

type RowConMov = {
  id: string;
  total: number | null;
  monto_neto: number | null;
  iva: number | null;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  moneda_origen: string | null;
  monto_moneda_origen: number | null;
  confianza: number | null;
  estado: string;
  movimientos_raw: { documento_id: string; descripcion: string; fecha: string } | { documento_id: string; descripcion: string; fecha: string }[] | null;
};

function toBot(r: RowConMov): PropuestaBot {
  const mov = Array.isArray(r.movimientos_raw) ? r.movimientos_raw[0] : r.movimientos_raw;
  return {
    id: r.id,
    total: r.total,
    monto_neto: r.monto_neto,
    iva: r.iva,
    receptor_nombre: r.receptor_nombre,
    receptor_rut: r.receptor_rut,
    moneda_origen: r.moneda_origen,
    monto_moneda_origen: r.monto_moneda_origen,
    confianza: r.confianza,
    estado: r.estado,
    descripcion: mov?.descripcion ?? "",
    fecha: mov?.fecha ?? "",
  };
}

/** Propuestas generadas por un documento (vía su movimiento). */
export async function propuestasDeDocumento(documentoId: string, empresaId: string): Promise<PropuestaBot[]> {
  const { data } = await svc()
    .from("propuestas_ia")
    .select(SELECT_PROP)
    .eq("empresa_id", empresaId)
    .eq("movimientos_raw.documento_id", documentoId)
    .order("created_at", { ascending: true });
  return ((data as RowConMov[] | null) ?? []).map(toBot);
}

/** Una propuesta por id (para re-mostrar tras editar). */
export async function propuestaPorId(propId: string, empresaId: string): Promise<PropuestaBot | null> {
  const { data } = await svc()
    .from("propuestas_ia")
    .select(SELECT_PROP)
    .eq("empresa_id", empresaId)
    .eq("id", propId)
    .maybeSingle();
  return data ? toBot(data as RowConMov) : null;
}

/** tipo_contribuyente de la empresa (para mostrar el tipo de boleta). */
export async function tipoContribuyenteEmpresa(empresaId: string): Promise<string | null> {
  const { data } = await svc().from("empresas").select("tipo_contribuyente").eq("id", empresaId).maybeSingle();
  return data?.tipo_contribuyente ?? null;
}

/** Mensaje "📄 Leí esto" — el texto crudo del OCR, copiable. Una vez por foto. */
export function mensajeLeiEsto(ocrText: string): string {
  const limpio = ocrText.trim().slice(0, 3500);
  return "📄 <b>Leí esto del comprobante:</b>\n\n" + esc(limpio);
}

/** Mensaje "🧾 Boleta" + botones [Editar][Aprobar] (o estado si ya aprobada). */
export function mensajeBoleta(p: PropuestaBot, tipo: TipoBoleta): { text: string; keyboard?: InlineKeyboardMarkup } {
  const total = p.total ?? 0;
  const lines: string[] = ["🧾 <b>Boleta a generar:</b>"];
  lines.push(`• Tipo: <b>${tipo === "exenta" ? "Exenta (41)" : "Afecta (39)"}</b>`);
  if (tipo === "afecta") {
    const neto = Math.round(total / 1.19);
    lines.push(`• Neto ${CLP(neto)} · IVA ${CLP(total - neto)}`);
  }
  lines.push(`• Total: <b>${CLP(total)}</b>`);
  if (p.moneda_origen && p.monto_moneda_origen) {
    lines.push(`• Origen: ${p.monto_moneda_origen} ${esc(p.moneda_origen)}`);
  }
  lines.push(`• Cliente: ${p.receptor_nombre ? esc(p.receptor_nombre) : "consumidor final"}${p.receptor_rut ? ` (${esc(p.receptor_rut)})` : ""}`);

  if (p.estado === "aprobado") {
    return { text: lines.join("\n") + "\n\n✅ <b>Aprobada</b> — está en Agregados, lista para emitir." };
  }
  if (p.estado === "descartado" || p.estado === "rechazado") {
    return { text: lines.join("\n") + "\n\n🗑️ <b>Descartada.</b>" };
  }
  return { text: lines.join("\n"), keyboard: kbResumen(p.id) };
}

// --- Keyboards (callback_data corto: <acción>:<propId>[:<campo>]) ---

export function kbResumen(propId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[
    { text: "✏️ Editar", callback_data: `ed:${propId}` },
    { text: "✅ Aprobar", callback_data: `ap:${propId}` },
  ]] };
}

export function kbCampos(propId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "💰 Monto", callback_data: `ec:${propId}:m` }, { text: "👤 Cliente", callback_data: `ec:${propId}:c` }],
    [{ text: "🪪 RUT", callback_data: `ec:${propId}:r` }, { text: "↩︎ Volver", callback_data: `bk:${propId}` }],
  ] };
}

const CAMPO_LABEL: Record<string, string> = { m: "el monto", c: "el nombre del cliente", r: "el RUT del cliente" };

export function labelCampo(codigo: string): string {
  return CAMPO_LABEL[codigo] ?? "el dato";
}

/** Valor actual de un campo, para el prompt "X actual: …". */
export function valorActual(p: PropuestaBot, codigo: string): string {
  if (codigo === "m") return CLP(p.total ?? 0);
  if (codigo === "c") return p.receptor_nombre ?? "(sin nombre)";
  if (codigo === "r") return p.receptor_rut ?? "(sin RUT)";
  return "";
}

/** Aprueba la propuesta (queda en Agregados). No emite al SII. */
export async function aprobarBot(propId: string, empresaId: string): Promise<boolean> {
  const { count } = await svc()
    .from("propuestas_ia")
    .update({ estado: "aprobado" }, { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("id", propId);
  return (count ?? 0) > 0;
}

/**
 * Edita un campo de la propuesta (mismo efecto que editarPropuesta de la app,
 * pero con service client). Devuelve la propuesta actualizada o un error.
 */
export async function editarCampoBot(
  propId: string,
  empresaId: string,
  codigo: string,
  valorRaw: string,
  tipo: TipoBoleta,
): Promise<{ ok: true; prop: PropuestaBot } | { ok: false; error: string }> {
  const update: Record<string, string | number | null> = { estado: "editado" };
  const valor = valorRaw.trim();

  if (codigo === "m") {
    const total = parseMontoClp(valor);
    if (total === null) return { ok: false, error: "Ese monto no se entiende. Mandame solo el número, ej: 180000" };
    update.total = total;
    if (tipo === "afecta") {
      const neto = Math.round(total / 1.19);
      update.monto_neto = neto;
      update.iva = total - neto;
    } else {
      update.monto_neto = total;
      update.iva = 0;
    }
  } else if (codigo === "c") {
    update.receptor_nombre = valor || null;
  } else if (codigo === "r") {
    update.receptor_rut = valor || null;
  } else {
    return { ok: false, error: "Campo desconocido." };
  }

  const { error, count } = await svc()
    .from("propuestas_ia")
    .update(update, { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("id", propId);
  if (error || !count) return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };

  const prop = await propuestaPorId(propId, empresaId);
  if (!prop) return { ok: false, error: "No encontré la propuesta." };
  return { ok: true, prop };
}

// --- Edición pendiente (qué campo está editando un chat) ---

export async function setPendingEdit(chatId: number, propId: string, codigo: string, messageId: number | null): Promise<void> {
  await svc().from("telegram_pending_edits").upsert(
    { chat_id: chatId, propuesta_id: propId, campo: codigo, message_id: messageId },
    { onConflict: "chat_id" },
  );
}

export async function getPendingEdit(chatId: number): Promise<{ propuesta_id: string; campo: string; message_id: number | null } | null> {
  const { data } = await svc()
    .from("telegram_pending_edits")
    .select("propuesta_id, campo, message_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data ?? null;
}

export async function clearPendingEdit(chatId: number): Promise<void> {
  await svc().from("telegram_pending_edits").delete().eq("chat_id", chatId);
}

/** Cambia el tipo de boleta de la empresa (config global, vía /config). */
export async function setTipoContribuyente(empresaId: string, tipo: "afecto" | "exento"): Promise<boolean> {
  const { count } = await svc()
    .from("empresas")
    .update({ tipo_contribuyente: tipo }, { count: "exact" })
    .eq("id", empresaId);
  return (count ?? 0) > 0;
}

/**
 * Tras procesar un comprobante: manda "📄 Leí esto" (OCR completo, copiable)
 * una vez, y luego una "🧾 Boleta" con botones por cada operación detectada.
 */
export async function enviarResumenPropuestas(
  chatId: number,
  documentoId: string,
  empresaId: string,
  ocrText: string,
): Promise<void> {
  const props = await propuestasDeDocumento(documentoId, empresaId);
  await sendMessage(chatId, `DBG4 resumen: ${props.length} propuesta(s) para el doc`);
  if (props.length === 0) {
    await sendMessage(
      chatId,
      "✅ Lo dejé en <b>Agregados</b>.\nNo detecté una boleta para emitir en este comprobante.",
      { html: true },
    );
    return;
  }
  const tipo = tipoBoletaDeContribuyente(await tipoContribuyenteEmpresa(empresaId));
  await sendMessage(chatId, mensajeLeiEsto(ocrText), { html: true });
  for (const p of props) {
    const { text, keyboard } = mensajeBoleta(p, tipo);
    await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
  }
}
