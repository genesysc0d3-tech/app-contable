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
import { procesarDocumento } from "@/lib/ai/processor";
import { sendMessage } from "@/lib/telegram/api";
import { enviarResumenPropuestas } from "@/lib/telegram/propuestas";
import { chileDayStartUtc } from "@/lib/chile-date";

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

  // Mismo layout de Storage que el panel: empresa/documento/nombre.
  // El nombre lleva espacios y ":" -> se sanitiza el segmento (patrón de lib/upload.ts).
  const safeName = args.nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${args.empresaId}/${doc.id}/${safeName}`;
  const { error: storageError } = await svc.storage
    .from("documentos")
    .upload(storagePath, buffer, { contentType: args.mime, upsert: true });
  if (!storageError) {
    await svc.from("documentos_subidos").update({ storage_path: storagePath }).eq("id", doc.id);
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

    const result = await procesarDocumento(args.documentoId, args.empresaId, groupedText);
    if (result.error) {
      console.error(`[telegram] ${args.documentoId} error pipeline:`, result.error);
    }

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
