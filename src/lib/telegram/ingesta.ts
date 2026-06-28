/**
 * Ingesta de comprobantes que llegan por Telegram.
 *
 * Replica EXACTAMENTE la ingesta de imágenes del panel
 * (/api/subir-procesar con tipo "imagen"), reutilizando los mismos módulos:
 * insert en documentos_subidos + upload a Storage "documentos" +
 * OCR Mistral (ocrAndGroupImages) + clasificación (procesarDocumento).
 * La única diferencia es que acá no hay sesión de usuario (webhook), así
 * que todo va con service client scoped a la empresa del chat vinculado.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { defaultStorageProvider, subirDocumentoR2 } from "@/lib/storage";
import { procesarDocumento } from "@/lib/ai/processor";
import { sendMessage } from "@/lib/telegram/api";
import { enviarResumenPropuestas, mensajeLeiEsto, registrarMensajeTelegram } from "@/lib/telegram/propuestas";
import { chileDateString, chileDayStartUtc } from "@/lib/chile-date";
import {
  destinoDesdeTextoTelegram,
  fechaDesdeTextoTelegram,
  lineasOcrTelegram,
  nombreContraparteTelegram,
  origenDesdeTextoTelegram,
  resolverDireccionTelegram,
  resolverMontoTelegram,
} from "@/lib/telegram/deterministico";

/** Comprobante ilegible (foto borrosa/oscura): pedir screenshot en el momento. */
const MSG_ILEGIBLE =
  "😕 <b>No pude leer ese comprobante.</b>\n" +
  "Mándame un <b>screenshot nítido</b> (no una foto de la pantalla) y lo proceso al toque.";

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaApareceEnTexto(text: string, fechaIso: string): boolean {
  const [year, monthRaw, dayRaw] = fechaIso.split("-");
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return false;
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const monthName = MESES[month - 1];
  const candidates = [
    `${year}-${mm}-${dd}`,
    `${dd}/${mm}/${year}`,
    `${dd}-${mm}-${year}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day} de ${monthName} ${year}`,
    `${day} ${monthName} ${year}`,
  ];
  return candidates.some((c) => normalized.includes(c));
}

function extraerCodigoTransaccion(text: string): string | null {
  const patterns = [
    /c[oó]digo\s+de\s+transacci[oó]n\s*:?\s*([a-z0-9?_-]+)/i,
    /n[uú]mero\s+de\s+operaci[oó]n(?:\s+de\s+[^\n]+)?\s*:?\s*([a-z0-9?_-]+)/i,
    /operaci[oó]n\s*(?:n[°ºo.]*)?\s*:?\s*([a-z0-9-]{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().toUpperCase();
  }
  return null;
}

async function normalizarMovimientosTelegram(
  svc: ReturnType<typeof getServiceClient>,
  documentoId: string,
  empresaId: string,
  ocrText: string,
  fechaFallback: string,
): Promise<void> {
  const { data: movs } = await svc
    .from("movimientos_raw")
    .select("id, fecha, n_documento")
    .eq("documento_id", documentoId)
    .eq("empresa_id", empresaId);
  const rows = movs ?? [];
  if (rows.length === 0) return;

  const codigo = rows.length === 1 ? extraerCodigoTransaccion(ocrText) : null;
  for (const mov of rows) {
    const update: { fecha?: string; n_documento?: string } = {};
    if (!fechaApareceEnTexto(ocrText, mov.fecha)) update.fecha = fechaFallback;
    if (codigo && !mov.n_documento) update.n_documento = codigo;
    if (Object.keys(update).length > 0) {
      await svc.from("movimientos_raw").update(update).eq("id", mov.id).eq("empresa_id", empresaId);
    }
  }
}

type ParsedComprobanteTelegram = {
  fecha: string;
  fechaVisible: boolean;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  descripcion: string;
  n_documento: string | null;
  diagnostico: Record<string, Json>;
};

type ParseDeterministicoResult =
  | { kind: "parsed"; parsed: ParsedComprobanteTelegram }
  | { kind: "ambiguous"; motivo: string; diagnostico: Record<string, Json> }
  | { kind: "unrecognized" };

async function cargarIdentidadesEmpresa(
  svc: ReturnType<typeof getServiceClient>,
  empresaId: string,
): Promise<string[]> {
  const { data: emp } = await svc
    .from("empresas")
    .select("razon_social, rut")
    .eq("id", empresaId)
    .maybeSingle();
  const { data: identidades } = await svc
    .from("empresa_identidades")
    .select("valor")
    .eq("empresa_id", empresaId);
  return [emp?.razon_social, emp?.rut, ...(identidades ?? []).map((i) => i.valor)]
    .filter((v): v is string => Boolean(v));
}

async function parseComprobanteTelegramDeterministico(
  svc: ReturnType<typeof getServiceClient>,
  empresaId: string,
  ocrText: string,
  fechaFallback: string,
): Promise<ParseDeterministicoResult> {
  const lines = lineasOcrTelegram(ocrText);
  const text = lines.join("\n");
  const pareceTransferencia = /transferenc|recibiste|pagaste|abono|monto\s+transferid|a la cuenta|cuenta destino|destinatario/i.test(text);
  const pareceComprobante = /comprobante/i.test(text);
  if (!pareceTransferencia && !pareceComprobante) return { kind: "unrecognized" };

  const monto = resolverMontoTelegram(lines);
  if (!monto.decision) {
    if (!pareceTransferencia) return { kind: "unrecognized" };
    return {
      kind: "ambiguous",
      motivo: monto.ambiguous ? "monto_conflictivo" : "monto_sin_consenso",
      diagnostico: {
        monto_parser: monto.diagnostics as Json,
      },
    };
  }

  const destino = destinoDesdeTextoTelegram(lines);
  const origen = origenDesdeTextoTelegram(lines);
  const identidades = await cargarIdentidadesEmpresa(svc, empresaId);
  const direccion = resolverDireccionTelegram({ text, destino, origen, identidades });
  if (!direccion) {
    if (!pareceTransferencia) return { kind: "unrecognized" };
    return {
      kind: "ambiguous",
      motivo: "direccion_sin_consenso",
      diagnostico: {
        monto_elegido: monto.decision.monto,
        linea_monto: monto.decision.linea_monto,
        monto_parser: monto.diagnostics as Json,
        direccion_parser: { destino_detectado: destino, origen_detectado: origen } as Json,
      },
    };
  }

  const fecha = fechaDesdeTextoTelegram(lines, fechaFallback);
  const contraparte = direccion.tipo_flujo === "entrada"
    ? nombreContraparteTelegram(origen || "cliente")
    : nombreContraparteTelegram(destino || "destinatario");
  return {
    kind: "parsed",
    parsed: {
      fecha: fecha.fecha,
      fechaVisible: fecha.visible,
      monto: monto.decision.monto,
      tipo_flujo: direccion.tipo_flujo,
      descripcion: direccion.tipo_flujo === "entrada"
        ? `Transferencia recibida de ${contraparte} por $${monto.decision.monto.toLocaleString("es-CL")}`
        : `Transferencia a ${contraparte} por $${monto.decision.monto.toLocaleString("es-CL")}`,
      n_documento: extraerCodigoTransaccion(text),
      diagnostico: {
        monto_elegido: monto.decision.monto,
        linea_monto: monto.decision.linea_monto,
        candidatos_descartados: monto.diagnostics.candidatos_descartados as Json,
        consenso_monto: monto.diagnostics as Json,
        direccion_decision: direccion as unknown as Json,
        fecha_elegida: fecha.fecha,
        fecha_visible: fecha.visible,
        linea_fecha: fecha.linea ?? null,
        decision_fecha: fecha.decision,
      },
    },
  };
}

async function procesarComprobanteDeterministico(
  svc: ReturnType<typeof getServiceClient>,
  documentoId: string,
  empresaId: string,
  parsed: ParsedComprobanteTelegram,
): Promise<boolean> {
  const { data: existentes } = await svc
    .from("movimientos_raw")
    .select("id, fecha, monto, descripcion, n_documento, documento_id, documentos_subidos(nombre_archivo, created_at)")
    .eq("empresa_id", empresaId);

  const duplicate = (existentes ?? []).find((m) => {
    if (m.documento_id === documentoId) return false;
    if (parsed.n_documento && m.n_documento === parsed.n_documento && Number(m.monto) === parsed.monto) return true;
    return m.fecha === parsed.fecha && Number(m.monto) === parsed.monto && m.descripcion === parsed.descripcion;
  });

  if (duplicate) {
    const doc = Array.isArray(duplicate.documentos_subidos)
      ? duplicate.documentos_subidos[0]
      : duplicate.documentos_subidos;
    await svc
      .from("documentos_subidos")
      .update({
        estado: "procesado",
        movimientos_detectados: 0,
        progreso_ia: {
          estado: "completado",
          origen: "telegram",
          parser: "deterministico_telegram",
          ...parsed.diagnostico,
          movimientos_encontrados: 1,
          duplicados_saltados: 1,
          duplicados_detalle: [{
            fecha: parsed.fecha,
            descripcion: parsed.descripcion,
            monto: parsed.monto,
            tipo_flujo: parsed.tipo_flujo,
            n_documento: parsed.n_documento,
            tipo: parsed.n_documento ? "mismo_ndoc_otro_arch" : "loose_otro_arch",
            origen_movimiento_id: duplicate.id,
            origen_documento_nombre: doc?.nombre_archivo ?? "Documento anterior",
            origen_documento_fecha: doc?.created_at ?? "",
            motivo: parsed.n_documento
              ? `Código de transacción ${parsed.n_documento} ya existe en '${doc?.nombre_archivo ?? "Documento anterior"}'.`
              : `Mismo monto, fecha y descripción ya existen en '${doc?.nombre_archivo ?? "Documento anterior"}'.`,
          }],
        } as Json,
      })
      .eq("id", documentoId)
      .eq("empresa_id", empresaId);
    return true;
  }

  const { data: mov, error: movError } = await svc
    .from("movimientos_raw")
    .insert({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parsed.fecha,
      descripcion: parsed.descripcion,
      monto: parsed.monto,
      tipo_flujo: parsed.tipo_flujo,
      origen: "telegram",
      n_documento: parsed.n_documento,
    })
    .select("id")
    .single();
  if (movError || !mov) {
    console.error("[telegram] parser determinístico insert movimiento fallo:", movError?.message);
    return false;
  }

  if (parsed.tipo_flujo === "entrada") {
    const { data: emp } = await svc
      .from("empresas")
      .select("tipo_contribuyente")
      .eq("id", empresaId)
      .maybeSingle();
    const exento = emp?.tipo_contribuyente === "exento";
    const neto = exento ? parsed.monto : Math.round(parsed.monto / 1.19);
    const { error: propError } = await svc.from("propuestas_ia").insert({
      empresa_id: empresaId,
      movimiento_id: mov.id,
      estado: "pendiente",
      tipo_propuesto: "boleta",
      total: parsed.monto,
      monto_neto: neto,
      iva: exento ? 0 : parsed.monto - neto,
      confianza: 0.92,
      notas: "Venta detectada por parser determinístico de Telegram",
      fuente_clasificacion: "telegram_deterministico",
    });
    if (propError) {
      console.error("[telegram] parser determinístico insert propuesta fallo:", propError.message);
      return false;
    }
  }

  await svc
    .from("documentos_subidos")
    .update({
      estado: "procesado",
      movimientos_detectados: 1,
      progreso_ia: {
        estado: "completado",
        origen: "telegram",
        parser: "deterministico_telegram",
        ...parsed.diagnostico,
        movimientos_encontrados: 1,
        duplicados_saltados: 0,
        fecha_asumida_chile: parsed.fechaVisible ? undefined : parsed.fecha,
      } as Json,
    })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId);
  return true;
}

/**
 * Garantía determinística: cada movimiento de ENTRADA (venta) del documento
 * debe tener una propuesta de boleta. El clasificador a veces extrae bien el
 * movimiento (monto + dirección) pero omite la propuesta; acá la creamos según
 * la config de la empresa (exento → exenta sin IVA; afecto → desglose 19%).
 * Scoped por empresa. No lanza.
 */
async function asegurarPropuestasDeVenta(
  svc: ReturnType<typeof getServiceClient>,
  documentoId: string,
  empresaId: string,
): Promise<void> {
  const { data: movs } = await svc
    .from("movimientos_raw")
    .select("id, monto")
    .eq("documento_id", documentoId)
    .eq("tipo_flujo", "entrada");
  const entradas = movs ?? [];
  if (entradas.length === 0) return;

  const { data: props } = await svc
    .from("propuestas_ia")
    .select("movimiento_id")
    .in("movimiento_id", entradas.map((m) => m.id));
  const conPropuesta = new Set((props ?? []).map((p) => p.movimiento_id));
  const faltantes = entradas.filter((m) => !conPropuesta.has(m.id));
  if (faltantes.length === 0) return;

  const { data: emp } = await svc
    .from("empresas")
    .select("tipo_contribuyente")
    .eq("id", empresaId)
    .maybeSingle();
  const exento = emp?.tipo_contribuyente === "exento";

  const inserts = faltantes.map((m) => {
    const total = m.monto ?? 0;
    const neto = exento ? total : Math.round(total / 1.19);
    return {
      empresa_id: empresaId,
      movimiento_id: m.id,
      estado: "pendiente",
      tipo_propuesto: "boleta",
      total,
      monto_neto: neto,
      iva: exento ? 0 : total - neto,
      confianza: 0.7,
      notas: "Venta detectada en comprobante",
    };
  });
  const { error } = await svc.from("propuestas_ia").insert(inserts);
  if (error) console.error("[telegram] asegurarPropuestas insert fallo:", error.message);
}

async function marcarComprobanteAmbiguo(
  svc: ReturnType<typeof getServiceClient>,
  documentoId: string,
  empresaId: string,
  motivo: string,
  diagnostico: Record<string, Json>,
): Promise<void> {
  await svc
    .from("documentos_subidos")
    .update({
      estado: "procesado",
      movimientos_detectados: 0,
      progreso_ia: {
        estado: "requiere_revision",
        origen: "telegram",
        parser: "deterministico_telegram",
        movimientos_encontrados: 0,
        motivo,
        ...diagnostico,
      } as Json,
    })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId);
}

/** Nombre visible en Agregados: `Telegram dd-mm HH:mm comprobante.jpg` (hora de Chile). */
export function nombreComprobanteTelegram(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `Telegram ${p("day")}-${p("month")} ${p("hour")}:${p("minute")} comprobante.jpg`;
}

/**
 * Cuenta los comprobantes que esta empresa ya subió HOY vía Telegram.
 * Se filtra por el prefijo del nombre_archivo ("Telegram ...") porque el
 * pipeline reescribe progreso_ia completo durante el procesamiento y el
 * marcador `origen` desaparece hasta que se reinyecta al final.
 */
export async function contarComprobantesTelegramHoy(empresaId: string): Promise<number> {
  const svc = getServiceClient();
  const { count } = await svc
    .from("documentos_subidos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .like("nombre_archivo", "Telegram %")
    .gte("created_at", chileDayStartUtc());
  return count ?? 0;
}

/**
 * Parte sincrónica de la ingesta (idéntica a /api/subir-procesar):
 * inserta el registro en documentos_subidos, sube el archivo al bucket
 * "documentos" y deja el estado en "procesando". Es rápida, así el
 * webhook puede confirmarle al usuario antes de que parta el OCR.
 */
export async function crearDocumentoTelegram(args: {
  empresaId: string;
  base64: string;
  mime: string;
  nombreArchivo: string;
}): Promise<{ ok: true; documentoId: string } | { ok: false; error: string }> {
  const svc = getServiceClient();
  const buffer = Buffer.from(args.base64, "base64");

  const { data: doc, error: docError } = await svc
    .from("documentos_subidos")
    .insert({
      empresa_id: args.empresaId,
      nombre_archivo: args.nombreArchivo,
      tipo: "imagen",
      storage_path: "memoria",
      estado: "subido",
      progreso_ia: { origen: "telegram" } as Json,
    })
    .select("id")
    .single();
  if (docError || !doc) return { ok: false, error: docError?.message ?? "DB_ERROR" };

  // Archivo → R2 si está configurado (no quema Supabase), si no fallback Supabase.
  let storagePath = "";
  let storageProvider: "r2" | "supabase" = "supabase";
  if (defaultStorageProvider() === "r2") {
    storageProvider = "r2";
    try {
      const up = await subirDocumentoR2(args.empresaId, `${doc.id}__${args.nombreArchivo}`, buffer, args.mime);
      storagePath = up.key;
    } catch { storagePath = ""; }
  } else {
    // El nombre lleva espacios y ":" -> se sanitiza el segmento (patrón de lib/upload.ts).
    const safeName = args.nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath = `${args.empresaId}/${doc.id}/${safeName}`;
    const { error: storageError } = await svc.storage
      .from("documentos")
      .upload(storagePath, buffer, { contentType: args.mime, upsert: true });
    if (storageError) storagePath = "";
  }
  if (storagePath) {
    await svc.from("documentos_subidos")
      .update({ storage_path: storagePath, storage_provider: storageProvider } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"])
      .eq("id", doc.id);
  }

  await svc.from("documentos_subidos").update({ estado: "procesando" }).eq("id", doc.id);
  return { ok: true, documentoId: doc.id };
}

/**
 * Parte pesada de la ingesta, mismo pipeline que el panel para tipo
 * "imagen": OCR Mistral -> clasificación con procesarDocumento. Al final
 * reinyecta `origen: "telegram"` en progreso_ia (el pipeline lo reescribe
 * completo) para que quede trazable que el comprobante llegó por Telegram.
 * Nunca lanza: el error se marca en el registro, igual que el panel.
 */
export async function procesarComprobanteTelegram(args: {
  documentoId: string;
  empresaId: string;
  base64: string;
  mime: string;
  nombreArchivo: string;
  chatId?: number;
  receivedAt?: number;
}): Promise<void> {
  const svc = getServiceClient();
  try {
    // Import dinámico igual que /api/subir-procesar (no cargar Mistral de más).
    const { ocrAndGroupImages } = await import("@/lib/ai/ocr");
    const { groupedText } = await ocrAndGroupImages([
      { base64: args.base64, mimeType: args.mime, fileName: args.nombreArchivo },
    ]);
    if (!groupedText.trim()) {
      // OCR sin texto = imagen ilegible. Aviso reactivo: pedir screenshot
      // justo cuando pasó, y marcar el registro como error (no queda colgado).
      if (args.chatId) await sendMessage(args.chatId, MSG_ILEGIBLE, { html: true });
      await svc
        .from("documentos_subidos")
        .update({
          estado: "error",
          progreso_ia: { estado: "error", error: "comprobante_ilegible", origen: "telegram" } as Json,
        })
        .eq("id", args.documentoId);
      return;
    }

    const fechaFallback = chileDateString(args.receivedAt ? new Date(args.receivedAt * 1000) : new Date());
    const parsed = await parseComprobanteTelegramDeterministico(svc, args.empresaId, groupedText, fechaFallback);
    if (parsed.kind === "parsed" && await procesarComprobanteDeterministico(svc, args.documentoId, args.empresaId, parsed.parsed)) {
      if (args.chatId) {
        await enviarResumenPropuestas(args.chatId, args.documentoId, args.empresaId, groupedText);
      }
      return;
    }
    if (parsed.kind === "ambiguous") {
      await marcarComprobanteAmbiguo(svc, args.documentoId, args.empresaId, parsed.motivo, parsed.diagnostico);
      if (args.chatId) {
        const msg = await sendMessage(
          args.chatId,
          mensajeLeiEsto(groupedText, {
            resultado: "Requiere revisión",
            motivo: parsed.motivo === "monto_conflictivo" ? "Monto conflictivo" : "Datos insuficientes",
          }) +
            "\n\nNo creé boleta automática. Revisalo desde massDTE o mandá un screenshot más claro.",
          { html: true },
        );
        await registrarMensajeTelegram({
          chatId: args.chatId,
          empresaId: args.empresaId,
          messageId: msg?.message_id,
          documentoId: args.documentoId,
          kind: "estado",
          estado: "requiere_revision",
        });
      }
      return;
    }

    const result = await procesarDocumento(args.documentoId, args.empresaId, groupedText);
    if (result.error) {
      console.error(`[telegram] ${args.documentoId} error pipeline:`, result.error);
    }

    await normalizarMovimientosTelegram(svc, args.documentoId, args.empresaId, groupedText, fechaFallback);

    // Garantía determinística: cada movimiento de ENTRADA (venta) debe tener
    // propuesta. El modelo a veces extrae bien el movimiento pero no genera la
    // propuesta; la creamos nosotros según la config de la empresa, sin depender
    // de que la IA obedezca.
    await asegurarPropuestasDeVenta(svc, args.documentoId, args.empresaId);

    const { data: row } = await svc
      .from("documentos_subidos")
      .select("progreso_ia")
      .eq("id", args.documentoId)
      .single();
    const progreso =
      row?.progreso_ia && typeof row.progreso_ia === "object" && !Array.isArray(row.progreso_ia)
        ? row.progreso_ia
        : {};
    await svc
      .from("documentos_subidos")
      .update({ progreso_ia: { ...progreso, origen: "telegram" } as Json })
      .eq("id", args.documentoId);

    // Resumen interactivo: "📄 Leí esto" + "🧾 Boleta" con botones por operación.
    if (args.chatId) {
      await enviarResumenPropuestas(args.chatId, args.documentoId, args.empresaId, groupedText);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] ${args.documentoId} error fatal:`, errorMsg);
    // No dejar al usuario colgado: avisar que reintente (no quedar "trabado").
    if (args.chatId) {
      const aborted = /abort/i.test(errorMsg);
      await sendMessage(
        args.chatId,
        aborted
          ? "⏳ Tardé demasiado leyendo ese comprobante y se cortó. Probá de nuevo en un momento."
          : "😕 Tuve un problema procesando ese comprobante. Probá de nuevo en un ratito.",
        { html: true },
      );
    }
    try {
      await svc
        .from("documentos_subidos")
        .update({
          estado: "error",
          progreso_ia: { estado: "error", error: errorMsg, origen: "telegram" } as Json,
        })
        .eq("id", args.documentoId);
    } catch (e) {
      console.error(`[telegram] ${args.documentoId} fallo al marcar error:`, e);
    }
  }
}
