/**
 * Bot de Telegram: resumen interactivo de las propuestas que genera un
 * comprobante, con botones para aprobar (→ Agregados) y editar campos.
 *
 * Todo corre con service client scoped a la empresa del chat (el webhook no
 * tiene sesión de usuario). El tipo afecta/exenta es config de la empresa
 * (`tipo_contribuyente`, editable con /config); acá solo se muestra.
 */

import { createHash } from "crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { parseFecha } from "../ai/fecha";
import { sendMessage, type InlineKeyboardMarkup } from "./api";
import { resolverMontoTelegram } from "./deterministico";

function svc() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const EDIT_TTL_MS = 15 * 60 * 1000;

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
  documento_id: string;
  tipo_propuesto: string;
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

export interface MovimientoBot {
  id: string;
  documento_id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: string;
  origen: string | null;
  n_documento: string | null;
}

export interface DuplicadoBot {
  actionId: string;
  estado: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: string;
  n_documento: string | null;
  motivo: string;
}

type DuplicadoDetalle = {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: string;
  n_documento?: string | null;
  motivo?: string;
  oculto?: boolean;
  info_only?: boolean;
  [key: string]: unknown;
};

type Svc = ReturnType<typeof svc>;

const SELECT_PROP =
  "id, tipo_propuesto, total, monto_neto, iva, receptor_nombre, receptor_rut, moneda_origen, monto_moneda_origen, confianza, estado, movimientos_raw!inner(documento_id, descripcion, fecha)";

type RowConMov = {
  id: string;
  tipo_propuesto: string;
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
    documento_id: mov?.documento_id ?? "",
    tipo_propuesto: r.tipo_propuesto,
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

function esPropuestaBoleteable(p: PropuestaBot): boolean {
  return !["gasto", "gasto_egreso", "no_comercial", "ignorar"].includes(p.tipo_propuesto);
}

function duplicateFingerprint(d: Pick<DuplicadoDetalle, "fecha" | "descripcion" | "monto" | "tipo_flujo" | "n_documento">): string {
  const raw = [
    d.fecha,
    Math.round(Number(d.monto) || 0),
    (d.descripcion ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (d.tipo_flujo ?? "entrada").trim().toLowerCase(),
    (d.n_documento ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha1").update(raw).digest("hex");
}

function asDuplicado(raw: unknown): DuplicadoDetalle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Partial<DuplicadoDetalle>;
  const monto = Number(d.monto);
  if (!d.fecha || !d.descripcion || !Number.isFinite(monto)) return null;
  return {
    ...d,
    fecha: String(d.fecha),
    descripcion: String(d.descripcion),
    monto,
    tipo_flujo: String(d.tipo_flujo ?? "entrada"),
    n_documento: d.n_documento ? String(d.n_documento) : null,
    motivo: d.motivo ? String(d.motivo) : "Movimiento ya registrado anteriormente.",
  };
}

export async function auditTelegram(args: {
  empresaId: string;
  chatId?: number | null;
  documentoId?: string | null;
  propuestaId?: string | null;
  action: string;
  metadata?: Json;
}): Promise<void> {
  const { error } = await svc().from("telegram_audit_events").insert({
    empresa_id: args.empresaId,
    chat_id: args.chatId ?? null,
    documento_id: args.documentoId ?? null,
    propuesta_id: args.propuestaId ?? null,
    action: args.action,
    metadata: args.metadata ?? {},
  });
  if (error) console.error("[telegram] audit fallo:", error.message);
}

export async function registrarMensajeTelegram(args: {
  chatId: number;
  empresaId: string;
  messageId: number | null | undefined;
  documentoId?: string | null;
  propuestaId?: string | null;
  kind: "propuesta" | "salida" | "duplicado" | "estado";
  estado?: string;
}): Promise<void> {
  if (!args.messageId) return;
  const { error } = await svc().from("telegram_propuesta_messages").upsert(
    {
      chat_id: args.chatId,
      empresa_id: args.empresaId,
      documento_id: args.documentoId ?? null,
      propuesta_id: args.propuestaId ?? null,
      message_id: args.messageId,
      kind: args.kind,
      estado: args.estado ?? "activo",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id,message_id" },
  );
  if (error) console.error("[telegram] registrarMensaje fallo:", error.message);
}

export async function markMensajeEstado(chatId: number, messageId: number | undefined, estado: string): Promise<void> {
  if (!messageId) return;
  await svc()
    .from("telegram_propuesta_messages")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("message_id", messageId);
}

async function propuestaExistentePorMovimiento(db: Svc, empresaId: string, movimientoId: string): Promise<PropuestaBot | null> {
  const { data } = await db
    .from("propuestas_ia")
    .select(SELECT_PROP)
    .eq("empresa_id", empresaId)
    .eq("movimiento_id", movimientoId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? toBot(data as RowConMov) : null;
}

async function empresaEsExenta(db: Svc, empresaId: string): Promise<boolean> {
  const { data } = await db.from("empresas").select("tipo_contribuyente").eq("id", empresaId).maybeSingle();
  return data?.tipo_contribuyente === "exento";
}

async function crearPropuestaParaMovimiento(args: {
  db: Svc;
  empresaId: string;
  movimientoId: string;
  monto: number;
  notas: string;
}): Promise<PropuestaBot | null> {
  const existente = await propuestaExistentePorMovimiento(args.db, args.empresaId, args.movimientoId);
  if (existente) return existente;

  const total = Math.round(Number(args.monto) || 0);
  const exento = await empresaEsExenta(args.db, args.empresaId);
  const neto = exento ? total : Math.round(total / 1.19);
  const { data, error } = await args.db
    .from("propuestas_ia")
    .insert({
      empresa_id: args.empresaId,
      movimiento_id: args.movimientoId,
      tipo_propuesto: "boleta",
      total,
      monto_neto: neto,
      iva: exento ? 0 : total - neto,
      confianza: 0.7,
      estado: "pendiente",
      notas: args.notas,
      fuente_clasificacion: "telegram_manual",
    })
    .select(SELECT_PROP)
    .single();

  if (error) {
    console.error("[telegram] crearPropuestaParaMovimiento fallo:", error.message);
    return null;
  }
  return toBot(data as RowConMov);
}

/** Propuestas generadas por un documento (vía su movimiento). */
export async function propuestasDeDocumento(documentoId: string, empresaId: string): Promise<PropuestaBot[]> {
  const { data } = await svc()
    .from("propuestas_ia")
    .select(SELECT_PROP)
    .eq("empresa_id", empresaId)
    .eq("movimientos_raw.documento_id", documentoId)
    .order("created_at", { ascending: true });
  return ((data as RowConMov[] | null) ?? []).map(toBot).filter(esPropuestaBoleteable);
}

/** Propuestas pendientes recuperables por /pendientes. */
export async function propuestasPendientesEmpresa(empresaId: string, limit = 10): Promise<PropuestaBot[]> {
  const { data } = await svc()
    .from("propuestas_ia")
    .select(SELECT_PROP)
    .eq("empresa_id", empresaId)
    .in("estado", ["pendiente", "editado"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as RowConMov[] | null) ?? []).map(toBot).filter(esPropuestaBoleteable);
}

/** Movimientos de un documento que no tienen propuesta asociada. */
export async function movimientosSinPropuestaDeDocumento(documentoId: string, empresaId: string): Promise<MovimientoBot[]> {
  const db = svc();
  const { data: movs } = await db
    .from("movimientos_raw")
    .select("id, documento_id, fecha, descripcion, monto, tipo_flujo, origen, n_documento")
    .eq("empresa_id", empresaId)
    .eq("documento_id", documentoId)
    .order("created_at", { ascending: true });
  const rows = (movs ?? []) as MovimientoBot[];
  if (rows.length === 0) return [];

  const { data: props } = await db
    .from("propuestas_ia")
    .select("movimiento_id, tipo_propuesto")
    .eq("empresa_id", empresaId)
    .in("movimiento_id", rows.map((m) => m.id));
  const conProp = new Set(
    (props ?? [])
      .filter((p) => !["gasto", "gasto_egreso", "no_comercial", "ignorar"].includes(p.tipo_propuesto))
      .map((p) => p.movimiento_id),
  );
  return rows.filter((m) => !conProp.has(m.id));
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

function ocrLines(ocrText: string): string[] {
  const basura = new Set([
    "inicio",
    "transferir",
    "pagar",
    "ayuda",
    "reenviar por e-mail",
    "hacer otra transferencia",
    "paso 3/3",
    "comprobante",
  ]);
  return ocrText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^<\s*/, ""))
    .filter(Boolean)
    .filter((line) => !basura.has(line.toLowerCase()));
}

function firstMatch(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function valueAfterLabel(line: string, labels: RegExp[]): string | null {
  for (const label of labels) {
    const match = line.match(new RegExp(`^(?:${label.source})\\s*:?\\s*(.+)$`, "i"));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function firstLabelValue(lines: string[], labels: RegExp[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const inline = valueAfterLabel(lines[i], labels);
    if (inline) return inline;
    if (labels.some((label) => new RegExp(`^(?:${label.source})$`, "i").test(lines[i])) && lines[i + 1]) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

function montoDesdeOcr(lines: string[]): string | null {
  const monto = resolverMontoTelegram(lines).decision?.monto;
  return monto ? CLP(monto) : null;
}

function destinoDesdeOcr(lines: string[]): string | null {
  const cuentaLine = lines.find((line) => /^a la cuenta/i.test(line));
  if (cuentaLine) return cuentaLine.replace(/\s+/g, " ");

  const paraIndex = lines.findIndex((line) => /^para$/i.test(line));
  if (paraIndex >= 0) {
    const bloque = lines.slice(paraIndex + 1, paraIndex + 5).filter((line) => !/^n[uú]mero de operaci[oó]n/i.test(line));
    if (bloque.length > 0) return bloque.join(" · ");
  }
  return null;
}

function fechaDesdeOcr(lines: string[]): string | null {
  return lines.find((line) =>
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(line) ||
    /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(line) ||
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(line)
  ) ?? null;
}

type PartyFields = {
  nombre?: string | null;
  rut?: string | null;
  cuenta?: string | null;
  banco?: string | null;
};

function sectionLines(lines: string[], start: RegExp, stop: RegExp): string[] {
  const idx = lines.findIndex((line) => start.test(line));
  if (idx < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(idx + 1)) {
    if (stop.test(line)) break;
    out.push(line);
  }
  return out.slice(0, 8);
}

function partyFromLines(lines: string[], fallbackNombre?: string | null): PartyFields {
  return {
    nombre: firstLabelValue(lines, [/(?:nombre|titular)\b/]) ?? fallbackNombre ?? null,
    rut: firstLabelValue(lines, [/(?:rut|run)\b/]),
    cuenta: firstLabelValue(lines, [/(?:cuenta|cta)\b/]),
    banco: firstLabelValue(lines, [/banco\b/]),
  };
}

function appendParty(lines: string[], title: string, party: PartyFields): void {
  const entries = [
    ["Nombre", party.nombre],
    ["RUT", party.rut],
    ["Cuenta", party.cuenta],
    ["Banco", party.banco],
  ].filter(([, value]) => Boolean(value));
  if (entries.length === 0) return;
  lines.push("", title);
  for (const [label, value] of entries) lines.push(`${label}: ${value}`);
}

function codigoDesdeOcr(lines: string[]): string | null {
  const inline = firstMatch(lines, /c[oó]digo de transacci[oó]n\s*:?\s*(.+)$/i) ??
    firstMatch(lines, /n[uú]mero de operaci[oó]n(?: de [^:]+)?\s*:?\s*(.+)$/i) ??
    firstMatch(lines, /(?:operaci[oó]n|transacci[oó]n|comprobante)\s*(?:n[°ºo.]*)?\s*:?\s*([a-z0-9?_-]{6,})$/i);
  if (inline) return inline;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/c[oó]digo|operaci[oó]n|transacci[oó]n|comprobante/i.test(lines[i]) && /^[a-z0-9?_-]{6,}$/i.test(lines[i + 1])) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

type ComprobanteLeidoOptions = {
  resultado?: string;
  motivo?: string;
  monto?: number | null;
  fecha?: string | null;
};

function appendIf(lines: string[], label: string, value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === "") return;
  lines.push(`${label}: ${value}`);
}

function resumenOcrComprobante(ocrText: string, options: ComprobanteLeidoOptions = {}): string {
  const lines = ocrLines(ocrText);
  const status = lines.find((line) => /realizad[ao].*(éxito|exito)|transferencia.*éxito|transferencia.*exito/i.test(line));
  const monto = typeof options.monto === "number" ? CLP(options.monto) : montoDesdeOcr(lines);
  const destino = destinoDesdeOcr(lines);
  const origen = firstLabelValue(lines, [/(?:de|desde|origen|remitente|pagador)\b/]);
  const codigo = codigoDesdeOcr(lines);
  const email = firstMatch(lines, /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  const fecha = options.fecha ?? fechaDesdeOcr(lines);
  const mensaje = firstLabelValue(lines, [/(?:mensaje|comentario|glosa|asunto|concepto|motivo)\b/]);
  const origenSection = sectionLines(lines, /datos.*(?:origen|emisor|remitente|pagador)|^origen$/i, /datos.*(?:destinatario|destino|beneficiario|receptor)|^destino$|^para$|^monto|^fecha|^c[oó]digo|^operaci[oó]n/i);
  const destinoSection = sectionLines(lines, /datos.*(?:destinatario|destino|beneficiario|receptor)|^destino$|^para$/i, /datos.*(?:origen|emisor|remitente|pagador)|^origen$|^de$|^monto|^fecha|^c[oó]digo|^operaci[oó]n/i);
  const origenParty = partyFromLines(origenSection, origen);
  const destinoParty = partyFromLines(destinoSection, destino);

  const copyLines: string[] = [];
  appendIf(copyLines, "Tipo", "Transferencia bancaria");
  appendIf(copyLines, "Resultado", options.resultado ?? status);
  appendIf(copyLines, "Monto", monto);
  appendIf(copyLines, "Fecha", fecha);
  appendParty(copyLines, "Origen", origenParty);
  appendParty(copyLines, "Destino", destinoParty);
  appendIf(copyLines, "Código", codigo);
  appendIf(copyLines, "Mensaje", mensaje);
  appendIf(copyLines, "Copia enviada a", email);
  appendIf(copyLines, "Motivo", options.motivo);

  const header = "📄 <b>Comprobante leído</b>";
  const blockPrefix = "\n<pre>";
  const blockSuffix = "</pre>";
  const raw = copyLines.join("\n");
  const maxRawLength = Math.max(0, 3500 - header.length - blockPrefix.length - blockSuffix.length - 12);
  const rawVisible = raw.length > maxRawLength ? `${raw.slice(0, maxRawLength)}\n…` : raw;

  return header + blockPrefix + esc(rawVisible) + blockSuffix;
}

/** Mensaje "📄 Leí esto" — resumen ordenado del OCR. Una vez por foto. */
export function mensajeLeiEsto(ocrText: string, options?: ComprobanteLeidoOptions): string {
  return resumenOcrComprobante(ocrText, options).slice(0, 3500);
}

export function mensajeMovimientoSinBoleta(m: MovimientoBot): { text: string; keyboard?: InlineKeyboardMarkup } {
  if (m.tipo_flujo === "salida") {
    return {
      text:
        "🛒 <b>Esto parece una COMPRA</b> (plata que enviaste), no una venta.\n" +
        `• Monto: <b>${CLP(m.monto)}</b>\n` +
        `• Fecha: ${esc(m.fecha)}\n` +
        `• Detalle: ${esc(m.descripcion)}\n\n` +
        "massDTE es <b>solo de ventas</b>: una compra no genera boleta.\n" +
        "¿Esto es un <b>ingreso (venta)</b> tuyo, o una <b>compra</b>?",
      keyboard: kbMovimientoSinBoleta(m.id),
    };
  }
  return {
    text:
      "ℹ️ <b>Detecté un movimiento, pero no una boleta para emitir.</b>\n" +
      `• Monto: <b>${CLP(m.monto)}</b>\n` +
      `• Fecha: ${esc(m.fecha)}\n` +
      `• Detalle: ${esc(m.descripcion)}`,
  };
}

// Confirmación "¿seguro que es venta?" mostrando el PORQUÉ (la descripción leída),
// antes de convertir una salida en boleta. Sales-only: pensar dos veces antes de emitir.
export function mensajeConfirmarIngreso(m: MovimientoBot): { text: string; keyboard: InlineKeyboardMarkup } {
  return {
    text:
      "⚠️ <b>¿Seguro que es una VENTA?</b>\n\n" +
      "Lo leí como <b>compra</b> (plata que enviaste):\n" +
      `<i>${esc(m.descripcion)}</i>\n\n` +
      "Seguí solo si de verdad fue un <b>pago que recibiste</b> por una venta. Ahí te creo la boleta.",
    keyboard: kbConfirmarIngreso(m.id),
  };
}

// Confirmación "¿seguro que es compra?" antes de descartarla (no emite boleta).
export function mensajeConfirmarCompra(m: MovimientoBot): { text: string; keyboard: InlineKeyboardMarkup } {
  return {
    text:
      "🛒 <b>¿Seguro que es una compra?</b>\n\n" +
      `<i>${esc(m.descripcion)}</i>\n\n` +
      "Si es compra la <b>descarto</b> del flujo — massDTE es solo de ventas, no emite boleta.",
    keyboard: kbConfirmarCompra(m.id),
  };
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
  lines.push("\n✅ Aprobar la deja lista en Agregados; <b>no emite al SII</b>.");
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
    [{ text: "🪪 RUT", callback_data: `ec:${propId}:r` }, { text: "📅 Fecha", callback_data: `ec:${propId}:f` }],
    [{ text: "↩︎ Volver", callback_data: `bk:${propId}` }],
  ] };
}

// Ask inicial sobre una salida: ¿ingreso (venta) o compra? (sales-only).
export function kbMovimientoSinBoleta(movId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "💰 Es ingreso (venta)", callback_data: `mv:${movId}:i1` }],
    [{ text: "🛒 Es compra", callback_data: `mv:${movId}:c1` }],
  ] };
}

// Override a ingreso → doble confirmación (muestra el porqué antes de emitir).
export function kbConfirmarIngreso(movId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "✅ Sí, es venta — emitir boleta", callback_data: `mv:${movId}:i2` }],
    [{ text: "↩︎ No, volver", callback_data: `mv:${movId}:bk` }],
  ] };
}

// Confirmar compra → doble confirmación antes de descartar.
export function kbConfirmarCompra(movId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "✓ Sí, es compra — descartar", callback_data: `mv:${movId}:c2` }],
    [{ text: "↩︎ No, volver", callback_data: `mv:${movId}:bk` }],
  ] };
}

export function kbDuplicado(actionId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "🗑️ Descartar", callback_data: `du:${actionId}:d` }],
    [{ text: "✅ Aceptar igual", callback_data: `du:${actionId}:a1` }],
  ] };
}

export function kbConfirmarDuplicado(actionId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: "Sí, aceptar duplicado", callback_data: `du:${actionId}:a2` }],
    [{ text: "No, volver", callback_data: `du:${actionId}:bk` }],
  ] };
}

const CAMPO_LABEL: Record<string, string> = { m: "el monto", c: "el nombre del cliente", r: "el RUT del cliente", f: "la fecha" };

export function labelCampo(codigo: string): string {
  return CAMPO_LABEL[codigo] ?? "el dato";
}

/** Valor actual de un campo, para el prompt "X actual: …". */
export function valorActual(p: PropuestaBot, codigo: string): string {
  if (codigo === "m") return CLP(p.total ?? 0);
  if (codigo === "c") return p.receptor_nombre ?? "(sin nombre)";
  if (codigo === "r") return p.receptor_rut ?? "(sin RUT)";
  if (codigo === "f") return p.fecha || "(sin fecha)";
  return "";
}

export type AprobarBotResult = "aprobado" | "ya_aprobado" | "estado_invalido" | "no_encontrada";

/** Aprueba la propuesta (queda en Agregados). No emite al SII. Idempotente. */
export async function aprobarBot(propId: string, empresaId: string): Promise<AprobarBotResult> {
  const db = svc();
  const { count } = await db
    .from("propuestas_ia")
    .update({ estado: "aprobado" }, { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("id", propId)
    .in("estado", ["pendiente", "editado"]);
  if ((count ?? 0) > 0) return "aprobado";

  const { data } = await db
    .from("propuestas_ia")
    .select("estado")
    .eq("empresa_id", empresaId)
    .eq("id", propId)
    .maybeSingle();
  if (!data) return "no_encontrada";
  if (data.estado === "aprobado") return "ya_aprobado";
  return "estado_invalido";
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
  const db = svc();
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
  } else if (codigo === "f") {
    const fecha = parseFecha(valor);
    const { data: propRow } = await db
      .from("propuestas_ia")
      .select("movimiento_id")
      .eq("empresa_id", empresaId)
      .eq("id", propId)
      .maybeSingle();
    if (!propRow?.movimiento_id) return { ok: false, error: "No encontré el movimiento de esa boleta." };

    const { error: movError, count: movCount } = await db
      .from("movimientos_raw")
      .update({ fecha }, { count: "exact" })
      .eq("empresa_id", empresaId)
      .eq("id", propRow.movimiento_id);
    if (movError || !movCount) return { ok: false, error: "No pude guardar la fecha. Probá de nuevo." };
  } else {
    return { ok: false, error: "Campo desconocido." };
  }

  const { error, count } = await db
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
    { chat_id: chatId, propuesta_id: propId, campo: codigo, message_id: messageId, created_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );
}

export async function getPendingEdit(chatId: number): Promise<{ propuesta_id: string; campo: string; message_id: number | null } | null> {
  const { data } = await svc()
    .from("telegram_pending_edits")
    .select("propuesta_id, campo, message_id, created_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > EDIT_TTL_MS) {
    await clearPendingEdit(chatId);
    return null;
  }
  return data;
}

export async function clearPendingEdit(chatId: number): Promise<void> {
  await svc().from("telegram_pending_edits").delete().eq("chat_id", chatId);
}

async function removeDuplicadoFromProgreso(db: Svc, documentoId: string, fingerprint: string): Promise<void> {
  const { data: doc } = await db
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .maybeSingle();
  const progreso = doc?.progreso_ia;
  if (!progreso || typeof progreso !== "object" || Array.isArray(progreso)) return;

  const detalleRaw = (progreso as Record<string, unknown>).duplicados_detalle;
  if (!Array.isArray(detalleRaw)) return;

  const updated = detalleRaw.filter((raw) => {
    const d = asDuplicado(raw);
    return !d || duplicateFingerprint(d) !== fingerprint;
  });
  if (updated.length === detalleRaw.length) return;

  await db
    .from("documentos_subidos")
    .update({
      progreso_ia: {
        ...(progreso as Record<string, unknown>),
        duplicados_detalle: updated.length > 0 ? updated : undefined,
        duplicados_saltados: updated.filter((raw) => asDuplicado(raw) && !asDuplicado(raw)?.info_only).length,
      } as Json,
    })
    .eq("id", documentoId);
}

async function ensureDuplicateAction(empresaId: string, documentoId: string, detalle: DuplicadoDetalle): Promise<DuplicadoBot | null> {
  const fp = duplicateFingerprint(detalle);
  const { data, error } = await svc()
    .from("telegram_duplicate_actions")
    .upsert(
      {
        empresa_id: empresaId,
        documento_id: documentoId,
        fingerprint: fp,
        detalle: detalle as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,documento_id,fingerprint" },
    )
    .select("id, estado, detalle")
    .single();
  if (error || !data) {
    console.error("[telegram] ensureDuplicateAction fallo:", error?.message);
    return null;
  }
  const d = asDuplicado(data.detalle);
  if (!d) return null;
  return {
    actionId: data.id,
    estado: data.estado,
    fecha: d.fecha,
    descripcion: d.descripcion,
    monto: d.monto,
    tipo_flujo: d.tipo_flujo,
    n_documento: d.n_documento ?? null,
    motivo: d.motivo ?? "Movimiento ya registrado anteriormente.",
  };
}

export async function duplicadosDeDocumento(documentoId: string, empresaId: string): Promise<DuplicadoBot[]> {
  const { data: doc } = await svc()
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const progreso = doc?.progreso_ia;
  if (!progreso || typeof progreso !== "object" || Array.isArray(progreso)) return [];
  const detalleRaw = (progreso as Record<string, unknown>).duplicados_detalle;
  if (!Array.isArray(detalleRaw)) return [];

  const out: DuplicadoBot[] = [];
  for (const raw of detalleRaw) {
    const d = asDuplicado(raw);
    if (!d || d.oculto || d.info_only || d.tipo_flujo !== "entrada") continue;
    const action = await ensureDuplicateAction(empresaId, documentoId, d);
    if (action && action.estado !== "descartado" && action.estado !== "aceptado") out.push(action);
  }
  return out;
}

export function mensajeDuplicado(d: DuplicadoBot): { text: string; keyboard: InlineKeyboardMarkup } {
  return {
    text:
      "⚠️ <b>Esto parece un duplicado.</b>\n" +
      `• Monto: <b>${CLP(d.monto)}</b>\n` +
      `• Fecha: ${esc(d.fecha)}\n` +
      `• Detalle: ${esc(d.descripcion)}\n` +
      (d.n_documento ? `• Código: ${esc(d.n_documento)}\n` : "") +
      `\n${esc(d.motivo)}\n\n` +
      "Podés descartarlo o aceptarlo igual. Si aceptás, te voy a pedir confirmación otra vez porque puede duplicar una boleta.",
    keyboard: kbDuplicado(d.actionId),
  };
}

export async function setDuplicadoMessage(actionId: string, empresaId: string, messageId: number | null | undefined): Promise<void> {
  if (!messageId) return;
  await svc()
    .from("telegram_duplicate_actions")
    .update({ message_id: messageId, updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("empresa_id", empresaId);
}

export async function prepararConfirmacionDuplicado(actionId: string, empresaId: string): Promise<DuplicadoBot | null> {
  const db = svc();
  await db
    .from("telegram_duplicate_actions")
    .update({ estado: "confirmando", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("empresa_id", empresaId)
    .eq("estado", "pendiente");
  const { data } = await db
    .from("telegram_duplicate_actions")
    .select("id, estado, detalle")
    .eq("id", actionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const d = asDuplicado(data?.detalle);
  if (!data || !d) return null;
  return {
    actionId: data.id,
    estado: data.estado,
    fecha: d.fecha,
    descripcion: d.descripcion,
    monto: d.monto,
    tipo_flujo: d.tipo_flujo,
    n_documento: d.n_documento ?? null,
    motivo: d.motivo ?? "Movimiento ya registrado anteriormente.",
  };
}

export async function descartarDuplicadoBot(actionId: string, empresaId: string, chatId: number): Promise<"descartado" | "ya_descartado" | "ya_aceptado" | "no_encontrado"> {
  const db = svc();
  const { data: current } = await db
    .from("telegram_duplicate_actions")
    .select("estado, documento_id, fingerprint")
    .eq("id", actionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!current) return "no_encontrado";
  if (current.estado === "aceptado") return "ya_aceptado";
  if (current.estado === "descartado") return "ya_descartado";

  await db
    .from("telegram_duplicate_actions")
    .update({ estado: "descartado", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("empresa_id", empresaId);
  await removeDuplicadoFromProgreso(db, current.documento_id, current.fingerprint);
  await auditTelegram({ empresaId, chatId, documentoId: current.documento_id, action: "telegram_descarto_duplicado", metadata: { actionId } });
  return "descartado";
}

export async function aceptarDuplicadoBot(actionId: string, empresaId: string, chatId: number): Promise<{ estado: "aceptado" | "ya_aceptado"; prop: PropuestaBot | null } | { estado: "procesando" | "descartado" | "no_encontrado" | "error"; error?: string }> {
  const db = svc();
  const { count } = await db
    .from("telegram_duplicate_actions")
    .update({ estado: "procesando", updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", actionId)
    .eq("empresa_id", empresaId)
    .in("estado", ["pendiente", "confirmando"]);

  const { data: action } = await db
    .from("telegram_duplicate_actions")
    .select("id, estado, documento_id, fingerprint, detalle, movimiento_id, propuesta_id")
    .eq("id", actionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!action) return { estado: "no_encontrado" };
  if ((count ?? 0) === 0) {
    if (action.estado === "aceptado" && action.propuesta_id) {
      return { estado: "ya_aceptado", prop: await propuestaPorId(action.propuesta_id, empresaId) };
    }
    if (action.estado === "descartado") return { estado: "descartado" };
    return { estado: "procesando" };
  }

  const d = asDuplicado(action.detalle);
  if (!d) return { estado: "error", error: "Detalle inválido" };

  try {
    let movimientoId = action.movimiento_id;
    if (!movimientoId) {
      const { data: mov, error: movError } = await db
        .from("movimientos_raw")
        .insert({
          empresa_id: empresaId,
          documento_id: action.documento_id,
          fecha: parseFecha(d.fecha),
          descripcion: d.descripcion,
          monto: d.monto,
          tipo_flujo: d.tipo_flujo || "entrada",
          n_documento: d.n_documento ?? null,
          origen: null,
        })
        .select("id")
        .single();
      if (movError || !mov) throw new Error(movError?.message ?? "No pude guardar el movimiento duplicado");
      movimientoId = mov.id;
    }

    const prop = await crearPropuestaParaMovimiento({
      db,
      empresaId,
      movimientoId,
      monto: d.monto,
      notas: "Aceptado desde Telegram como duplicado confirmado",
    });
    await db
      .from("telegram_duplicate_actions")
      .update({
        estado: "aceptado",
        movimiento_id: movimientoId,
        propuesta_id: prop?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId)
      .eq("empresa_id", empresaId);
    await removeDuplicadoFromProgreso(db, action.documento_id, action.fingerprint);
    await auditTelegram({ empresaId, chatId, documentoId: action.documento_id, propuestaId: prop?.id ?? null, action: "telegram_acepto_duplicado", metadata: { actionId } });
    return { estado: "aceptado", prop };
  } catch (err) {
    await db
      .from("telegram_duplicate_actions")
      .update({ estado: "confirmando", updated_at: new Date().toISOString() })
      .eq("id", actionId)
      .eq("empresa_id", empresaId)
      .eq("estado", "procesando");
    return { estado: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function movimientoPorId(movId: string, empresaId: string): Promise<MovimientoBot | null> {
  const { data } = await svc()
    .from("movimientos_raw")
    .select("id, documento_id, fecha, descripcion, monto, tipo_flujo, origen, n_documento")
    .eq("empresa_id", empresaId)
    .eq("id", movId)
    .maybeSingle();
  return data as MovimientoBot | null;
}

export async function ignorarMovimientoSalidaBot(
  movId: string,
  empresaId: string,
  chatId: number,
): Promise<"ignorado" | "ya_no_existe" | "no_es_salida" | "con_propuesta"> {
  const db = svc();
  const mov = await movimientoPorId(movId, empresaId);
  if (!mov) return "ya_no_existe";
  if (mov.tipo_flujo !== "salida") return "no_es_salida";

  const { data: props } = await db
    .from("propuestas_ia")
    .select("id, tipo_propuesto")
    .eq("empresa_id", empresaId)
    .eq("movimiento_id", movId)
  const boleteables = (props ?? []).filter((p) => !["gasto", "gasto_egreso", "no_comercial", "ignorar"].includes(p.tipo_propuesto));
  if (boleteables.length > 0) return "con_propuesta";
  const noBoleteables = (props ?? []).map((p) => p.id);
  if (noBoleteables.length > 0) {
    await db.from("propuestas_ia").delete().eq("empresa_id", empresaId).in("id", noBoleteables);
  }

  await db
    .from("movimientos_raw")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("id", movId)
    .eq("tipo_flujo", "salida");

  const { data: doc } = await db
    .from("documentos_subidos")
    .select("progreso_ia, movimientos_detectados")
    .eq("empresa_id", empresaId)
    .eq("id", mov.documento_id)
    .maybeSingle();
  const progreso = doc?.progreso_ia && typeof doc.progreso_ia === "object" && !Array.isArray(doc.progreso_ia)
    ? doc.progreso_ia as Record<string, unknown>
    : {};
  await db
    .from("documentos_subidos")
    .update({
      movimientos_detectados: Math.max(0, (doc?.movimientos_detectados ?? 1) - 1),
      progreso_ia: {
        ...progreso,
        telegram_estado: "ignorado_no_ingreso",
        telegram_ignorado_at: new Date().toISOString(),
      } as Json,
    })
    .eq("empresa_id", empresaId)
    .eq("id", mov.documento_id);

  await auditTelegram({
    empresaId,
    chatId,
    documentoId: mov.documento_id,
    action: "telegram_ignoro_salida_no_ingreso",
    metadata: { movId, monto: mov.monto, descripcion: mov.descripcion },
  });

  return "ignorado";
}

export async function convertirMovimientoEnIngresoBot(movId: string, empresaId: string, chatId: number): Promise<PropuestaBot | null> {
  const db = svc();
  const mov = await movimientoPorId(movId, empresaId);
  if (!mov) return null;
  await db
    .from("movimientos_raw")
    .update({ tipo_flujo: "entrada" })
    .eq("empresa_id", empresaId)
    .eq("id", mov.id);
  const prop = await crearPropuestaParaMovimiento({
    db,
    empresaId,
    movimientoId: mov.id,
    monto: mov.monto,
    notas: "Usuario confirmó desde Telegram que la transferencia era ingreso propio",
  });
  await auditTelegram({ empresaId, chatId, documentoId: mov.documento_id, propuestaId: prop?.id ?? null, action: "telegram_convirtio_salida_en_ingreso", metadata: { movId } });
  return prop;
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
  const duplicados = await duplicadosDeDocumento(documentoId, empresaId);
  const movimientosSinPropuesta = await movimientosSinPropuestaDeDocumento(documentoId, empresaId);

  if (props.length === 0 && duplicados.length === 0 && movimientosSinPropuesta.length === 0) {
    await sendMessage(
      chatId,
      "✅ Lo dejé en <b>Agregados</b>.\nNo detecté una boleta para emitir en este comprobante.",
      { html: true },
    );
    return;
  }
  const tipo = tipoBoletaDeContribuyente(await tipoContribuyenteEmpresa(empresaId));
  const primerProp = props[0];
  const primerDuplicado = duplicados[0];
  const primerMovimiento = movimientosSinPropuesta[0];
  const resumen = primerProp
    ? { resultado: "Pago recibido", monto: primerProp.total, fecha: primerProp.fecha }
    : primerDuplicado
      ? { resultado: "Duplicado detectado", monto: primerDuplicado.monto, fecha: primerDuplicado.fecha, motivo: primerDuplicado.motivo }
      : primerMovimiento
        ? {
            resultado: primerMovimiento.tipo_flujo === "salida" ? "Transferencia enviada" : "Movimiento detectado",
            monto: primerMovimiento.monto,
            fecha: primerMovimiento.fecha,
          }
        : undefined;
  await sendMessage(chatId, mensajeLeiEsto(ocrText, resumen), { html: true });
  for (const p of props) {
    const { text, keyboard } = mensajeBoleta(p, tipo);
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await registrarMensajeTelegram({
      chatId,
      empresaId,
      messageId: msg?.message_id,
      documentoId,
      propuestaId: p.id,
      kind: "propuesta",
    });
  }
  for (const d of duplicados) {
    const { text, keyboard } = mensajeDuplicado(d);
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await setDuplicadoMessage(d.actionId, empresaId, msg?.message_id);
    await registrarMensajeTelegram({
      chatId,
      empresaId,
      messageId: msg?.message_id,
      documentoId,
      kind: "duplicado",
    });
  }
  for (const m of movimientosSinPropuesta) {
    const { text, keyboard } = mensajeMovimientoSinBoleta(m);
    const msg = await sendMessage(chatId, text, { html: true, replyMarkup: keyboard });
    await registrarMensajeTelegram({
      chatId,
      empresaId,
      messageId: msg?.message_id,
      documentoId,
      kind: "salida",
    });
  }
}
