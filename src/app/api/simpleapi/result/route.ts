import { NextResponse } from "next/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { requireSimpleApiFolioReserva } from "@/lib/emission/folio-reservas";
import { requireEmisionJob } from "@/lib/emission/jobs";
import { releaseCuentaEmissionLock } from "@/lib/emission/locks";
import { recordCuentaAudit } from "@/lib/audit/account";
import { recordOpsEvent } from "@/lib/ops/events";

type ServiceDb = SupabaseClient<Database>;

interface SimpleApiResultPayload {
  job_id?: string | null;
  result?: {
    trackId?: number | string | null;
    dte?: { folio?: number | null; tipoDte?: number | null; fecha?: string | null; total?: number | null } | null;
    dteXml?: string | null;
    envioXml?: string | null;
    envio?: unknown;
    consultaDte?: unknown;
    pdf?: { base64?: string | null; content_type?: string | null; filename?: string | null } | null;
  } | null;
  draft?: {
    receptor_rut?: string | null;
    receptor_razon_social?: string | null;
    receptor_direccion?: string | null;
    receptor_comuna?: string | null;
    detalle_nombre?: string | null;
    monto_total?: number | null;
  } | null;
}

function positiveInt(value: unknown) {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function chileDate(value: unknown) {
  const text = cleanText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function validatePdfBuffer(buffer: Buffer) {
  if (!buffer.length) return "PDF_EMPTY";
  if (buffer.length > 8 * 1024 * 1024) return "PDF_TOO_LARGE";
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) return "PDF_INVALID";
  return null;
}

function safeJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    return null;
  }
}

function totalsFor(tipoDte: number, total: number) {
  // 34 (factura exenta) y 41 (boleta exenta): todo exento.
  if (tipoDte === 34 || tipoDte === 41) return { monto_neto: 0, iva: 0, monto_exento: total };
  // 33 (factura afecta) y 39 (boleta afecta): total bruto con IVA incluido.
  const neto = Math.round(total / 1.19);
  return { monto_neto: neto, iva: total - neto, monto_exento: 0 };
}

function storagePathFor(args: { empresaId: string; tipoDte: number; folio: number }) {
  return `${args.empresaId}/simpleapi-dte/${args.tipoDte}-${args.folio}.pdf`;
}

function stringFromResponse(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.data === "string") return record.data;
  if (record.data) return stringFromResponse(record.data);
  if (typeof record.responseXml === "string") return record.responseXml;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function responseEstado(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const estado = data.estado ?? data.Estado ?? data.ESTADO;
  return typeof estado === "string" ? estado.toUpperCase() : null;
}

function isAcceptedEnvio(value: unknown) {
  if (responseEstado(value) === "EPR") return true;
  const text = stringFromResponse(value);
  return /<ESTADO>EPR<\/ESTADO>/i.test(text) && /<ACEPTADOS>[1-9]/i.test(text);
}

function isAcceptedDte(value: unknown) {
  if (responseEstado(value) === "DOK") return true;
  return /<ESTADO>DOK<\/ESTADO>/i.test(stringFromResponse(value));
}

function validDteXml(args: { xml: string; tipoDte: number; folio: number; total: number }) {
  if (!/<DTE\b/i.test(args.xml) || !/<Documento\b/i.test(args.xml)) return false;
  const tipoMatch = args.xml.match(/<TipoDTE>(\d+)<\/TipoDTE>/i);
  const folioMatch = args.xml.match(/<Folio>(\d+)<\/Folio>/i);
  const totalMatch = args.xml.match(/<MntTotal>(\d+)<\/MntTotal>/i);
  return Number(tipoMatch?.[1]) === args.tipoDte && Number(folioMatch?.[1]) === args.folio && Number(totalMatch?.[1]) === args.total;
}

async function recordSimpleApiFailure(
  sb: ServiceDb,
  job: { cuenta_id: string; empresa_id: string; usuario_id: string; job_id: string },
  error: string,
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  await recordOpsEvent({
    sb,
    severity: "error",
    source: "simpleapi",
    eventName: "simpleapi_result_failed",
    summary,
    cuentaId: job.cuenta_id,
    empresaId: job.empresa_id,
    usuarioId: job.usuario_id,
    resourceType: "emision_job",
    resourceId: job.job_id,
    metadata: { error, ...metadata },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  let payload: SimpleApiResultPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const result = payload.result ?? null;
  const tipoDte = result?.dte?.tipoDte === 33 || result?.dte?.tipoDte === 34 || result?.dte?.tipoDte === 39 || result?.dte?.tipoDte === 41
    ? result.dte.tipoDte
    : null;
  const folio = positiveInt(result?.dte?.folio);
  const montoTotal = positiveInt(result?.dte?.total ?? payload.draft?.monto_total);
  const fechaEmision = chileDate(result?.dte?.fecha);
  const trackId = cleanText(result?.trackId);
  const xmlDte = cleanText(result?.dteXml);
  const pdfBase64 = cleanText(result?.pdf?.base64);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient<Database>(url, key);

  const { data: usuario } = await sb
    .from("usuarios")
    .select("rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario || usuario.vetado) return NextResponse.json({ ok: false, error: "USUARIO_BLOQUEADO" }, { status: 403 });
  if (!ROLES_EMISION.has(String(usuario.rol))) return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 });

  const jobGate = await requireEmisionJob({ sb, userId: user.id, jobId: payload.job_id, provider: "simpleapi" });
  if (!jobGate.ok) {
    await recordOpsEvent({
      sb,
      severity: jobGate.status >= 500 ? "error" : "warn",
      source: "simpleapi",
      eventName: "simpleapi_job_gate_failed",
      summary: "Resultado SimpleAPI rechazado por gate de job",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: payload.job_id ?? null,
      metadata: { error: jobGate.error, detalle: jobGate.detalle },
    });
    return NextResponse.json({ ok: false, error: jobGate.error, detalle: jobGate.detalle }, { status: jobGate.status });
  }
  const job = jobGate.job;
  const empresaId = job.empresa_id;

  if (!tipoDte || !folio || !montoTotal || !fechaEmision || !trackId || !xmlDte) {
    if (job) {
      await recordCuentaAudit({
        sb,
        cuentaId: job.cuenta_id,
        empresaId,
        usuarioId: job.usuario_id,
        accion: "emision_fallida",
        recursoTipo: "emision_job",
        recursoId: job.job_id,
        resumen: "Resultado SimpleAPI insuficiente",
        metadata: {
          proveedor: "simpleapi",
          error: "RESULTADO_SIMPLEAPI_INSUFICIENTE",
        },
      });
    }
    await recordSimpleApiFailure(sb, job, "RESULTADO_SIMPLEAPI_INSUFICIENTE", "Resultado SimpleAPI insuficiente", {
      has_tipo_dte: Boolean(tipoDte),
      has_folio: Boolean(folio),
      has_monto_total: Boolean(montoTotal),
      has_fecha_emision: Boolean(fechaEmision),
      has_track_id: Boolean(trackId),
      has_xml: Boolean(xmlDte),
      has_pdf: Boolean(pdfBase64),
    });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    return NextResponse.json({ ok: false, error: "RESULTADO_SIMPLEAPI_INSUFICIENTE" }, { status: 422 });
  }

  const reserva = await requireSimpleApiFolioReserva({
    sb,
    empresaId,
    jobId: job.job_id,
    tipoDte,
    folio,
    allowedEstados: ["generado"],
  });
  if (!reserva.ok) {
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    await recordSimpleApiFailure(sb, job, reserva.error, "Reserva de folio SimpleAPI no calza con el resultado", {
      detalle: reserva.detalle,
      tipo_dte: tipoDte,
      folio,
    });
    return NextResponse.json({ ok: false, error: reserva.error, detalle: reserva.detalle }, { status: reserva.status });
  }

  if (!validDteXml({ xml: xmlDte, tipoDte, folio, total: montoTotal })) {
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    await recordSimpleApiFailure(sb, job, "XML_DTE_INVALID", "XML DTE SimpleAPI no calza con folio/tipo/monto", { tipo_dte: tipoDte, folio });
    return NextResponse.json({ ok: false, error: "XML_DTE_INVALID" }, { status: 422 });
  }
  if (!isAcceptedEnvio(result?.envio) || !isAcceptedDte(result?.consultaDte)) {
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    await recordSimpleApiFailure(sb, job, "SII_ACCEPTANCE_REQUIRED", "Respuesta SimpleAPI no acredita aceptacion SII", {
      envio_estado: responseEstado(result?.envio),
      consulta_dte_estado: responseEstado(result?.consultaDte),
    });
    return NextResponse.json({ ok: false, error: "SII_ACCEPTANCE_REQUIRED" }, { status: 422 });
  }

  const { data: empresa } = await sb
    .from("empresas")
    .select("rut, razon_social, giro, direccion, comuna")
    .eq("id", empresaId)
    .single();
  if (!empresa?.rut || !empresa?.razon_social) {
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    await recordSimpleApiFailure(sb, job, "EMPRESA_SIN_DATOS_FISCALES", "Empresa sin datos fiscales para persistir SimpleAPI");
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });
  }

  // EL FOLIO YA ESTÁ ACEPTADO POR EL SII (checks de arriba: reserva de folio + XML
  // válido + aceptación de envío/DTE). A partir de acá el FOLIO MANDA: la boleta se
  // registra sí o sí. El PDF es secundario — si está ausente, es inválido, o no se
  // puede subir, la boleta queda igual registrada con pdf_pendiente. Es el mismo
  // principio del carril sii-local ("el PDF jamás bloquea el registro"): perder un
  // PDF adjunto NO puede hacer perder un folio real aceptado por el SII. Antes acá
  // se sellaba 'failed' y el DTE quedaba invisible → el usuario re-emitía y quemaba
  // un segundo folio por la misma venta.
  let storagePath: string | null = null;
  let pdfPendiente = true;
  const pdfBuffer = pdfBase64 ? Buffer.from(pdfBase64, "base64") : null;
  const pdfContentTypeOk = result?.pdf?.content_type === "application/pdf";
  const invalidPdf = pdfBuffer ? validatePdfBuffer(pdfBuffer) : "PDF_AUSENTE";
  if (pdfBuffer && pdfContentTypeOk && !invalidPdf) {
    const candidatePath = storagePathFor({ empresaId, tipoDte, folio });
    // El upload puede fallar de DOS formas: devolver { error } (quota/RLS/HTTP 5xx)
    // o LANZAR — storage-js re-lanza los errores de transporte (fetch failed / reset
    // de conexión, realista en serverless de Vercel) porque no llevan isStorageError.
    // Ambas se tratan igual: NUNCA una falla de PDF puede impedir registrar un folio
    // ya aceptado por el SII.
    let uploadErr: { message?: string } | null = null;
    try {
      const { error } = await sb.storage.from("documentos").upload(candidatePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
      uploadErr = error;
    } catch (e) {
      uploadErr = { message: e instanceof Error ? e.message : String(e) };
    }
    if (uploadErr) {
      await recordOpsEvent({
        sb, severity: "warn", source: "simpleapi", eventName: "simpleapi_pdf_pendiente",
        summary: "PDF SimpleAPI no se pudo subir; folio registrado igual", usuarioId: job.usuario_id,
        resourceType: "emision_job", resourceId: job.job_id,
        metadata: { tipo_dte: tipoDte, folio, storage_error: uploadErr.message },
      });
    } else {
      storagePath = candidatePath;
      pdfPendiente = false;
    }
  } else {
    await recordOpsEvent({
      sb, severity: "warn", source: "simpleapi", eventName: "simpleapi_pdf_pendiente",
      summary: "PDF SimpleAPI ausente/inválido; folio registrado igual", usuarioId: job.usuario_id,
      resourceType: "emision_job", resourceId: job.job_id,
      metadata: { tipo_dte: tipoDte, folio, content_type: result?.pdf?.content_type, motivo: String(invalidPdf) || "CONTENT_TYPE" },
    });
  }

  const { data: existing } = await sb
    .from("boletas_emitidas")
    .select("id, folio, estado, track_id, proveedor_respuesta")
    .eq("empresa_id", empresaId)
    .eq("tipo_dte", tipoDte)
    .eq("folio", folio)
    .maybeSingle();

  const proveedorRespuesta = {
    origen: "simpleapi_extension",
    track_id: trackId,
    envio: safeJson(result?.envio),
    consulta_dte: safeJson(result?.consultaDte),
    envio_xml: cleanText(result?.envioXml),
    pdf: storagePath
      ? {
          storage_path: storagePath,
          filename: cleanText(result?.pdf?.filename) ?? `simpleapi-${tipoDte}-${folio}.pdf`,
          content_type: "application/pdf",
        }
      : { pendiente: true },
  };

  if (existing) {
    const previous = existing.proveedor_respuesta && typeof existing.proveedor_respuesta === "object" ? existing.proveedor_respuesta as Record<string, unknown> : {};
    const { error: updateErr } = await sb
      .from("boletas_emitidas")
      .update({ proveedor_respuesta: { ...previous, ...proveedorRespuesta } })
      .eq("id", existing.id);
    if (updateErr) {
      await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
      await recordSimpleApiFailure(sb, job, "DB_UPDATE_FAILED", "No se pudo actualizar documento SimpleAPI existente", {
        boleta_id: existing.id,
        detalle: updateErr.message,
      });
      return NextResponse.json({ ok: false, error: "DB_UPDATE_FAILED", detalle: updateErr.message, already_exists: true, boleta_id: existing.id }, { status: 500 });
    }
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });
    return NextResponse.json({ ok: true, boleta_id: existing.id, folio, estado: existing.estado, track_id: existing.track_id, already_exists: true });
  }

  const totals = totalsFor(tipoDte, montoTotal);
  const detalleNombre = cleanText(payload.draft?.detalle_nombre) ?? "Servicio prestado";
  const { data: boleta, error: insertErr } = await sb
    .from("boletas_emitidas")
    .insert({
      empresa_id: empresaId,
      tipo_dte: tipoDte,
      folio,
      fecha_emision: fechaEmision,
      emisor_rut: empresa.rut,
      emisor_razon_social: empresa.razon_social,
      emisor_giro: empresa.giro,
      emisor_direccion: empresa.direccion,
      emisor_comuna: empresa.comuna,
      receptor_rut: cleanText(payload.draft?.receptor_rut),
      receptor_razon_social: cleanText(payload.draft?.receptor_razon_social),
      receptor_direccion: cleanText(payload.draft?.receptor_direccion),
      receptor_comuna: cleanText(payload.draft?.receptor_comuna),
      monto_neto: totals.monto_neto,
      monto_exento: totals.monto_exento,
      iva: totals.iva,
      monto_total: montoTotal,
      detalles: [{ nro_lin: 1, nombre: detalleNombre, qty: 1, monto: tipoDte === 33 ? totals.monto_neto : montoTotal }],
      xml_dte: xmlDte,
      ted: `simpleapi://ted/${tipoDte}/${folio}`,
      track_id: trackId,
      estado: "aceptado",
      emision_proveedor: "simpleapi",
      emision_sandbox: false,
      proveedor_respuesta: proveedorRespuesta,
    })
    .select("id, folio, monto_total, estado, track_id, fecha_emision")
    .single();

  if (insertErr || !boleta) {
    if (storagePath) await sb.storage.from("documentos").remove([storagePath]);
    await recordCuentaAudit({
      sb,
      cuentaId: job.cuenta_id,
      empresaId,
      usuarioId: job.usuario_id,
      accion: "emision_fallida",
      recursoTipo: "emision_job",
      recursoId: job.job_id,
      resumen: "No se pudo guardar el documento emitido con SimpleAPI",
      metadata: {
        tipo_dte: tipoDte,
        folio,
        proveedor: "simpleapi",
        error: "DB_INSERT_FAILED",
      },
    });
    await recordSimpleApiFailure(sb, job, "DB_INSERT_FAILED", "No se pudo guardar el documento emitido con SimpleAPI", {
      tipo_dte: tipoDte,
      folio,
      detalle: insertErr?.message,
    });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    return NextResponse.json({ ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message }, { status: 500 });
  }

  // La fila documentos_subidos apunta al PDF almacenado → solo se crea si el PDF se
  // guardó. Con pdf_pendiente el folio ya quedó en boletas_emitidas (la fuente de
  // verdad); el puntero se puede crear cuando el PDF se recupere.
  const receptorLabel = cleanText(payload.draft?.receptor_razon_social) ?? "cliente sin identificar";
  if (storagePath) {
    await sb.from("documentos_subidos").insert({
      empresa_id: empresaId,
      nombre_archivo: `DTE SimpleAPI #${boleta.folio} - ${receptorLabel}`,
      tipo: "dte_simpleapi",
      storage_path: storagePath,
      estado: "procesado",
      movimientos_detectados: 1,
      created_at: new Date().toISOString(),
      progreso_ia: {
        origen: "simpleapi_extension",
        proveedor: "simpleapi",
        boleta_id: boleta.id,
        folio: boleta.folio,
        tipo_dte: tipoDte,
        monto_total: boleta.monto_total,
        receptor: receptorLabel,
        track_id: boleta.track_id,
      },
    });
  }

  await recordCuentaAudit({
    sb,
    cuentaId: job.cuenta_id,
    empresaId,
    usuarioId: job.usuario_id,
    accion: "boleta_emitida",
    recursoTipo: "boleta_emitida",
    recursoId: boleta.id,
    resumen: `Documento #${boleta.folio} emitido con SimpleAPI`,
    metadata: {
      tipo_dte: tipoDte,
      folio: boleta.folio,
      proveedor: "simpleapi",
      track_id: boleta.track_id,
    },
  });
  await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });

  return NextResponse.json({ ok: true, boleta_id: boleta.id, folio: boleta.folio, estado: boleta.estado, track_id: boleta.track_id, pdf_pendiente: pdfPendiente });
}

export const dynamic = "force-dynamic";
