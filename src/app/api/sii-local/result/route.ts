import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { isR2Configured, uploadToR2 } from "@/lib/r2";
import { requireEmisionJob } from "@/lib/emission/jobs";
import { releaseCuentaEmissionLock } from "@/lib/emission/locks";
import { recordCuentaAudit } from "@/lib/audit/account";

interface SiiLocalResultPayload {
  job_id?: string | null;
  recover_latest?: boolean;
  result?: {
    folio?: number | null;
    folio_confidence?: string | null;
    folio_evidence?: unknown;
    tipo_dte?: number | null;
    fecha_emision?: string | null;
    estado?: string | null;
    monto_total?: number | null;
    receptor?: {
      rut?: string | null;
      razon_social?: string | null;
      direccion?: string | null;
      comuna?: string | null;
    } | null;
    detalles?: Array<{ nombre?: string; cantidad?: number; monto_total?: number; monto?: number }>;
    totales?: {
      monto_total?: number | null;
      monto_neto?: number | null;
      iva?: number | null;
      monto_exento?: number | null;
    } | null;
    artifact_links?: Array<{ kind?: string; href?: string; text?: string }>;
    pdf?: {
      source?: string | null;
      base64?: string | null;
      content_type?: string | null;
      filename?: string | null;
      size?: number | null;
      source_url?: string | null;
    } | null;
    page?: { url?: string; title?: string; excerpt?: string };
    job?: { job_id?: string; empresa_id?: string };
  } | null;
}

interface SiiLocalPdfInfo {
  href: string;
  folio: number | null;
}

// Los resultados se persisten en public.sii_local_resultados (service role,
// RLS deny-all). Antes vivían en un array en memoria, que en serverless
// multi-instancia hacía que "recuperar última emisión" funcionara solo si la
// misma instancia había recibido el resultado original.
const RESULT_RETENTION_DAYS = 7;
const ROLES_EMISION = new Set(["owner", "admin", "contador"]);

type ServiceDb = SupabaseClient;

function resultForLog(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const copy = { ...(result as Record<string, unknown>) };
  if (copy.pdf && typeof copy.pdf === "object") {
    const pdf = copy.pdf as Record<string, unknown>;
    copy.pdf = {
      ...pdf,
      base64: pdf.base64 ? `[redacted:${String(pdf.base64).length}]` : null,
    };
  }
  return copy;
}

async function rememberResult(sb: ServiceDb, entry: { user_id: string; job_id: string | null; folio: number | null; status: string; error?: string | null; result: unknown }) {
  try {
    await sb.from("sii_local_resultados").insert({
      user_id: entry.user_id,
      job_id: entry.job_id,
      folio: entry.folio,
      status: entry.status,
      error: entry.error ?? null,
      result: resultForLog(entry.result) ?? null,
    });
    await sb
      .from("sii_local_resultados")
      .delete()
      .eq("user_id", entry.user_id)
      .lt("received_at", new Date(Date.now() - RESULT_RETENTION_DAYS * 24 * 3600 * 1000).toISOString());
  } catch (error) {
    // Log best-effort: si la tabla aún no existe (migración pendiente) no se
    // bloquea la emisión, solo se pierde la recuperación posterior.
    console.error("[sii-local-result] no se pudo registrar el resultado", error);
  }
}

function positiveInt(value: unknown) {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanPdfBase64(value: unknown) {
  const text = cleanText(value);
  if (!text || text.startsWith("[redacted:")) return null;
  return text;
}

function chileDate(value: unknown) {
  const text = cleanText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function pdfInfoFromHref(href: string): SiiLocalPdfInfo | null {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    decoded = href;
  }
  const pdfMatch = decoded.match(/https:\/\/[^\s"']+\.pdf(?:\?[^\s"']*)?/i);
  const pdfUrl = pdfMatch?.[0] ?? (/\.pdf(?:\?|$)/i.test(href) ? href : null);
  if (!pdfUrl) return null;

  const folioMatch = pdfUrl.match(/folio(\d+)_/i);
  return { href: pdfUrl, folio: folioMatch ? positiveInt(folioMatch[1]) : null };
}

function extractSiiPdfInfo(result: SiiLocalResultPayload["result"]): SiiLocalPdfInfo | null {
  const sourceUrl = cleanText(result?.pdf?.source_url);
  if (sourceUrl) {
    const sourceInfo = pdfInfoFromHref(sourceUrl);
    if (sourceInfo) return sourceInfo;
  }

  const links = Array.isArray(result?.artifact_links) ? result.artifact_links : [];
  for (const link of links) {
    const href = cleanText(link.href);
    if (!href) continue;
    const info = pdfInfoFromHref(href);
    if (info) return info;
  }
  return null;
}

function sanitizeUrlForMetadata(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function isAllowedSiiPdfUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return url.hostname === "eboleta.s3.amazonaws.com" || /(^|\.)sii\.cl$/.test(url.hostname);
  } catch {
    return false;
  }
}

function storagePathFor(args: { empresaId: string; tipoDte: number; folio: number }) {
  return `${args.empresaId}/boletas-sii-local/${args.tipoDte}-${args.folio}.pdf`;
}

function validatePdfBuffer(buffer: Buffer) {
  if (!buffer.length) return "PDF_EMPTY";
  if (buffer.length > 8 * 1024 * 1024) return "PDF_TOO_LARGE";
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) return "PDF_INVALID";
  return null;
}

async function uploadPdfBuffer(
  sb: { storage: { from: (bucket: string) => { upload: (path: string, body: Buffer, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }> } } },
  args: { empresaId: string; tipoDte: number; folio: number; buffer: Buffer },
) {
  const invalid = validatePdfBuffer(args.buffer);
  if (invalid) return { storagePath: null, error: invalid, provider: null };

  const storagePath = storagePathFor(args);

  // Si R2 está configurado, los PDFs van a Cloudflare R2 (no a Supabase Storage):
  // no consume storage ni egress de Supabase, y R2 no cobra egress. El marcador
  // provider permite que la ruta de lectura sepa de dónde bajarlo.
  if (isR2Configured()) {
    try {
      await uploadToR2(storagePath, args.buffer, "application/pdf");
      return { storagePath, error: null, provider: "r2" as const };
    } catch (e) {
      return { storagePath: null, error: `R2_UPLOAD_${e instanceof Error ? e.name : "ERROR"}`, provider: null };
    }
  }

  const { error } = await sb.storage.from("documentos").upload(storagePath, args.buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) return { storagePath: null, error: error.message, provider: null };
  return { storagePath, error: null, provider: "supabase" as const };
}

async function uploadExtensionPdf(
  sb: { storage: { from: (bucket: string) => { upload: (path: string, body: Buffer, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }> } } },
  args: { empresaId: string; tipoDte: number; folio: number; pdf: NonNullable<NonNullable<SiiLocalResultPayload["result"]>["pdf"]> },
) {
  const base64 = cleanPdfBase64(args.pdf.base64);
  if (!base64) return { storagePath: null, error: "PDF_BASE64_MISSING", filename: null, sourceUrl: null };
  if (args.pdf.content_type !== "application/pdf") return { storagePath: null, error: "PDF_CONTENT_TYPE_INVALID", filename: null, sourceUrl: null };
  const buffer = Buffer.from(base64, "base64");
  const upload = await uploadPdfBuffer(sb, { empresaId: args.empresaId, tipoDte: args.tipoDte, folio: args.folio, buffer });
  return {
    ...upload,
    filename: cleanText(args.pdf.filename) ?? `boleta-sii-${args.tipoDte}-${args.folio}.pdf`,
    sourceUrl: sanitizeUrlForMetadata(cleanText(args.pdf.source_url)),
  };
}

async function uploadSiiPdf(
  sb: { storage: { from: (bucket: string) => { upload: (path: string, body: Buffer, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }> } } },
  args: { empresaId: string; tipoDte: number; folio: number; pdfUrl: string },
) {
  if (!isAllowedSiiPdfUrl(args.pdfUrl)) return { storagePath: null, error: "PDF_URL_NOT_ALLOWED", filename: null, sourceUrl: null };
  const response = await fetch(args.pdfUrl, { cache: "no-store" });
  if (!response.ok) return { storagePath: null, error: `PDF_FETCH_${response.status}`, filename: null, sourceUrl: null };

  const contentType = response.headers.get("content-type") || "application/pdf";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!contentType.toLowerCase().includes("pdf")) return { storagePath: null, error: "PDF_INVALID_CONTENT_TYPE", filename: null, sourceUrl: null };

  const upload = await uploadPdfBuffer(sb, { empresaId: args.empresaId, tipoDte: args.tipoDte, folio: args.folio, buffer });
  return { ...upload, filename: `boleta-sii-${args.tipoDte}-${args.folio}.pdf`, sourceUrl: sanitizeUrlForMetadata(args.pdfUrl) };
}

async function uploadResultPdf(
  sb: { storage: { from: (bucket: string) => { upload: (path: string, body: Buffer, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }> } } },
  args: { empresaId: string; tipoDte: number; folio: number; result: SiiLocalResultPayload["result"]; pdfInfo: SiiLocalPdfInfo | null },
) {
  const pdf = args.result?.pdf;
  if (pdf && cleanPdfBase64(pdf.base64)) {
    return uploadExtensionPdf(sb, { empresaId: args.empresaId, tipoDte: args.tipoDte, folio: args.folio, pdf });
  }
  if (args.pdfInfo?.href) {
    return uploadSiiPdf(sb, { empresaId: args.empresaId, tipoDte: args.tipoDte, folio: args.folio, pdfUrl: args.pdfInfo.href });
  }
  return { storagePath: null, error: "PDF_REQUIRED", filename: null, sourceUrl: null, provider: null };
}

function totalsFor(tipoDte: number, total: number, payloadTotals: SiiLocalResultPayload["result"] extends infer R ? R extends { totales?: infer T } ? T : never : never) {
  const montoNeto = positiveInt(payloadTotals && typeof payloadTotals === "object" ? (payloadTotals as { monto_neto?: unknown }).monto_neto : null);
  const iva = positiveInt(payloadTotals && typeof payloadTotals === "object" ? (payloadTotals as { iva?: unknown }).iva : null);
  const montoExento = positiveInt(payloadTotals && typeof payloadTotals === "object" ? (payloadTotals as { monto_exento?: unknown }).monto_exento : null);

  if (tipoDte === 41) {
    return { monto_neto: 0, iva: 0, monto_exento: montoExento ?? total };
  }

  const neto = montoNeto ?? Math.round(total / 1.19);
  return { monto_neto: neto, iva: iva ?? total - neto, monto_exento: 0 };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient(url, key);

  let payload: SiiLocalResultPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  let result = payload.result;
  let effectiveJobId = payload.job_id ?? null;
  if (payload.recover_latest) {
    let query = sb
      .from("sii_local_resultados")
      .select("job_id, result")
      .eq("user_id", user.id)
      .not("result", "is", null)
      .order("received_at", { ascending: false })
      .limit(1);
    if (payload.job_id) query = query.eq("job_id", payload.job_id);
    const { data: recoveredRows, error: recoverErr } = await query;
    if (recoverErr) {
      return NextResponse.json(
        { ok: false, error: "RECUPERACION_NO_DISPONIBLE", detalle: recoverErr.message },
        { status: 500 },
      );
    }
    const recovered = recoveredRows?.[0] as { job_id: string | null; result: unknown } | undefined;
    if (!recovered?.result || typeof recovered.result !== "object") {
      return NextResponse.json({ ok: false, error: "SIN_RESULTADO_SII_RECUPERABLE" }, { status: 404 });
    }
    result = recovered.result as SiiLocalResultPayload["result"];
    effectiveJobId = recovered.job_id;
  }
  const pdfInfo = extractSiiPdfInfo(result);
  const folio = positiveInt(result?.folio) ?? pdfInfo?.folio ?? null;
  const tipoDte = result?.tipo_dte === 39 || result?.tipo_dte === 41 ? result.tipo_dte : null;
  const montoTotal = positiveInt(result?.monto_total ?? result?.totales?.monto_total);
  const fechaEmision = chileDate(result?.fecha_emision);

  const { data: usuario } = await sb
    .from("usuarios")
    .select("rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario || usuario.vetado) return NextResponse.json({ ok: false, error: "USUARIO_BLOQUEADO" }, { status: 403 });
  if (!ROLES_EMISION.has(String(usuario.rol))) {
    return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 });
  }

  const jobGate = await requireEmisionJob({ sb, userId: user.id, jobId: effectiveJobId, provider: "sii_local" });
  if (!jobGate.ok) return NextResponse.json({ ok: false, error: jobGate.error, detalle: jobGate.detalle }, { status: jobGate.status });
  const job = jobGate.job;
  const empresaId = job.empresa_id;

  // Evidencia fuerte = el SII entregó folio con confianza alta (o folio en la
  // URL del PDF). Es el ÚNICO requisito para registrar la boleta: el folio es
  // la prueba de emisión. El PDF se adjunta aparte (puede quedar pendiente).
  const hasStrongEvidence = result?.folio_confidence === "high" || Boolean(pdfInfo?.folio);
  if (!folio || !tipoDte || !montoTotal || !fechaEmision || !hasStrongEvidence) {
    await rememberResult(sb, {
      user_id: user.id,
      job_id: effectiveJobId,
      folio,
      status: "rejected",
      error: "RESULTADO_SII_INSUFICIENTE",
      result: result ?? null,
    });
    await recordCuentaAudit({
      sb,
      cuentaId: job.cuenta_id,
      empresaId,
      usuarioId: job.usuario_id,
      accion: "emision_fallida",
      recursoTipo: "emision_job",
      recursoId: job.job_id,
      resumen: "Resultado SII local insuficiente",
      metadata: {
        proveedor: "sii_local",
        error: "RESULTADO_SII_INSUFICIENTE",
      },
    });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    return NextResponse.json({ ok: false, error: "RESULTADO_SII_INSUFICIENTE" }, { status: 422 });
  }

  const { data: empresa } = await sb
    .from("empresas")
    .select("rut, razon_social, giro, direccion, comuna")
    .eq("id", empresaId)
    .single();
  if (!empresa?.rut || !empresa?.razon_social) {
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });
  }

  const { data: existing } = await sb
    .from("boletas_emitidas")
    .select("id, folio, estado, proveedor_respuesta")
    .eq("empresa_id", empresaId)
    .eq("tipo_dte", tipoDte)
    .eq("folio", folio)
    .maybeSingle();

  if (existing) {
    const pdfUpload = await uploadResultPdf(sb, { empresaId, tipoDte, folio, result, pdfInfo });
    if (pdfUpload.storagePath) {
      const previousResponse = existing.proveedor_respuesta && typeof existing.proveedor_respuesta === "object"
        ? existing.proveedor_respuesta as Record<string, unknown>
        : {};
      const { error: updateErr } = await sb
        .from("boletas_emitidas")
        .update({
          proveedor_respuesta: {
            ...previousResponse,
            pdf: {
              storage_path: pdfUpload.storagePath,
              filename: pdfUpload.filename ?? `boleta-sii-${tipoDte}-${folio}.pdf`,
              content_type: "application/pdf",
              source_url: pdfUpload.sourceUrl,
              provider: pdfUpload.provider,
            },
            pdf_upload_error: null,
          },
        })
        .eq("id", existing.id);
      if (updateErr) {
        await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "pdf_metadata_update_failed", error: updateErr.message, result });
        await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
        return NextResponse.json({ ok: false, error: "PDF_METADATA_UPDATE_FAILED", detalle: updateErr.message, already_exists: true, boleta_id: existing.id }, { status: 500 });
      }
    } else {
      // El PDF no se pudo subir ahora: la boleta YA existe y queda registrada;
      // el PDF se reintenta/adjunta luego. Nunca se pierde la boleta por esto.
      await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "pdf_pendiente", error: pdfUpload.error, result });
    }
    await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "already_exists", result });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });
    return NextResponse.json({ ok: true, boleta_id: existing.id, folio, estado: existing.estado, already_exists: true });
  }

  const totals = totalsFor(tipoDte, montoTotal, result?.totales ?? null);
  const receptor = result?.receptor ?? null;
  const detalles = Array.isArray(result?.detalles) && result.detalles.length > 0
    ? result.detalles.map((detalle, index) => ({
        nro_lin: index + 1,
        nombre: cleanText(detalle.nombre) ?? "Servicio prestado",
        qty: positiveInt(detalle.cantidad) ?? 1,
        monto: positiveInt(detalle.monto_total ?? detalle.monto) ?? montoTotal,
      }))
    : [{ nro_lin: 1, nombre: "Servicio prestado", qty: 1, monto: montoTotal }];

  const trackId = `sii-local:${effectiveJobId ?? result?.job?.job_id ?? "manual"}:${tipoDte}:${folio}`;
  // PRINCIPIO DE CONFIANZA: con folio de evidencia fuerte (ya validado arriba),
  // la boleta SE REGISTRA SIEMPRE, tenga PDF o no. El PDF es respaldo adjuntable
  // después; jamás bloquea el registro de una boleta realmente emitida en el SII.
  const pdfUpload = await uploadResultPdf(sb, { empresaId, tipoDte, folio, result, pdfInfo });
  const pdfPendiente = !pdfUpload.storagePath;

  const proveedorRespuesta = {
    origen: "sii_local_extension",
    job_id: effectiveJobId,
    folio_confidence: result?.folio_confidence === "high" ? "high" : pdfInfo?.folio ? "high" : result?.folio_confidence,
    folio_evidence: result?.folio_evidence ?? (pdfInfo?.folio ? { source: "sii_pdf_url", matched_text: `folio${pdfInfo.folio}` } : null),
    pdf: pdfUpload.storagePath ? {
      storage_path: pdfUpload.storagePath,
      filename: pdfUpload.filename ?? `boleta-sii-${tipoDte}-${folio}.pdf`,
      content_type: "application/pdf",
      source_url: pdfUpload.sourceUrl,
      provider: pdfUpload.provider,
    } : null,
    pdf_pendiente: pdfPendiente,
    pdf_upload_error: pdfUpload.storagePath ? null : (pdfUpload.error || "PDF_PENDIENTE"),
    artifact_links: (result?.artifact_links ?? []).map((link) => ({
      kind: link.kind,
      text: link.text,
      href: sanitizeUrlForMetadata(cleanText(link.href)),
    })),
    page: result?.page ? { url: result.page.url, title: result.page.title } : null,
  };

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
      receptor_rut: cleanText(receptor?.rut),
      receptor_razon_social: cleanText(receptor?.razon_social),
      receptor_direccion: cleanText(receptor?.direccion),
      receptor_comuna: cleanText(receptor?.comuna),
      monto_neto: totals.monto_neto,
      monto_exento: totals.monto_exento,
      iva: totals.iva,
      monto_total: montoTotal,
      detalles,
      xml_dte: `sii-local://boleta/${tipoDte}/${folio}`,
      ted: `sii-local://ted/${tipoDte}/${folio}`,
      track_id: trackId,
      estado: "aceptado",
      emision_proveedor: "sii_local",
      emision_sandbox: false,
      proveedor_respuesta: proveedorRespuesta,
    })
    .select("id, folio, monto_total, estado, track_id, fecha_emision")
    .single();

  if (insertErr || !boleta) {
    await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "insert_failed", error: insertErr?.message ?? "DB_INSERT_FAILED", result });
    await recordCuentaAudit({
      sb,
      cuentaId: job.cuenta_id,
      empresaId,
      usuarioId: job.usuario_id,
      accion: "emision_fallida",
      recursoTipo: "emision_job",
      recursoId: job.job_id,
      resumen: "No se pudo guardar la boleta emitida con SII local",
      metadata: {
        tipo_dte: tipoDte,
        folio,
        proveedor: "sii_local",
        error: "DB_INSERT_FAILED",
      },
    });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "failed" });
    return NextResponse.json({ ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message }, { status: 500 });
  }

  const receptorLabel = cleanText(receptor?.razon_social) ?? "consumidor final";
  await sb.from("documentos_subidos").insert({
    empresa_id: empresaId,
    nombre_archivo: `Boleta SII #${boleta.folio} - ${receptorLabel}`,
    tipo: "boleta_sii_local",
    storage_path: pdfUpload.storagePath,
    estado: "procesado",
    movimientos_detectados: 1,
    created_at: new Date().toISOString(),
    progreso_ia: {
      origen: "sii_local_extension",
      proveedor: "sii_local",
      boleta_id: boleta.id,
      folio: boleta.folio,
      tipo_dte: tipoDte,
      monto_total: boleta.monto_total,
      receptor: receptorLabel,
    },
  });

  await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: pdfPendiente ? "persisted_pdf_pendiente" : "persisted", result });
  await recordCuentaAudit({
    sb,
    cuentaId: job.cuenta_id,
    empresaId,
    usuarioId: job.usuario_id,
    accion: "boleta_emitida",
    recursoTipo: "boleta_emitida",
    recursoId: boleta.id,
    resumen: `Boleta #${boleta.folio} emitida con SII local`,
    metadata: {
      tipo_dte: tipoDte,
      folio: boleta.folio,
      proveedor: "sii_local",
      pdf_pendiente: pdfPendiente,
    },
  });
  await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });

  return NextResponse.json({ ok: true, boleta_id: boleta.id, folio: boleta.folio, estado: boleta.estado, track_id: boleta.track_id, pdf_pendiente: pdfPendiente });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient(url, key);

  const { data, error } = await sb
    .from("sii_local_resultados")
    .select("received_at, job_id, folio, status, error, result")
    .eq("user_id", user.id)
    .order("received_at", { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ ok: false, error: "LOG_NO_DISPONIBLE", detalle: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results: data ?? [] });
}

export const dynamic = "force-dynamic";
