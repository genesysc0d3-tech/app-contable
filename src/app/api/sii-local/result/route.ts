import { NextResponse, after } from "next/server";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { ESTADOS_LAPIDA, esLapidaEfectiva, plazoDeclararNoSalio, puedeDeclararNoSalio } from "@/lib/emission/lapida";
import { jobAdoptadoDeOrigen, validarVeredictoNoSalio } from "@/lib/emission/adopcion";
import { resolverGlosa } from "@/lib/intermediario/armar-boleta";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { requireSesionSegura, respuestaSesionInsegura } from "@/lib/api/sesion-segura";
import { STATUS_SESION_INSEGURA, elegirResultadoRecuperable, politicaResultSesionInsegura } from "@/lib/emission/result-sesion-insegura";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { isR2Configured, uploadToR2 } from "@/lib/r2";
import { requireEmisionJob } from "@/lib/emission/jobs";
import { releaseCuentaEmissionLock } from "@/lib/emission/locks";
import { datosFolioBoletaUnica, declararNoSalioBoletaUnica, esLapidaBoletaUnica, fueDeclaradoNoSalio, levantarLapidaBoletaUnica, type IntentoBoletaUnica } from "@/lib/emission/boleta-unica-lapida";
import { recordCuentaAudit } from "@/lib/audit/account";
import { recordOpsEvent } from "@/lib/ops/events";
import { cleanRut } from "@/lib/sii/validation";
import { chileDateString } from "@/lib/chile-date";

interface SiiLocalResultPayload {
  job_id?: string | null;
  recover_latest?: boolean;
  /**
   * RESCATE MANUAL: el humano leyó el folio en la ventana del SII y lo declara.
   * Es la salida de emergencia cuando el RPA emitió de verdad pero no alcanzó a
   * capturar la pantalla del folio (el copy de la extensión lo prometía desde
   * siempre — "ingrésalo abajo" — y no existía). Solo sobre jobs con lápida.
   */
  registrar_folio_manual?: number | null;
  /**
   * SALIDA HUMANA (2026-09-28, plan-emision-confiable B3b): "Revisé el SII y esta
   * boleta NO está". Sobre una lápida (a medias o sin respuesta) que la verificación
   * automática no puede resolver (otro día, >250 boletas, extensión vieja). Devuelve
   * la propuesta a Listas. Queda auditado como declaración de la persona.
   */
  declarar_no_salio?: boolean;
  /** Folio a mano de una boleta única sin intento guardado: monto y tipo de ESA boleta. */
  monto_declarado?: number | null;
  tipo_dte_declarado?: number | null;
  /**
   * VEREDICTO DE LA VERIFICACIÓN ("Verificar y seguir", 2026-09-28): el job de
   * verificación (`job_id`) leyó el Resumen de ventas del SII completo y la boleta no
   * está. El server lo valida contra SUS filas (el job de verificación adoptó a ese
   * intento, mismo usuario, misma propuesta, mismo día) y recién ahí baja la lápida
   * del intento original a `failed`. Es la única puerta automática para eso.
   */
  veredicto_verificacion?: "no_salio" | null;
  /** Telemetría de flota: versión de la extensión que POSTea (bridge 0.1.7+). */
  extension_version?: string | null;
  result?: {
    folio?: number | null;
    folio_confidence?: string | null;
    folio_evidence?: unknown;
    // RUT del emisor ACTIVO del portal al capturar (lo reporta el worker): permite
    // detectar una boleta emitida bajo otra empresa que la registrada en la app.
    emisor_rut_activo?: string | null;
    tipo_dte?: number | null;
    fecha_emision?: string | null;
    estado?: string | null;
    monto_total?: number | null;
    receptor?: {
      rut?: string | null;
      razon_social?: string | null;
      giro?: string | null;
      direccion?: string | null;
      comuna?: string | null;
    } | null;
    /** Facturas (33/34): forma de pago que quedó en el documento. */
    forma_pago?: string | null;
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
    /**
     * CAJA NEGRA del worker (0.2.3+): true = se pidió la glosa «Detalle» (o el
     * receptor) y el RPA NO la pudo escribir, pero la boleta igual salió. Antes
     * esto solo vivía en sii_local_resultados.result (se borra a los 7 días e
     * invisible en /dev): hubo 280 boletas reales sin la glosa pedida sin que
     * nadie lo viera. Ahora genera ops_event warn (GLOSA_OMITIDA /
     * RECEPTOR_OMITIDO) que /dev cuenta en 24 h.
     */
    glosa_omitida?: boolean | null;
    receptor_omitido?: boolean | null;
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

type ServiceDb = SupabaseClient<Database>;

function resultForLog(result: unknown) {
  return sanitizeResultForLog(result);
}

function sanitizeResultForLog(value: unknown, depth = 0, key = ""): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[truncated]";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/base64|xml|html|cookie|token|clave|password|authorization|certificate|certificado|pfx|caf/i.test(key)) {
      return value ? `[redacted:${value.length}]` : "";
    }
    if (/url|href|source_url/i.test(key)) return sanitizeResultUrl(value);
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated:${value.length}]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeResultForLog(item, depth + 1, key));
  if (typeof value !== "object") return null;

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 80)) {
    if (/base64|xml|html|cookie|token|clave|password|authorization|certificate|certificado|pfx|caf/i.test(entryKey)) {
      output[entryKey] = typeof entryValue === "string" ? `[redacted:${entryValue.length}]` : "[redacted]";
      continue;
    }
    if (entryKey === "excerpt" || entryKey === "body_excerpt") {
      output[entryKey] = typeof entryValue === "string" ? `[redacted:${entryValue.length}]` : "[redacted]";
      continue;
    }
    output[entryKey] = sanitizeResultForLog(entryValue, depth + 1, entryKey);
  }
  return output;
}

function sanitizeResultUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated:${value.length}]` : value;
  }
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

async function recordSiiLocalFailure(
  sb: ServiceDb,
  job: { cuenta_id: string; empresa_id: string; usuario_id: string; job_id: string },
  error: string,
  summary: string,
  metadata: Record<string, unknown> = {},
  severity: "warn" | "error" = "error",
) {
  await recordOpsEvent({
    sb,
    severity,
    source: "sii-local",
    eventName: severity === "warn" ? "sii_local_result_warning" : "sii_local_result_failed",
    summary,
    cuentaId: job.cuenta_id,
    empresaId: job.empresa_id,
    usuarioId: job.usuario_id,
    resourceType: "emision_job",
    resourceId: job.job_id,
    metadata: { error, ...metadata },
  });
}

/**
 * Documento de origen de una propuesta (propuesta → movimiento → documento) en UNA
 * ida a la base con joins (plan-costo-vercel §6 PR 3; antes eran 3 idas en cadena por
 * boleta). Si el join falla por lo que sea, cae a la cadena de siempre: quedarse sin
 * el documento haría insertar una segunda fila "boleta_sii_local" (la mentira ámbar
 * de 2026-08-27).
 */
async function documentoDeLaPropuesta(sb: ServiceDb, propuestaId: string): Promise<{ id: string; tipo: string; progreso_ia: unknown } | null> {
  const { data, error } = await sb
    .from("propuestas_ia")
    .select("movimiento_id, movimientos_raw!propuestas_ia_movimiento_id_fkey(documento_id, documentos_subidos!movimientos_raw_documento_id_fkey(id, tipo, progreso_ia))")
    .eq("id", propuestaId)
    .maybeSingle();
  if (!error) {
    const mov = (data as { movimientos_raw?: unknown } | null)?.movimientos_raw;
    const movObj = (Array.isArray(mov) ? mov[0] : mov) as { documentos_subidos?: unknown } | null | undefined;
    const doc = movObj?.documentos_subidos;
    const docObj = (Array.isArray(doc) ? doc[0] : doc) as { id: string; tipo: string; progreso_ia: unknown } | null | undefined;
    return docObj ?? null;
  }
  const { data: prop } = await sb.from("propuestas_ia").select("movimiento_id").eq("id", propuestaId).maybeSingle();
  if (!prop?.movimiento_id) return null;
  const { data: movRow } = await sb.from("movimientos_raw").select("documento_id").eq("id", prop.movimiento_id).maybeSingle();
  if (!movRow?.documento_id) return null;
  const { data: reqDoc } = await sb.from("documentos_subidos").select("id, tipo, progreso_ia").eq("id", movRow.documento_id).maybeSingle();
  return reqDoc ?? null;
}

async function rememberResult(sb: ServiceDb, entry: { user_id: string; job_id: string | null; folio: number | null; status: string; error?: string | null; result: unknown }): Promise<boolean> {
  try {
    const { error: insertError } = await sb.from("sii_local_resultados").insert({
      user_id: entry.user_id,
      job_id: entry.job_id,
      folio: entry.folio,
      status: entry.status,
      error: entry.error ?? null,
      result: safeJson(resultForLog(entry.result)),
    });
    await sb
      .from("sii_local_resultados")
      .delete()
      .eq("user_id", entry.user_id)
      .lt("received_at", new Date(Date.now() - RESULT_RETENTION_DAYS * 24 * 3600 * 1000).toISOString());
    // true = la fila quedó guardada (la rama de sesión insegura depende de esto
    // para no decirle a la extensión que suelte un folio que no se guardó).
    if (insertError) console.error("[sii-local-result] no se pudo registrar el resultado", insertError.message);
    return !insertError;
  } catch (error) {
    // Log best-effort: si la tabla aún no existe (migración pendiente) no se
    // bloquea la emisión, solo se pierde la recuperación posterior.
    console.error("[sii-local-result] no se pudo registrar el resultado", error);
    return false;
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

function esFactura(tipoDte: number) {
  return tipoDte === 33 || tipoDte === 34;
}

function storagePathFor(args: { empresaId: string; tipoDte: number; folio: number }) {
  const carpeta = esFactura(args.tipoDte) ? "facturas-sii-local" : "boletas-sii-local";
  return `${args.empresaId}/${carpeta}/${args.tipoDte}-${args.folio}.pdf`;
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
    filename: cleanText(args.pdf.filename) ?? `${esFactura(args.tipoDte) ? "factura" : "boleta"}-sii-${args.tipoDte}-${args.folio}.pdf`,
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
  return { ...upload, filename: `${esFactura(args.tipoDte) ? "factura" : "boleta"}-sii-${args.tipoDte}-${args.folio}.pdf`, sourceUrl: sanitizeUrlForMetadata(args.pdfUrl) };
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

  // Exenta (boleta 41 / factura 34): todo el total es exento (no hay neto/iva).
  // El monto_exento del cliente se ignora — siempre es el total.
  if (tipoDte === 41 || tipoDte === 34) {
    return { monto_neto: 0, iva: 0, monto_exento: total };
  }

  // Afecta: se usan neto/iva del cliente SOLO si suman el total (±1 por redondeo).
  // Si no cuadran (o faltan), se recomputan desde el total —el valor confiable, ya
  // validado— para no persistir un desglose incoherente (neto+iva ≠ total).
  if (montoNeto !== null && iva !== null && Math.abs(montoNeto + iva - total) <= 1) {
    return { monto_neto: montoNeto, iva, monto_exento: 0 };
  }
  const neto = Math.round(total / 1.19);
  return { monto_neto: neto, iva: total - neto, monto_exento: 0 };
}

// 🛟 Respaldo idempotente de un folio cuando el trabajo (emision_job) ya NO está
// vivo (cerrado/expirado: ventana cerrada, cancelación, carrera) pero el SII SÍ
// emitió la boleta. Deriva el emisor de la empresa (no del job) y deduplica por
// empresa+tipo+folio. Espeja la forma de /api/sii-local/reconcile y NO toca el
// ciclo de vida del job ni el lock. Es la última línea de la invariante sagrada:
// "una boleta emitida nunca queda invisible en la app".
// Levanta la LÁPIDA: al quedar registrada la boleta de una propuesta que estaba
// "a medias" (revision_pendiente), su job pasa a 'completed' → la propuesta deja de
// estar bloqueada (ahora sale por yaEmitidas, no por enRevision). Idempotente: si ya
// está completed, el WHERE no matchea. Best-effort: la boleta ya quedó guardada, que
// es lo que importa.
/**
 * Declaraciones humanas (folio a mano / "no está en el SII"): la persona debe seguir
 * siendo miembro ACTIVO de la cuenta dueña del job (no basta un rol global). null = OK.
 */
async function accesoDeclaracion(sb: ServiceDb, userId: string, job: { empresa_id: string; cuenta_id: string }): Promise<NextResponse | null> {
  try {
    const acceso = await validarAccesoCuenta(sb, userId, job.empresa_id);
    if (!acceso.ok) return NextResponse.json({ ok: false, error: acceso.codigo }, { status: 403 });
    if (acceso.cuentaId !== job.cuenta_id) return NextResponse.json({ ok: false, error: "JOB_AJENO" }, { status: 403 });
    return null;
  } catch {
    return NextResponse.json({ ok: false, error: "ACCESO_NO_VERIFICADO" }, { status: 500 });
  }
}

/** `{ ref }` solo si existe: sin la migración aplicada, mandar la columna `ref` (aunque
 *  sea null) haría fallar el insert de un folio REAL. */
async function conRef(sb: ServiceDb, empresaId: string, propuestaId: string | null): Promise<{ ref?: string }> {
  const ref = await refDePropuesta(sb, empresaId, propuestaId);
  return ref ? { ref } : {};
}

/** Ref interna de una propuesta (emision_refs). Best-effort: null si no hay o falla. */
async function refDePropuesta(sb: ServiceDb, empresaId: string, propuestaId: string | null): Promise<string | null> {
  if (!propuestaId) return null;
  try {
    const { data } = await (sb as unknown as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { ref?: string } | null }> } } } } })
      .from("emision_refs").select("ref").eq("empresa_id", empresaId).eq("propuesta_id", propuestaId).maybeSingle();
    return typeof data?.ref === "string" ? data.ref : null;
  } catch {
    return null;
  }
}

async function liftRevisionTombstone(sb: ServiceDb, propuestaId: string | null, jobIdBoletaUnica?: string | null) {
  // Boleta ÚNICA (sin propuesta, seguridad 2026-09-30): su lápida vive en el job. Si
  // no se levanta al registrar el folio, el POST de jobs la seguiría viendo a medias.
  if (!propuestaId) {
    await levantarLapidaBoletaUnica(sb, jobIdBoletaUnica);
    return;
  }
  try {
    const ahoraIso = new Date().toISOString();
    await sb
      .from("emision_jobs")
      .update({ estado: "completed", estado_visible: "completed", updated_at: ahoraIso })
      .eq("propuesta_id", propuestaId)
      .eq("estado", "revision_pendiente");
    // + los SIN RESPUESTA (job del lote vencido y abierto, lapida.ts): con la boleta ya
    // registrada dejan de ser una duda; si no, seguirían apareciendo en "A medias".
    await sb
      .from("emision_jobs")
      .update({ estado: "completed", estado_visible: "completed", updated_at: ahoraIso })
      .eq("propuesta_id", propuestaId)
      .in("estado", ["created", "running"])
      .lt("expires_at", ahoraIso);
  } catch {
    /* best-effort */
  }
}

/**
 * La verificación de un intento ADOPTADO (adopcion.ts) registró la boleta: el intento
 * original se cierra `completed` aunque todavía no haya vencido (verificación por fin
 * confirmado de la extensión). Si no, al vencer volvería a aparecer "sin respuesta"
 * en A medias con la boleta ya registrada. Best-effort.
 */
/**
 * Glosa y receptor con que se EMITIÓ una propuesta (misma política que el lote:
 * resolverGlosa, nunca la glosa cruda del banco). Para registrar la boleta que
 * encontró una verificación. Best-effort: null si falla (queda el genérico).
 */
async function datosEmitidosDePropuesta(sb: ServiceDb, propuestaId: string, tipoDte: number) {
  try {
    const { data } = await sb
      .from("propuestas_ia")
      .select("notas, receptor_rut, receptor_nombre, receptor_giro, receptor_direccion, receptor_comuna, movimientos_raw!propuestas_ia_movimiento_id_fkey(documentos_subidos!movimientos_raw_documento_id_fkey(glosa_comun, glosa_activa))")
      .eq("id", propuestaId)
      .maybeSingle();
    if (!data) return null;
    const p = data as unknown as {
      notas: string | null; receptor_rut: string | null; receptor_nombre: string | null; receptor_giro: string | null;
      receptor_direccion: string | null; receptor_comuna: string | null;
      movimientos_raw?: { documentos_subidos?: { glosa_comun?: string | null; glosa_activa?: boolean | null } | Array<{ glosa_comun?: string | null; glosa_activa?: boolean | null }> | null } | Array<{ documentos_subidos?: unknown }> | null;
    };
    const mov = Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw;
    const docRaw = (mov as { documentos_subidos?: unknown } | null | undefined)?.documentos_subidos;
    const doc = (Array.isArray(docRaw) ? docRaw[0] : docRaw) as { glosa_comun?: string | null; glosa_activa?: boolean | null } | null | undefined;
    const glosa = resolverGlosa(
      { notas: p.notas, glosaComun: doc?.glosa_comun ?? null, glosaComunActiva: doc?.glosa_activa ?? null },
      tipoDte === 39 || tipoDte === 41 ? tipoDte : undefined,
    );
    return {
      glosa,
      receptor: {
        rut: p.receptor_rut, razon_social: p.receptor_nombre, giro: p.receptor_giro,
        direccion: p.receptor_direccion, comuna: p.receptor_comuna,
      },
    };
  } catch {
    return null;
  }
}

async function levantarAdoptado(sb: ServiceDb, job: { origin?: string | null; propuesta_id?: string | null }) {
  const adoptado = jobAdoptadoDeOrigen(job.origin ?? null);
  if (!adoptado || !job.propuesta_id) return;
  try {
    await sb
      .from("emision_jobs")
      .update({ estado: "completed", estado_visible: "completed", updated_at: new Date().toISOString() })
      .eq("job_id", adoptado)
      .eq("propuesta_id", job.propuesta_id)
      .in("estado", ["created", "running", "revision_pendiente"]);
    await liftRevisionTombstone(sb, job.propuesta_id);
  } catch {
    /* best-effort */
  }
}

// 0.2.8 (cierre del ciclo, adversarial F3): un folio "alto" que salió del calce único
// en /reportes (monto + fecha + hora) NO se acepta si HOY esta empresa tiene otra boleta
// del mismo tipo y monto "a medias" (lápida revision_pendiente sin boleta): la fila
// única que el worker vio puede ser ESA boleta y no la recién emitida (LC tuvo 3
// seguidas de $300.000). En ese caso el resultado se trata como evidencia débil →
// lápida, y el humano confirma con el folio sugerido. Best-effort: si la consulta
// falla, se veta (fail-closed: prefiere "a medias" a un folio cruzado).
async function calceReportesVetado(
  sb: ServiceDb,
  args: { empresaId: string; tipoDte: number; montoTotal: number; fechaEmision: string; jobId: string | null; propuestaId?: string | null },
): Promise<boolean> {
  try {
    // -04:00 (invierno) cubre también el horario de verano: una hora de más solo sobre-veta.
    const desde = `${args.fechaEmision}T00:00:00-04:00`;
    // Lápidas a medias + SIN RESPUESTA (2026-09-28, I1): una boleta colgada del mismo
    // monto también puede ser la fila única que vio el worker.
    const { data: lapidas, error: errLapidas } = await sb
      .from("emision_jobs")
      .select("job_id, propuesta_id, estado, expires_at, created_at")
      .eq("empresa_id", args.empresaId)
      .in("estado", [...ESTADOS_LAPIDA])
      .gte("created_at", desde)
      .not("propuesta_id", "is", null)
      .limit(50);
    // M1: Supabase devuelve {error} sin lanzar → fail-closed explícito.
    if (errLapidas) return true;
    const ahoraVeto = new Date();
    // Las lápidas de la MISMA propuesta no vetan: son la misma boleta (la verificación
    // de un intento adoptado busca justamente la fila de ese intento, adopcion.ts).
    const otras = (lapidas ?? []).filter((j) => j.job_id !== args.jobId && j.propuesta_id && j.propuesta_id !== args.propuestaId && esLapidaEfectiva(j, ahoraVeto) !== null);
    if (otras.length === 0) return false;
    const { data: props, error: errProps } = await sb
      .from("propuestas_ia")
      .select("id, total, tipo_dte")
      .in("id", otras.map((j) => j.propuesta_id as string));
    if (errProps) return true;
    return (props ?? []).some((p) => Math.round(Number(p.total)) === args.montoTotal && (p.tipo_dte == null || p.tipo_dte === args.tipoDte));
  } catch {
    return true;
  }
}

function esCalceReportes(result: SiiLocalResultPayload["result"] | null | undefined): boolean {
  const ev = result?.folio_evidence as { source?: string } | null | undefined;
  return ev?.source === "reportes_calce_unico";
}

/**
 * Boleta única: un folio que YA estaba registrado solo levanta la lápida de este job
 * si esa boleta se registró PARA este job (track_id / proveedor_respuesta.job_id). Sin
 * propuesta no hay otra forma de saber que no es el folio de otra boleta (cruce de
 * /reportes) — y levantar la lápida por un folio ajeno abriría la re-emisión.
 */
async function jobSiLaBoletaEsSuya(sb: ServiceDb, boletaId: string, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;
  try {
    const { data } = await sb.from("boletas_emitidas").select("track_id, proveedor_respuesta").eq("id", boletaId).maybeSingle();
    const pr = (data?.proveedor_respuesta ?? null) as { job_id?: unknown } | null;
    const suya = (typeof data?.track_id === "string" && data.track_id.includes(jobId)) || pr?.job_id === jobId;
    return suya ? jobId : null;
  } catch {
    return null;
  }
}

async function backfillFolioSinJobVivo(
  sb: ServiceDb,
  args: {
    empresaId: string;
    tipoDte: 33 | 34 | 39 | 41;
    folio: number;
    montoTotal: number;
    fechaEmision: string;
    totales: { monto_total?: number | null; monto_neto?: number | null; iva?: number | null; monto_exento?: number | null } | null;
    jobId: string | null;
    propuestaId: string | null;
    /** Payload completo: la red anti-pérdida también SUBE el PDF si vino. */
    result?: SiiLocalResultPayload["result"];
    pdfInfo?: SiiLocalPdfInfo | null;
    /** Boleta única (sin propuesta): receptor y detalle del INTENTO guardado en el job. */
    intento?: IntentoBoletaUnica | null;
  },
): Promise<{ ok: boolean; boletaId?: string; already?: boolean; error?: string }> {
  const { data: empresa } = await sb
    .from("empresas").select("rut, razon_social, giro, direccion, comuna").eq("id", args.empresaId).single();
  if (!empresa?.rut || !empresa?.razon_social) return { ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" };

  // EL PDF NO SE TIRA (cazado en el primer lote real, folio 966): el payload
  // llegaba CON el PDF (228 KB) pero esta ruta solo guardaba el folio y lo
  // marcaba pdf_pendiente. Si el PDF vino en el mismo paquete, se sube igual.
  const pdfBackfill = (args.result?.pdf || args.pdfInfo)
    ? await uploadResultPdf(sb, { empresaId: args.empresaId, tipoDte: args.tipoDte, folio: args.folio, result: args.result ?? null, pdfInfo: args.pdfInfo ?? null }).catch(() => null)
    : null;

  // El receptor sale de la propuesta (ver backfillRow): el rescate solo aporta
  // folio y monto, y sin esto la boleta quedaba como "consumidor final".
  const { data: prop } = args.propuestaId
    ? await sb.from("propuestas_ia")
        .select("receptor_rut, receptor_nombre, receptor_giro, receptor_direccion, receptor_comuna")
        .eq("id", args.propuestaId).maybeSingle()
    : { data: null };

  // Dedup por la MISMA clave que el índice UNIQUE(empresa_id, tipo_dte, folio) —
  // sin filtrar estado — para no chocar con la constraint ni "registrar" un folio
  // nuevo apuntando a una boleta anulada (coincide con el camino vivo).
  const { data: existing } = await sb
    .from("boletas_emitidas").select("id, propuesta_id")
    .eq("empresa_id", args.empresaId).eq("tipo_dte", args.tipoDte).eq("folio", args.folio)
    .maybeSingle();
  if (existing) {
    // FOLIO DE OTRO DOCUMENTO (adversarial 0.2.8, F1): si el folio ya es de OTRA
    // propuesta, este resultado es un cruce (p. ej. /reportes mostró la boleta
    // anterior). Antes se respondía "already" y se LEVANTABA la lápida de esta
    // propuesta → quedaba re-emitible → doble folio. Ahora: ni se levanta ni se
    // registra; la lápida sigue y el humano confirma el folio real.
    if (existing.propuesta_id && args.propuestaId && existing.propuesta_id !== args.propuestaId) {
      return { ok: false, error: "FOLIO_DE_OTRO_DOCUMENTO" };
    }
    await liftRevisionTombstone(sb, args.propuestaId, await jobSiLaBoletaEsSuya(sb, existing.id, args.jobId));
    return { ok: true, boletaId: existing.id, already: true };
  }

  const totals = totalsFor(args.tipoDte, args.montoTotal, args.totales);
  const backfillRow = {
    empresa_id: args.empresaId,
    // Enlace propuesta ↔ folio también en la ruta de recuperación (job cerrado):
    // sin esto la boleta respaldada quedaría sin enlace y su propuesta seguiría
    // "pendiente" → el orbe la marcaría y re-emitirla generaría un folio nuevo.
    propuesta_id: args.propuestaId ?? null,
    tipo_dte: args.tipoDte,
    folio: args.folio,
    fecha_emision: args.fechaEmision,
    emisor_rut: empresa.rut,
    emisor_razon_social: empresa.razon_social,
    emisor_giro: empresa.giro,
    emisor_direccion: empresa.direccion,
    emisor_comuna: empresa.comuna,
    // RECEPTOR desde la PROPUESTA (2026-08-27): el rescate solo aporta folio y
    // monto, así que la boleta respaldada salía como "consumidor final" aunque
    // el documento sí identificaba a su receptor. Se lee de la propuesta, que
    // es la fuente de verdad de lo que se emitió.
    ...(!prop && args.intento ? {
      receptor_rut: args.intento.receptor_rut,
      receptor_razon_social: args.intento.receptor_nombre,
    } : {}),
    ...(prop ? {
      receptor_rut: prop.receptor_rut ?? null,
      receptor_razon_social: prop.receptor_nombre ?? null,
      receptor_giro: prop.receptor_giro ?? null,
      receptor_direccion: prop.receptor_direccion ?? null,
      receptor_comuna: prop.receptor_comuna ?? null,
    } : {}),
    monto_neto: totals.monto_neto,
    monto_exento: totals.monto_exento,
    iva: totals.iva,
    monto_total: args.montoTotal,
    detalles: [{ nro_lin: 1, nombre: args.intento?.detalle ?? "Servicio prestado", qty: 1, monto: args.montoTotal }],
    xml_dte: `sii-local://boleta/${args.tipoDte}/${args.folio}`,
    ted: `sii-local://ted/${args.tipoDte}/${args.folio}`,
    track_id: `sii-local-recovery:${args.jobId ?? "manual"}:${args.tipoDte}:${args.folio}`,
    estado: "aceptado",
    emision_proveedor: "sii_local",
    emision_sandbox: false,
    proveedor_respuesta: {
      origen: "backfill_job_cerrado",
      job_id: args.jobId,
      pdf_pendiente: !pdfBackfill?.storagePath,
      ...(pdfBackfill?.storagePath ? {
        pdf: {
          storage_path: pdfBackfill.storagePath,
          filename: pdfBackfill.filename ?? null,
          content_type: "application/pdf",
          source_url: pdfBackfill.sourceUrl ?? null,
          provider: "provider" in pdfBackfill ? pdfBackfill.provider : null,
        },
      } : {}),
      recuperado_en: new Date().toISOString(),
    },
  };
  const { data: boleta, error } = await sb
    .from("boletas_emitidas")
    .insert(backfillRow)
    .select("id").single();

  if (error || !boleta) {
    // Carrera: otra request insertó el mismo folio entremedio → tratar como already.
    const { data: raced } = await sb
      .from("boletas_emitidas").select("id, propuesta_id")
      .eq("empresa_id", args.empresaId).eq("tipo_dte", args.tipoDte).eq("folio", args.folio).maybeSingle();
    if (raced) {
      if (raced.propuesta_id && args.propuestaId && raced.propuesta_id !== args.propuestaId) {
        return { ok: false, error: "FOLIO_DE_OTRO_DOCUMENTO" };
      }
      await liftRevisionTombstone(sb, args.propuestaId, await jobSiLaBoletaEsSuya(sb, raced.id, args.jobId));
      return { ok: true, boletaId: raced.id, already: true };
    }
    // Doble folio para la MISMA propuesta (choque con idx_boletas_propuesta_unica_
    // vigente, NO con el folio): registrar el folio B DESACOPLADO (propuesta_id
    // null) para que no quede invisible + alerta ops crítica. Mismo patrón que el
    // POST principal. No se levanta la lápida: el folio A ya bloquea la re-emisión
    // (PROPUESTA_YA_EMITIDA); la alerta lo marca para revisión humana.
    if (args.propuestaId) {
      const { data: propViva } = await sb
        .from("boletas_emitidas").select("id, folio")
        .eq("empresa_id", args.empresaId).eq("propuesta_id", args.propuestaId).neq("estado", "anulada").maybeSingle();
      if (propViva && String(propViva.folio) !== String(args.folio)) {
        const { data: boletaB } = await sb
          .from("boletas_emitidas").insert({ ...backfillRow, propuesta_id: null, ...(await conRef(sb, args.empresaId, args.propuestaId)) }).select("id").single();
        await recordOpsEvent({
          sb, severity: "critical", source: "sii-local", eventName: "doble_folio_propuesta",
          summary: `Doble folio para una propuesta (recuperación): folios ${propViva.folio} y ${args.folio}`,
          empresaId: args.empresaId, resourceType: "emision_job", resourceId: args.jobId ?? null,
          metadata: { tipo_dte: args.tipoDte, folio_a: propViva.folio, folio_b: args.folio, propuesta_id: args.propuestaId, boleta_b_id: boletaB?.id ?? null },
        });
        if (boletaB) return { ok: true, boletaId: boletaB.id, already: false };
      }
    }
    return { ok: false, error: error?.message ?? "INSERT_FAILED" };
  }
  await liftRevisionTombstone(sb, args.propuestaId, args.jobId);
  return { ok: true, boletaId: boleta.id, already: false };
}

export async function POST(request: Request) {
  // Fuera del matcher del proxy: sesión + inactividad + MFA aal2 se evalúan ACÁ
  // (sesion-segura.ts). Sin usuario → 401 siempre.
  const guard = await requireSesionSegura();
  const user = guard.user;
  if (!user) return guard.ok ? respuestaSesionInsegura("NO_AUTH") : guard.response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient<Database>(url, key);

  let payload: SiiLocalResultPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // Sesión insegura (inactividad vencida o MFA pendiente) con usuario válido
  // (política completa en lib/emission/result-sesion-insegura.ts):
  //  · captura del folio de la extensión → SOLO al stash del servidor, NUNCA a
  //    boletas_emitidas (una sesión aal1 no escribe libros). Se responde ok para que
  //    la extensión suelte su copia local: el folio ya vive en el servidor. Tras el
  //    MFA, "Recuperar folio" (recover_latest) lo promueve con todos los gates.
  //  · todo lo demás (declaraciones humanas, recover_latest, formulario manual) → 401.
  // Si el stash del servidor falla → 503: la extensión conserva su copia y reintenta.
  if (!guard.ok) {
    if (politicaResultSesionInsegura(payload) === "bloquear") return guard.response;
    const jobIdInseguro = typeof payload.job_id === "string" && payload.job_id.trim() ? payload.job_id.trim() : null;
    const folioInseguro = positiveInt(payload.result?.folio);
    const guardado = await rememberResult(sb, {
      user_id: user.id,
      job_id: jobIdInseguro,
      folio: folioInseguro,
      status: STATUS_SESION_INSEGURA,
      error: guard.motivo,
      result: payload.result,
    });
    await recordOpsEvent({
      sb,
      severity: "warn",
      source: "sii-local",
      eventName: "sii_local_result_sesion_insegura",
      summary: guardado
        ? `Resultado SII guardado SOLO en el stash (sesión insegura: ${guard.motivo}); se registra tras el MFA con "Recuperar folio"`
        : `Resultado SII con sesión insegura (${guard.motivo}) y el stash falló: la extensión conserva su copia`,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobIdInseguro,
      metadata: { motivo: guard.motivo, folio: folioInseguro, stash_ok: guardado },
    });
    if (!guardado) {
      return NextResponse.json({ ok: false, error: "STASH_NO_DISPONIBLE", sesion: guard.motivo }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      boleta_id: null,
      folio: folioInseguro,
      pendiente_verificacion_sesion: guard.motivo,
      detalle: "El folio quedó resguardado. Entra a massDTE y usa «Recuperar folio» para registrarlo.",
    });
  }

  // Telemetría de flota (bridge 0.1.7+): anota qué versión corre esta empresa.
  // Best-effort TOTAL: jamás puede frenar la persistencia de un folio real.
  if (typeof payload.extension_version === "string" && /^\d+(\.\d+)*$/.test(payload.extension_version)) {
    try {
      const { data: u } = await sb.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();
      if (u?.empresa_id) {
        await sb
          .from("empresas")
          .update({ ext_last_version: payload.extension_version, ext_last_seen_at: new Date().toISOString() })
          .eq("id", u.empresa_id);
      }
    } catch { /* columnas sin migrar o fallo puntual: la telemetría espera */ }
  }

  // Declaraciones HUMANAS (folio a mano / "no está en el SII"): exigen el mismo rol de
  // emisión y no estar vetado que el resto de la ruta (antes solo exigían ser dueño
  // del job: un usuario vetado o degradado podía devolver boletas a Listas).
  if (payload.registrar_folio_manual != null || payload.declarar_no_salio === true || payload.veredicto_verificacion != null) {
    const { data: uDecl } = await sb.from("usuarios").select("rol, vetado").eq("id", user.id).maybeSingle();
    if (!uDecl || uDecl.vetado) return NextResponse.json({ ok: false, error: "USUARIO_BLOQUEADO" }, { status: 403 });
    if (!ROLES_EMISION.has(String(uDecl.rol))) return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 });
  }

  // ── RESCATE MANUAL DEL FOLIO ────────────────────────────────────────────
  // El RPA emitió (hay folio real en el SII) pero no capturó la pantalla: el
  // job quedó con lápida y "Recuperar folio" no tiene nada que rescatar. Acá
  // el humano declara el número que ve en pantalla. Fail-closed:
  //  · solo sobre un job propio en 'revision_pendiente' (una lápida real; no
  //    se puede inventar un folio para un job cualquiera),
  //  · el UNIQUE(empresa, tipo_dte, folio) impide duplicar un folio ya vivo,
  //  · el monto/tipo/fecha salen de la PROPUESTA (el humano aporta el folio,
  //    no la plata),
  //  · queda auditado como declaración humana, no como captura del RPA.
  if (payload.registrar_folio_manual != null) {
    const folioManual = positiveInt(payload.registrar_folio_manual);
    if (!folioManual) return NextResponse.json({ ok: false, error: "FOLIO_INVALIDO", detalle: "El folio debe ser un número mayor a cero." }, { status: 400 });
    const jobIdManual = cleanText(payload.job_id);
    if (!jobIdManual) return NextResponse.json({ ok: false, error: "JOB_ID_REQUERIDO" }, { status: 400 });

    const { data: jobManual } = await sb
      .from("emision_jobs")
      .select("job_id, estado, empresa_id, cuenta_id, usuario_id, propuesta_id, expires_at, created_at")
      .eq("job_id", jobIdManual)
      .maybeSingle();
    if (!jobManual) return NextResponse.json({ ok: false, error: "JOB_NO_ENCONTRADO" }, { status: 404 });
    // Cualquier persona ACTIVA de la misma cuenta con rol de emisión (no solo quien
    // lanzó el intento: si Marge no está, la clienta no queda trabada). Auditado.
    const accesoManual = await accesoDeclaracion(sb, user.id, jobManual);
    if (accesoManual) return accesoManual;
    // BOLETA ÚNICA a medias (rev. adversarial M1/M2, 2026-09-30): su folio se registra
    // con los datos del INTENTO guardado en el job (o, sin la migración, con el monto y
    // tipo que la persona declara de ESA boleta), nunca con el borrador nuevo. Puede
    // hacerlo cualquier persona activa de la cuenta con rol de emisión (acceso arriba).
    if (!jobManual.propuesta_id) {
      if (!esLapidaBoletaUnica(jobManual)) {
        return NextResponse.json({ ok: false, error: "JOB_SIN_LAPIDA", detalle: "Este intento no quedó a medias: no corresponde registrar un folio a mano." }, { status: 409 });
      }
      const { data: jobFull } = await sb.from("emision_jobs").select("*").eq("job_id", jobManual.job_id).maybeSingle();
      const decl = payload.monto_declarado != null ? { monto: Number(payload.monto_declarado), tipo_dte: Number(payload.tipo_dte_declarado) } : null;
      const datosU = datosFolioBoletaUnica((jobFull ?? {}) as { intento?: unknown }, decl);
      if (!datosU.ok) return NextResponse.json({ ok: false, error: datosU.error, detalle: datosU.detalle }, { status: 422 });
      const { data: yaReg } = await sb
        .from("boletas_emitidas").select("id")
        .eq("empresa_id", jobManual.empresa_id).eq("tipo_dte", datosU.tipo_dte).eq("folio", folioManual)
        .maybeSingle();
      if (yaReg && !(await jobSiLaBoletaEsSuya(sb, yaReg.id, jobManual.job_id))) {
        return NextResponse.json(
          { ok: false, error: "FOLIO_DE_OTRO_DOCUMENTO", detalle: `El folio ${folioManual} ya está registrado en otra boleta. Revisa el número en el SII; esta boleta sigue a medias.` },
          { status: 409 },
        );
      }
      const respaldoU = await backfillFolioSinJobVivo(sb, {
        empresaId: jobManual.empresa_id,
        tipoDte: datosU.tipo_dte,
        folio: folioManual,
        montoTotal: datosU.monto,
        fechaEmision: chileDateString(new Date(jobManual.created_at)),
        totales: null,
        jobId: jobManual.job_id,
        propuestaId: null,
        intento: datosU.intento,
      });
      if (!respaldoU.ok) return NextResponse.json({ ok: false, error: "REGISTRO_MANUAL_FALLIDO", detalle: respaldoU.error }, { status: 500 });
      await recordOpsEvent({
        sb, severity: "warn", source: "sii-local", eventName: "sii_local_folio_declarado_a_mano",
        summary: `Folio ${folioManual} declarado a mano para una boleta única a medias`,
        empresaId: jobManual.empresa_id, cuentaId: jobManual.cuenta_id, usuarioId: user.id,
        resourceType: "emision_job", resourceId: jobManual.job_id,
        metadata: { folio: folioManual, tipo_dte: datosU.tipo_dte, boleta_unica: true, monto_de: datosU.intento ? "intento" : "declarado", lanzado_por_otra_persona: jobManual.usuario_id !== user.id },
      });
      return NextResponse.json({ ok: true, boleta_id: respaldoU.boletaId ?? null, folio: folioManual, already_exists: Boolean(respaldoU.already), recuperado: true });
    }
    // Lápida real: a medias (revision_pendiente) o SIN RESPUESTA (job del lote vencido
    // y abierto, lapida.ts) — la clienta ve su folio en el SII y lo registra.
    if (esLapidaEfectiva(jobManual) === null) {
      return NextResponse.json(
        { ok: false, error: "JOB_SIN_LAPIDA", detalle: "Este intento no quedó a medias: no corresponde registrar un folio a mano." },
        { status: 409 },
      );
    }
    if (!jobManual.propuesta_id) {
      return NextResponse.json({ ok: false, error: "JOB_SIN_PROPUESTA", detalle: "Este intento no tiene documento asociado; escríbenos a soporte." }, { status: 409 });
    }

    const { data: propManual } = await sb
      .from("propuestas_ia")
      .select("tipo_dte, total, created_at")
      .eq("id", jobManual.propuesta_id)
      .maybeSingle();
    const tipoManual = propManual?.tipo_dte;
    const montoManual = Number(propManual?.total);
    if (!tipoManual || ![33, 34, 39, 41].includes(tipoManual) || !Number.isFinite(montoManual) || montoManual <= 0) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_INCOMPLETA" }, { status: 409 });
    }

    // FOLIO DE OTRO DOCUMENTO (cazado por prueba adversarial 2026-08-27): si el
    // folio tecleado YA pertenece a otra propuesta, el backfill lo trataba como
    // "already_exists: ok" y —peor— levantaba la lápida de ESTE intento. Un
    // dedazo dejaba re-emitible un documento que puede tener su propio folio
    // real en el SII → doble folio, el peor desenlace del producto. Se rechaza
    // y la lápida se queda donde está.
    const { data: folioAjeno } = await sb
      .from("boletas_emitidas")
      .select("id, propuesta_id")
      .eq("empresa_id", jobManual.empresa_id)
      .eq("tipo_dte", tipoManual)
      .eq("folio", folioManual)
      .maybeSingle();
    if (folioAjeno && folioAjeno.propuesta_id && folioAjeno.propuesta_id !== jobManual.propuesta_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "FOLIO_DE_OTRO_DOCUMENTO",
          detalle: `El folio ${folioManual} ya está registrado en otro documento. Revisa el número en la ventana del SII; este intento sigue bloqueado.`,
        },
        { status: 409 },
      );
    }

    const respaldoManual = await backfillFolioSinJobVivo(sb, {
      empresaId: jobManual.empresa_id,
      tipoDte: tipoManual as 33 | 34 | 39 | 41,
      folio: folioManual,
      montoTotal: montoManual,
      fechaEmision: chileDateString(new Date(propManual?.created_at ?? Date.now())),
      totales: null,
      jobId: jobManual.job_id,
      propuestaId: jobManual.propuesta_id,
    });
    if (!respaldoManual.ok) {
      return NextResponse.json({ ok: false, error: "REGISTRO_MANUAL_FALLIDO", detalle: respaldoManual.error }, { status: 500 });
    }
    await recordOpsEvent({
      sb,
      severity: "warn",
      source: "sii-local",
      eventName: "sii_local_folio_declarado_a_mano",
      summary: `Folio ${folioManual} declarado a mano por el usuario (el RPA no lo capturó)`,
      empresaId: jobManual.empresa_id,
      cuentaId: jobManual.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobManual.job_id,
      metadata: { folio: folioManual, tipo_dte: tipoManual, already_exists: Boolean(respaldoManual.already), origen: "declaracion_humana" },
    });
    return NextResponse.json({
      ok: true,
      boleta_id: respaldoManual.boletaId ?? null,
      folio: folioManual,
      already_exists: Boolean(respaldoManual.already),
      recuperado: true,
    });
  }

  // ── SALIDA HUMANA: "Revisé el SII y no está" ─────────────────────────────
  // Sin esto una lápida que la verificación no alcanza (otro día: /reportes muestra
  // solo hoy; más de 250 boletas; extensión vieja) dejaba a la clienta TRABADA para
  // siempre. Fail-closed: solo el dueño del job, solo sobre una lápida real
  // (lapida.ts), solo si la propuesta NO tiene boleta vigente. Cierra como `failed`
  // TODAS las lápidas de esa propuesta (si queda una, sigue bloqueada) y deja rastro
  // de que fue una declaración humana, no un veredicto del RPA.
  if (payload.declarar_no_salio === true) {
    const jobIdDecl = cleanText(payload.job_id);
    if (!jobIdDecl) return NextResponse.json({ ok: false, error: "JOB_ID_REQUERIDO" }, { status: 400 });
    const { data: jobDecl, error: errDecl } = await sb
      .from("emision_jobs")
      .select("job_id, estado, empresa_id, cuenta_id, usuario_id, propuesta_id, expires_at, created_at, updated_at")
      .eq("job_id", jobIdDecl)
      .maybeSingle();
    if (errDecl) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED" }, { status: 500 });
    if (!jobDecl) return NextResponse.json({ ok: false, error: "JOB_NO_ENCONTRADO" }, { status: 404 });
    const accesoDecl = await accesoDeclaracion(sb, user.id, jobDecl);
    if (accesoDecl) return accesoDecl;
    // BOLETA ÚNICA a medias (seguridad 2026-09-30, punto 1): sin propuesta, la lápida
    // vive en el job y retiene el candado. Misma salida humana que el lote, con sus
    // propios controles (boleta-unica-lapida.ts): lápida real, sin folio capturado,
    // UPDATE re-filtrado por estado; suelta el candado.
    if (!jobDecl.propuesta_id) {
      const decl = await declararNoSalioBoletaUnica(sb, jobDecl);
      if (!decl.ok) return NextResponse.json({ ok: false, error: decl.error, detalle: decl.detalle }, { status: decl.status });
      await recordOpsEvent({
        sb,
        severity: "warn",
        source: "sii-local",
        eventName: "sii_local_no_salio_declarado_a_mano",
        summary: "La persona declaró que la boleta única no salió en el SII (se puede volver a emitir)",
        empresaId: jobDecl.empresa_id,
        cuentaId: jobDecl.cuenta_id,
        usuarioId: user.id,
        resourceType: "emision_job",
        resourceId: jobDecl.job_id,
        metadata: { jobs_cerrados: 1, origen: "declaracion_humana", boleta_unica: true, lanzado_por_otra_persona: jobDecl.usuario_id !== user.id },
      });
      await recordCuentaAudit({
        sb,
        cuentaId: jobDecl.cuenta_id,
        empresaId: jobDecl.empresa_id,
        usuarioId: user.id,
        accion: "emision_fallida",
        recursoTipo: "emision_job",
        recursoId: jobDecl.job_id,
        resumen: "Declaró que la boleta única no salió en el SII tras revisarlo",
        metadata: { origen: "declaracion_no_salio", boleta_unica: true },
      });
      return NextResponse.json({ ok: true, jobs_cerrados: 1 });
    }
    if (!jobDecl.propuesta_id || esLapidaEfectiva(jobDecl) === null) {
      return NextResponse.json({ ok: false, error: "JOB_SIN_LAPIDA", detalle: "Este intento no está a medias." }, { status: 409 });
    }
    if (!puedeDeclararNoSalio(jobDecl)) {
      return NextResponse.json(
        { ok: false, error: "MUY_PRONTO", detalle: "Esta boleta quedó sin respuesta hace poco y el SII podría seguir procesándola. Espera unos minutos y revísala de nuevo." },
        { status: 409 },
      );
    }
    const { data: boletaVigente, error: errBol } = await sb
      .from("boletas_emitidas")
      .select("id, folio")
      .eq("propuesta_id", jobDecl.propuesta_id)
      .neq("estado", "anulada")
      .limit(1)
      .maybeSingle();
    if (errBol) return NextResponse.json({ ok: false, error: "BOLETA_QUERY_FAILED" }, { status: 500 });
    if (boletaVigente) {
      return NextResponse.json(
        { ok: false, error: "PROPUESTA_YA_EMITIDA", detalle: `Esta boleta ya está registrada con el folio ${boletaVigente.folio}.` },
        { status: 409 },
      );
    }
    const { data: lapidasProp, error: errLap } = await sb
      .from("emision_jobs")
      .select("job_id, estado, propuesta_id, expires_at, created_at")
      .eq("propuesta_id", jobDecl.propuesta_id)
      .in("estado", [...ESTADOS_LAPIDA]);
    if (errLap) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED" }, { status: 500 });
    const ahoraDecl = new Date();
    const aCerrar = (lapidasProp ?? []).filter((j) => esLapidaEfectiva(j, ahoraDecl) !== null).map((j) => j.job_id);
    // El plazo vale para CADA lápida que se va a cerrar, no solo la declarada: una
    // verificación sellada a medias no puede arrastrar a Listas al intento original
    // sin respuesta que venció hace minutos (podría seguir vivo → doble folio).
    const plazo = plazoDeclararNoSalio(lapidasProp ?? [], ahoraDecl);
    if (!plazo.ok) {
      const hora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(plazo.desdeMs));
      return NextResponse.json(
        { ok: false, error: "MUY_PRONTO", desde: new Date(plazo.desdeMs).toISOString(), detalle: `Esta boleta quedó sin respuesta hace poco y el SII podría seguir procesándola. Podrás marcarla desde las ${hora}.` },
        { status: 409 },
      );
    }
    // Si el server YA tiene un folio capturado para alguno de esos intentos (stash de
    // la extensión), la boleta salió: no se puede declarar "no salió" (doble folio).
    if (aCerrar.length > 0) {
      const { data: conFolio, error: errRes } = await sb
        .from("sii_local_resultados")
        .select("folio")
        .in("job_id", aCerrar)
        .not("folio", "is", null)
        .limit(1);
      if (errRes) return NextResponse.json({ ok: false, error: "RESULTADOS_QUERY_FAILED" }, { status: 500 });
      if ((conFolio ?? []).length > 0) {
        return NextResponse.json(
          { ok: false, error: "FOLIO_CAPTURADO", detalle: `El SII devolvió el folio ${conFolio![0].folio} para este intento: la boleta sí salió. Regístrala con ese folio.` },
          { status: 409 },
        );
      }
    }
    const mensaje = "Declarado por la persona: revisó el SII y la boleta no salió";
    // Directo a la tabla, NO por releaseCuentaEmissionLock: su guard prohíbe (a
    // propósito) bajar una lápida a `failed`; esta es la única puerta que lo permite,
    // y solo con la declaración humana. El candado del lote ya se soltó al sellarla.
    // Re-filtra por estado en el UPDATE: si entre el select y acá llegó un resultado
    // (lift → completed) o un latido revivió el job, no se pisa.
    const ahoraIso = ahoraDecl.toISOString();
    const { data: cerrados, error: errUpd } = await sb
      .from("emision_jobs")
      .update({ estado: "failed", estado_visible: "failed", status_message: mensaje, updated_at: ahoraIso })
      .in("job_id", aCerrar)
      .or(`estado.eq.revision_pendiente,and(estado.in.(created,running),expires_at.lt.${ahoraIso})`)
      .select("job_id");
    if (!errUpd && (cerrados ?? []).length === 0) {
      return NextResponse.json({ ok: false, error: "NADA_QUE_CERRAR", detalle: "Esta boleta cambió de estado mientras la marcabas (llegó su resultado o sigue en curso). Recarga y revísala de nuevo." }, { status: 409 });
    }
    if (errUpd) return NextResponse.json({ ok: false, error: "DECLARACION_FALLIDA", detalle: errUpd.message }, { status: 500 });
    await recordOpsEvent({
      sb,
      severity: "warn",
      source: "sii-local",
      eventName: "sii_local_no_salio_declarado_a_mano",
      summary: "La persona declaró que la boleta no salió en el SII (vuelve a Listas)",
      empresaId: jobDecl.empresa_id,
      cuentaId: jobDecl.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobDecl.job_id,
      metadata: { jobs_cerrados: (cerrados ?? []).length, origen: "declaracion_humana", lanzado_por_otra_persona: jobDecl.usuario_id !== user.id },
    });
    await recordCuentaAudit({
      sb,
      cuentaId: jobDecl.cuenta_id,
      empresaId: jobDecl.empresa_id,
      usuarioId: user.id,
      accion: "emision_fallida",
      recursoTipo: "emision_job",
      recursoId: jobDecl.job_id,
      resumen: "Declaró que la boleta no salió en el SII tras revisarlo (vuelve a Listas)",
      metadata: { origen: "declaracion_no_salio", jobs_cerrados: (cerrados ?? []).length },
    });
    return NextResponse.json({ ok: true, jobs_cerrados: (cerrados ?? []).length });
  }

  // ── VEREDICTO "NO SALIÓ" DE UNA VERIFICACIÓN ────────────────────────────
  // La extensión 0.2.8 entrega "verificado_sin_folio" (tabla completa leída, 0
  // candidatas) solo a la PÁGINA y no persiste evidencia de esa lectura en el server:
  // lo que llega acá es la palabra de la página. Por eso el server no la trata como
  // evidencia del SII sino como una declaración con controles: el job de verificación
  // tiene que haber adoptado al intento (enlace escrito al crearlo, adopcion.ts), ambos
  // abiertos, mismo día Chile, sin folio ni boleta, y el MISMO plazo que la declaración
  // humana (vía vencido: expires_at + 30 min; vía fin: 10 min desde el último signo de
  // vida). Antes del plazo → MUY_PRONTO (queda a medias). Se audita tal cual es.
  // (Cuando la extensión persista la lectura en sii_local_resultados, usarla acá.)
  if (payload.veredicto_verificacion != null) {
    if (payload.veredicto_verificacion !== "no_salio") return NextResponse.json({ ok: false, error: "VEREDICTO_INVALIDO" }, { status: 400 });
    const jobIdVer = cleanText(payload.job_id);
    if (!jobIdVer) return NextResponse.json({ ok: false, error: "JOB_ID_REQUERIDO" }, { status: 400 });
    const { data: jobVer, error: errVer } = await sb
      .from("emision_jobs")
      .select("job_id, estado, origin, propuesta_id, usuario_id, cuenta_id, empresa_id, created_at, expires_at")
      .eq("job_id", jobIdVer)
      .maybeSingle();
    if (errVer) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED" }, { status: 500 });
    if (!jobVer) return NextResponse.json({ ok: false, error: "JOB_NO_ENCONTRADO" }, { status: 404 });
    const accesoVer = await accesoDeclaracion(sb, user.id, jobVer);
    if (accesoVer) return accesoVer;
    const adoptadoId = jobAdoptadoDeOrigen(jobVer.origin);
    const { data: jobViejo, error: errViejo } = adoptadoId
      ? await sb
          .from("emision_jobs")
          .select("job_id, estado, propuesta_id, usuario_id, cuenta_id, empresa_id, created_at, expires_at, heartbeat_at")
          .eq("job_id", adoptadoId)
          .maybeSingle()
      : { data: null, error: null };
    if (errViejo) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED" }, { status: 500 });
    const ahoraVer = new Date();
    const valido = validarVeredictoNoSalio({ verificacion: jobVer, viejo: jobViejo ?? null, userId: user.id, ahora: ahoraVer });
    if (!valido.ok) {
      return NextResponse.json(
        { ok: false, error: valido.code, detalle: valido.detalle, desde: valido.desdeMs != null ? new Date(valido.desdeMs).toISOString() : null },
        { status: 409 },
      );
    }
    const viejo = jobViejo!;
    const { data: boletaVigente, error: errBolVer } = await sb
      .from("boletas_emitidas")
      .select("id, folio")
      .eq("propuesta_id", viejo.propuesta_id as string)
      .neq("estado", "anulada")
      .limit(1)
      .maybeSingle();
    if (errBolVer) return NextResponse.json({ ok: false, error: "BOLETA_QUERY_FAILED" }, { status: 500 });
    if (boletaVigente) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_YA_EMITIDA", detalle: `Esta boleta ya está registrada con el folio ${boletaVigente.folio}.`, folio: boletaVigente.folio }, { status: 409 });
    }
    // Un folio capturado para cualquiera de los dos jobs (stash de la extensión) = salió.
    const { data: conFolioVer, error: errResVer } = await sb
      .from("sii_local_resultados")
      .select("folio")
      .in("job_id", [viejo.job_id, jobVer.job_id])
      .not("folio", "is", null)
      .limit(1);
    if (errResVer) return NextResponse.json({ ok: false, error: "RESULTADOS_QUERY_FAILED" }, { status: 500 });
    if ((conFolioVer ?? []).length > 0) {
      return NextResponse.json({ ok: false, error: "FOLIO_CAPTURADO", detalle: `El SII devolvió el folio ${conFolioVer![0].folio} para este intento: la boleta sí salió.` }, { status: 409 });
    }
    const mensajeVer = "La verificación automática (reportada por la página) no encontró la boleta en el Resumen de ventas del SII";
    const ahoraIsoVer = ahoraVer.toISOString();
    // running → failed está permitido (locks.ts); el UPDATE re-filtra por estado: si
    // entre medio llegó el resultado (→ completed) o se selló, no se pisa.
    const { data: cerradoViejo, error: errUpdVer } = await sb
      .from("emision_jobs")
      .update({ estado: "failed", estado_visible: "failed", status_message: mensajeVer, updated_at: ahoraIsoVer })
      .eq("job_id", viejo.job_id)
      .in("estado", ["created", "running"])
      .select("job_id");
    if (errUpdVer) return NextResponse.json({ ok: false, error: "VEREDICTO_FALLIDO", detalle: errUpdVer.message }, { status: 500 });
    if ((cerradoViejo ?? []).length === 0) {
      return NextResponse.json({ ok: false, error: "NADA_QUE_CERRAR", detalle: "Esa boleta cambió de estado mientras la verificábamos. Recarga Emitir." }, { status: 409 });
    }
    await sb.from("emision_locks").delete().eq("cuenta_id", viejo.cuenta_id).eq("job_id", viejo.job_id);
    await sb.from("emision_jobs").update({ status_message: mensajeVer }).eq("job_id", jobVer.job_id);
    await releaseCuentaEmissionLock({ sb, cuentaId: jobVer.cuenta_id, jobId: jobVer.job_id, estado: "failed" });
    await recordOpsEvent({
      sb,
      severity: "warn",
      source: "sii-local",
      eventName: "sii_local_verificado_no_salio",
      summary: "La verificación automática (reportada por la página) no encontró la boleta en el Resumen de ventas (vuelve a Listas)",
      empresaId: viejo.empresa_id,
      cuentaId: viejo.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: viejo.job_id,
      metadata: { verificacion_job_id: jobVer.job_id, origen: "verificacion_reportes_reportada_por_pagina", evidencia_servidor: false },
    });
    await recordCuentaAudit({
      sb,
      cuentaId: viejo.cuenta_id,
      empresaId: viejo.empresa_id,
      usuarioId: user.id,
      accion: "emision_fallida",
      recursoTipo: "emision_job",
      recursoId: viejo.job_id,
      resumen: "La verificación automática (reportada por la página) no encontró la boleta en el SII (vuelve a Listas)",
      metadata: { origen: "verificacion_reportes_reportada_por_pagina", evidencia_servidor: false, verificacion_job_id: jobVer.job_id },
    });
    return NextResponse.json({ ok: true, jobs_cerrados: 1 });
  }

  let result = payload.result;
  let effectiveJobId = payload.job_id ?? null;
  if (payload.recover_latest) {
    let query = sb
      .from("sii_local_resultados")
      .select("job_id, result, status")
      .eq("user_id", user.id)
      .not("result", "is", null)
      .order("received_at", { ascending: false })
      // Varias filas (no 1): se prefiere la captura con sesión segura sobre una
      // "sesion_insegura" del mismo job (elegirResultadoRecuperable). Sin filtrar por
      // status: el stash de sesión insegura TIENE que poder promoverse tras el MFA.
      .limit(10);
    if (payload.job_id) query = query.eq("job_id", payload.job_id);
    // Sin job_id el rescate es "lo último que emitiste": acotarlo a 24 h. Sin la
    // ventana podía resucitar una boleta VIEJA de otra emisión y reportarla como
    // el rescate de la actual (falso éxito que enmascara el folio perdido).
    else query = query.gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const { data: recoveredRows, error: recoverErr } = await query;
    if (recoverErr) {
      return NextResponse.json(
        { ok: false, error: "RECUPERACION_NO_DISPONIBLE", detalle: recoverErr.message },
        { status: 500 },
      );
    }
    const recovered = elegirResultadoRecuperable(recoveredRows as Array<{ job_id: string | null; result: unknown; status: string | null }> | null);
    if (!recovered?.result || typeof recovered.result !== "object") {
      return NextResponse.json({ ok: false, error: "SIN_RESULTADO_SII_RECUPERABLE" }, { status: 404 });
    }
    result = recovered.result as SiiLocalResultPayload["result"];
    effectiveJobId = recovered.job_id;
  }
  const pdfInfoCrudo = extractSiiPdfInfo(result);
  // 0.2.8 (adversarial #1): un folio leído de la URL de un PDF solo es evidencia si NO
  // viene de /reportes (ahí los links son de otras filas) y coincide con el folio
  // capturado. Cubre también las 0.2.7 en flota, que mandan links de /reportes.
  const folioCapturado = positiveInt(result?.folio);
  const pdfDesdeReportes = String(result?.page?.url || "").includes("/reportes");
  const pdfInfo = pdfInfoCrudo && !pdfDesdeReportes && (!folioCapturado || pdfInfoCrudo.folio === folioCapturado) ? pdfInfoCrudo : null;
  const folio = positiveInt(result?.folio) ?? pdfInfo?.folio ?? null;
  const tipoDte =
    result?.tipo_dte === 39 || result?.tipo_dte === 41 || result?.tipo_dte === 33 || result?.tipo_dte === 34
      ? result.tipo_dte
      : null;
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
  if (!jobGate.ok) {
    // 🛟 RED DE SEGURIDAD ("nunca se pierde un folio"): el gate falló porque el job
    // está cerrado/expirado, pero el payload puede traer una boleta REAL con
    // evidencia fuerte (folio confiable). Antes esto era un callejón sin salida y el
    // folio quedaba invisible → el usuario re-emitía → boleta DUPLICADA (sin NC para
    // revertir). Ahora la respaldamos igual (idempotente). Esto también hace que los
    // botones "Recuperar folio/PDF" funcionen aunque el job ya esté cerrado.
    const jobCerrado = jobGate.job;
    const vetoCalceCerrado = Boolean(jobCerrado && esCalceReportes(result) && tipoDte && montoTotal && fechaEmision)
      && await calceReportesVetado(sb, { empresaId: jobCerrado!.empresa_id, tipoDte: tipoDte!, montoTotal: montoTotal!, fechaEmision: fechaEmision!, jobId: effectiveJobId, propuestaId: jobCerrado!.propuesta_id ?? null });
    const evidenciaFuerte = (result?.folio_confidence === "high" && !vetoCalceCerrado) || Boolean(pdfInfo?.folio);
    // La red aplica a TODA falla del gate que venga con `job` adjunto (cerrado,
    // expirado, empresa desactivada por downgrade, plan vencido): la ownership
    // ya fue verificada en requireEmisionJob y la boleta en el SII es un hecho.
    if (
      jobCerrado &&
      folio && tipoDte && montoTotal && fechaEmision && evidenciaFuerte
    ) {
      const respaldo = await backfillFolioSinJobVivo(sb, {
        empresaId: jobCerrado.empresa_id,
        tipoDte,
        folio,
        montoTotal,
        fechaEmision,
        totales: result?.totales ?? null,
        jobId: effectiveJobId,
        propuestaId: jobCerrado.propuesta_id ?? null,
        result,
        pdfInfo,
      });
      if (respaldo.ok) {
        await levantarAdoptado(sb, jobCerrado);
        // Llegó un folio REAL para un intento que alguien declaró «no salió»
        // (rev. adversarial M3): puede haber dos boletas por la misma venta y la
        // boleta única no tiene índice por propuesta que lo detecte. Alerta crítica.
        if (fueDeclaradoNoSalio(jobCerrado)) {
          await recordOpsEvent({
            sb, severity: "critical", source: "sii-local", eventName: "folio_tras_no_salio_declarado",
            summary: `Llegó el folio ${folio} de un intento declarado «no salió»: revisar posible doble boleta`,
            empresaId: jobCerrado.empresa_id, cuentaId: jobCerrado.cuenta_id, usuarioId: user.id,
            resourceType: "emision_job", resourceId: effectiveJobId,
            metadata: { folio, tipo_dte: tipoDte, propuesta_id: jobCerrado.propuesta_id ?? null },
          });
        }
        await rememberResult(sb, {
          user_id: user.id,
          job_id: effectiveJobId,
          folio,
          status: respaldo.already ? "already_exists" : "backfill_job_cerrado",
          result: result ?? null,
        });
        await recordOpsEvent({
          sb,
          severity: "warn",
          source: "sii-local",
          eventName: "sii_local_backfill_job_cerrado",
          summary: "Folio respaldado pese a job cerrado (red anti-pérdida)",
          usuarioId: user.id,
          resourceType: "emision_job",
          resourceId: effectiveJobId,
          metadata: { folio, tipo_dte: tipoDte, already_exists: Boolean(respaldo.already) },
        });
        return NextResponse.json({ ok: true, boleta_id: respaldo.boletaId ?? null, folio, already_exists: Boolean(respaldo.already), recuperado: true });
      }
      if (respaldo.error === "FOLIO_DE_OTRO_DOCUMENTO") {
        // Cruce detectado en la red de seguridad: NO se guarda como resultado
        // reutilizable (recover_latest lo volvería a intentar) y la extensión debe
        // dejar de reintentarlo (error permanente en su stash).
        await recordOpsEvent({
          sb, severity: "warn", source: "sii-local", eventName: "sii_local_folio_de_otro_documento",
          summary: "Folio capturado pertenece a otra propuesta (job cerrado): no se registra ni se levanta la lápida",
          usuarioId: user.id, resourceType: "emision_job", resourceId: effectiveJobId,
          metadata: { folio, tipo_dte: tipoDte, propuesta_id: jobCerrado?.propuesta_id ?? null, origen: (result?.folio_evidence as { source?: string } | null)?.source ?? null },
        });
        return NextResponse.json({ ok: false, error: "FOLIO_DE_OTRO_DOCUMENTO", detalle: "Ese folio ya pertenece a otra boleta. La de este intento sigue a medias: confirma su folio en Emitir → A medias." }, { status: 409 });
      }
      // Si el backfill falló (p.ej. empresa sin datos fiscales), caemos al stash de
      // abajo para no perder el rastro del folio.
    }
    // El gate falló y no se pudo respaldar arriba: el payload puede traer una boleta
    // REAL ya emitida. Si la descartamos, queda invisible y el usuario re-emite →
    // boleta DUPLICADA. La guardamos con status 'job_gate_failed' para reintentar.
    // EXCEPTO cuando el job es de OTRO usuario (FORBIDDEN): guardar el payload ajeno
    // bajo la sesión actual contaminaría su historial con datos de un tercero — el
    // dueño real lo reintenta desde su propia sesión (stash de la extensión).
    if (!payload.recover_latest && (folio || result) && jobGate.error !== "EMISION_JOB_FORBIDDEN") {
      await rememberResult(sb, {
        user_id: user.id,
        job_id: effectiveJobId,
        folio,
        status: "job_gate_failed",
        error: jobGate.error,
        result: result ?? null,
      });
    }
    await recordOpsEvent({
      sb,
      severity: jobGate.status >= 500 ? "error" : "warn",
      source: "sii-local",
      eventName: "sii_local_job_gate_failed",
      summary: "Resultado SII local rechazado por gate de job",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: effectiveJobId,
      metadata: { error: jobGate.error, detalle: jobGate.detalle, folio_recibido: folio },
    });
    return NextResponse.json({ ok: false, error: jobGate.error, detalle: jobGate.detalle }, { status: jobGate.status });
  }
  const job = jobGate.job;
  const empresaId = job.empresa_id;

  // Evidencia fuerte = el SII entregó folio con confianza alta (o folio en la
  // URL del PDF). Es el ÚNICO requisito para registrar la boleta: el folio es
  // la prueba de emisión. El PDF se adjunta aparte (puede quedar pendiente).
  const vetoCalce = Boolean(esCalceReportes(result) && tipoDte && montoTotal && fechaEmision)
    && await calceReportesVetado(sb, { empresaId, tipoDte: tipoDte!, montoTotal: montoTotal!, fechaEmision: fechaEmision!, jobId: job.job_id, propuestaId: job.propuesta_id ?? null });
  const hasStrongEvidence = (result?.folio_confidence === "high" && !vetoCalce) || Boolean(pdfInfo?.folio);
  if (vetoCalce) {
    await recordOpsEvent({
      sb, severity: "warn", source: "sii-local", eventName: "sii_local_calce_reportes_vetado",
      summary: "Calce único en /reportes vetado: hoy hay otra boleta a medias del mismo monto",
      usuarioId: user.id, empresaId, resourceType: "emision_job", resourceId: effectiveJobId,
      metadata: { folio, tipo_dte: tipoDte, monto_total: montoTotal },
    });
  }
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
    await recordSiiLocalFailure(sb, job, "RESULTADO_SII_INSUFICIENTE", "Resultado SII local insuficiente", {
      has_folio: Boolean(folio),
      has_tipo_dte: Boolean(tipoDte),
      has_monto_total: Boolean(montoTotal),
      has_fecha_emision: Boolean(fechaEmision),
      has_strong_evidence: hasStrongEvidence,
    });
    // Si HAY folio pero la evidencia es débil, el SII PUDO emitir (post-emit
    // incierto) → sella 'revision_pendiente' (lápida), NO 'failed'. Así el candado
    // de cuenta se MANTIENE para la boleta única (locks.ts mantiene el lock en
    // revision_pendiente sin propuesta_id) y bloquea la re-emisión → evita el doble
    // folio. Sin folio = pre-emit seguro → 'failed' (la propuesta se puede re-emitir).
    const selloInsuf = folio ? "revision_pendiente" : "failed";
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: selloInsuf });
    return NextResponse.json({ ok: false, error: "RESULTADO_SII_INSUFICIENTE" }, { status: 422 });
  }

  const { data: empresa } = await sb
    .from("empresas")
    .select("rut, razon_social, giro, direccion, comuna")
    .eq("id", empresaId)
    .single();
  if (!empresa?.rut || !empresa?.razon_social) {
    // Folio REAL ya emitido (pasó el check de evidencia fuerte) que no se puede
    // persistir por falta de datos de la empresa → sella 'revision_pendiente' (que
    // RETIENE el candado de la boleta única, ver locks.ts) en vez de 'failed', que
    // lo soltaría y abriría la re-emisión tras un reload → doble folio.
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: folio ? "revision_pendiente" : "failed" });
    await recordSiiLocalFailure(sb, job, "EMPRESA_SIN_DATOS_FISCALES", "Empresa sin datos fiscales para persistir SII local");
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });
  }

  const { data: existing } = await sb
    .from("boletas_emitidas")
    .select("id, folio, estado, proveedor_respuesta, propuesta_id")
    .eq("empresa_id", empresaId)
    .eq("tipo_dte", tipoDte)
    .eq("folio", folio)
    .maybeSingle();

  // Emisor cruzado se evalúa ANTES de la rama `existing` (adversarial 0.2.8, F8): un
  // folio capturado bajo OTRO RUT que coincide numéricamente con uno de esta empresa
  // no puede darse por "ya registrado".
  const emisorActivo = cleanText(result?.emisor_rut_activo);
  const emisorMismatch = Boolean(emisorActivo && empresa.rut && cleanRut(emisorActivo) !== cleanRut(empresa.rut));
  if (emisorMismatch) {
    await recordOpsEvent({
      sb,
      severity: "error",
      source: "sii-local",
      eventName: "sii_local_emisor_mismatch",
      summary: "Boleta emitida en el SII bajo un emisor distinto al registrado en la app",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: effectiveJobId,
      metadata: { folio, tipo_dte: tipoDte, emisor_activo: emisorActivo, emisor_registrado: empresa.rut },
    });
  }

  if (existing) {
    // FOLIO DE OTRO DOCUMENTO (adversarial 0.2.8, F1): el folio ya es de OTRA
    // propuesta → este intento capturó la boleta equivocada (p. ej. la fila de otra
    // boleta en /reportes). Antes: "already_exists" + job 'completed' → la propuesta
    // de este job quedaba sin boleta y RE-EMITIBLE → doble folio. Ahora: lápida
    // (bloquea re-emitir) + 409; el humano confirma el folio real en "A medias".
    // Ambos propuesta_id no nulos: boleta única, reconciliación y el folio B de un
    // doble folio (propuesta_id NULL) siguen pasando por la rama normal.
    const folioAjeno = Boolean(existing.propuesta_id && job.propuesta_id && existing.propuesta_id !== job.propuesta_id);
    // Re-entrega del PROPIO folio (misma propuesta): nunca se sella lápida por el
    // emisor (adversarial #7) — la boleta ya es de esta propuesta.
    const mismaBoleta = Boolean(existing.propuesta_id && existing.propuesta_id === job.propuesta_id);
    if (folioAjeno || (emisorMismatch && !mismaBoleta)) {
      await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "rejected", error: folioAjeno ? "FOLIO_DE_OTRO_DOCUMENTO" : "EMISOR_CRUZADO", result });
      await recordOpsEvent({
        sb, severity: "warn", source: "sii-local", eventName: folioAjeno ? "sii_local_folio_de_otro_documento" : "sii_local_emisor_cruzado_existing",
        summary: folioAjeno ? "Folio capturado pertenece a otra propuesta: no se cierra el job" : "Folio ya registrado, pero el portal tenía otro emisor activo: no se cierra el job",
        usuarioId: user.id, empresaId, resourceType: "emision_job", resourceId: effectiveJobId,
        metadata: { folio, tipo_dte: tipoDte, propuesta_job: job.propuesta_id ?? null, propuesta_boleta: existing.propuesta_id ?? null, emisor_activo: emisorActivo ?? null, origen: (result?.folio_evidence as { source?: string } | null)?.source ?? null },
      });
      await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "revision_pendiente" });
      return NextResponse.json({
        ok: false,
        error: folioAjeno ? "FOLIO_DE_OTRO_DOCUMENTO" : "EMISOR_CRUZADO",
        detalle: folioAjeno
          ? "Ese folio ya pertenece a otra boleta. Esta quedó a medias: confirma su folio en Emitir → A medias."
          : "El portal tenía otra empresa seleccionada. Esta boleta quedó a medias: revisa en el SII bajo qué RUT salió.",
      }, { status: 409 });
    }
    const pdfUpload = await uploadResultPdf(sb, { empresaId, tipoDte, folio, result, pdfInfo });
    if (pdfUpload.storagePath) {
      const previousResponse = existing.proveedor_respuesta && typeof existing.proveedor_respuesta === "object"
        ? existing.proveedor_respuesta as Record<string, unknown>
        : {};
      const { error: updateErr } = await sb
        .from("boletas_emitidas")
        .update({
          proveedor_respuesta: safeJson({
            ...previousResponse,
            pdf: {
              storage_path: pdfUpload.storagePath,
              filename: pdfUpload.filename ?? `${esFactura(tipoDte) ? "factura" : "boleta"}-sii-${tipoDte}-${folio}.pdf`,
              content_type: "application/pdf",
              source_url: pdfUpload.sourceUrl,
              provider: pdfUpload.provider,
            },
            pdf_upload_error: null,
          }),
        })
        .eq("id", existing.id);
      if (updateErr) {
        await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "pdf_metadata_update_failed", error: updateErr.message, result });
        // Rama `existing`: la boleta con este folio YA está registrada; solo falló el
        // update de metadata del PDF. Igual que las otras ramas post-folio, con folio
        // presente se sella 'revision_pendiente' (retiene el candado de la boleta
        // única) y NO 'failed' (que lo soltaría → doble folio tras un reload).
        await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: folio ? "revision_pendiente" : "failed" });
        await recordSiiLocalFailure(sb, job, "PDF_METADATA_UPDATE_FAILED", "No se pudo actualizar metadata PDF de boleta SII local existente", {
          boleta_id: existing.id,
          detalle: updateErr.message,
        });
        return NextResponse.json({ ok: false, error: "PDF_METADATA_UPDATE_FAILED", detalle: updateErr.message, already_exists: true, boleta_id: existing.id }, { status: 500 });
      }
    } else {
      // El PDF no se pudo subir ahora: la boleta YA existe y queda registrada;
      // el PDF se reintenta/adjunta luego. Nunca se pierde la boleta por esto.
      await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "pdf_pendiente", error: pdfUpload.error, result });
      await recordSiiLocalFailure(sb, job, "PDF_PENDIENTE", "Boleta SII local existente quedo sin PDF adjunto", {
        boleta_id: existing.id,
        tipo_dte: tipoDte,
        folio,
        pdf_error: pdfUpload.error,
      }, "warn");
    }
    await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "already_exists", result });
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });
    await levantarAdoptado(sb, job);
    return NextResponse.json({ ok: true, boleta_id: existing.id, folio, estado: existing.estado, already_exists: true });
  }

  // (Emisor cruzado: evaluado arriba, antes de la rama `existing`.) Se registra igual
  // con marca visible + alerta ops — antes los libros divergían en silencio.

  const totals = totalsFor(tipoDte, montoTotal, result?.totales ?? null);
  // Verificación de un intento ADOPTADO: el job de verificación no lleva glosa ni
  // receptor (solo lee /reportes); lo que se emitió de verdad sale de la PROPUESTA.
  const desdePropuesta = jobAdoptadoDeOrigen(job.origin) && job.propuesta_id
    ? await datosEmitidosDePropuesta(sb, job.propuesta_id, tipoDte)
    : null;
  const receptor = desdePropuesta?.receptor ?? result?.receptor ?? null;
  const detalles = desdePropuesta
    ? [{ nro_lin: 1, nombre: desdePropuesta.glosa, qty: 1, monto: montoTotal }]
    : Array.isArray(result?.detalles) && result.detalles.length > 0
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
      filename: pdfUpload.filename ?? `${esFactura(tipoDte) ? "factura" : "boleta"}-sii-${tipoDte}-${folio}.pdf`,
      content_type: "application/pdf",
      source_url: pdfUpload.sourceUrl,
      provider: pdfUpload.provider,
    } : null,
    pdf_pendiente: pdfPendiente,
    pdf_upload_error: pdfUpload.storagePath ? null : (pdfUpload.error || "PDF_PENDIENTE"),
    emisor_activo_portal: emisorActivo ?? null,
    emisor_mismatch: emisorMismatch,
    artifact_links: (result?.artifact_links ?? []).map((link) => ({
      kind: link.kind,
      text: link.text,
      href: sanitizeUrlForMetadata(cleanText(link.href)),
    })),
    page: result?.page ? { url: result.page.url, title: result.page.title } : null,
  };

  const boletaInsert = {
    empresa_id: empresaId,
    // Motor masivo: enlaza el folio real a la propuesta que lo originó. Boleta
    // única → null. El índice UNIQUE parcial de propuesta_id bloquea el doble.
    propuesta_id: job.propuesta_id ?? null,
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
    receptor_giro: cleanText(receptor?.giro),
    receptor_direccion: cleanText(receptor?.direccion),
    receptor_comuna: cleanText(receptor?.comuna),
    // Facturas: la forma de pago que quedó en el documento (Contado/Crédito).
    medio_pago: cleanText(result?.forma_pago),
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
    proveedor_respuesta: safeJson(proveedorRespuesta),
  };
  const { data: boleta, error: insertErr } = await sb
    .from("boletas_emitidas")
    .insert(boletaInsert)
    .select("id, folio, monto_total, estado, track_id, fecha_emision")
    .single();

  if (insertErr || !boleta) {
    // Carrera de doble POST (entrega directa + reentrega del stash en paralelo):
    // el perdedor choca con el UNIQUE(empresa,tipo,folio). La boleta SÍ está
    // guardada — responder already_exists como hace el backfill, no un 500 que
    // la app mostraba como "Boleta no quedó guardada" sobre una boleta guardada.
    const { data: raceWinner } = await sb
      .from("boletas_emitidas")
      .select("id, estado")
      .eq("empresa_id", empresaId)
      .eq("tipo_dte", tipoDte)
      .eq("folio", folio)
      .maybeSingle();
    if (raceWinner) {
      await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "already_exists", result });
      await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });
      return NextResponse.json({ ok: true, boleta_id: raceWinner.id, folio, estado: raceWinner.estado, already_exists: true });
    }
    // Segunda causa del insertErr (no la carrera de folio): idx_boletas_propuesta_
    // unica_vigente — la MISMA propuesta ya tiene una boleta viva con OTRO folio
    // (doble emisión en el portal: se recuperó el folio A y ahora llega el folio B).
    // La búsqueda por folio de arriba no lo encuentra. El folio B es REAL: no puede
    // quedar invisible (subdeclaración + riesgo de re-emisión). Lo registramos
    // DESACOPLADO de la propuesta (propuesta_id null — el slot ya lo tiene el folio
    // A) para que sea visible, y alertamos a ops en CRÍTICO: un doble folio en el
    // portal necesita ojo humano.
    if (job.propuesta_id) {
      const { data: propViva } = await sb
        .from("boletas_emitidas")
        .select("id, folio")
        .eq("empresa_id", empresaId)
        .eq("propuesta_id", job.propuesta_id)
        .neq("estado", "anulada")
        .maybeSingle();
      if (propViva && String(propViva.folio) !== String(folio)) {
        const { data: boletaB } = await sb
          .from("boletas_emitidas")
          // Con la MISMA ref de la propuesta: dos boletas con la misma ref = doble folio visible.
          .insert({ ...boletaInsert, propuesta_id: null, ...(await conRef(sb, empresaId, job.propuesta_id)) })
          .select("id, folio, estado")
          .single();
        await recordOpsEvent({
          sb,
          severity: "critical",
          source: "sii-local",
          eventName: "doble_folio_propuesta",
          summary: `Doble folio para una propuesta (el portal emitió dos veces): folios ${propViva.folio} y ${folio}`,
          usuarioId: job.usuario_id,
          resourceType: "emision_job",
          resourceId: job.job_id,
          metadata: { tipo_dte: tipoDte, folio_a: propViva.folio, folio_b: folio, propuesta_id: job.propuesta_id, boleta_b_id: boletaB?.id ?? null },
        });
        if (boletaB) {
          await rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: "doble_folio_registrado", result });
          await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });
          return NextResponse.json({ ok: true, boleta_id: boletaB.id, folio, estado: boletaB.estado, doble_folio: true });
        }
      }
    }
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
    await recordSiiLocalFailure(sb, job, "DB_INSERT_FAILED", "No se pudo guardar la boleta emitida con SII local", {
      tipo_dte: tipoDte,
      folio,
      detalle: insertErr?.message,
    });
    // Folio REAL emitido pero el insert de la boleta falló → 'revision_pendiente'
    // (retiene el candado de la boleta única) en vez de 'failed'. Sin esto el candado
    // se soltaba y un reload permitía re-emitir → doble folio.
    await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: folio ? "revision_pendiente" : "failed" });
    return NextResponse.json({ ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message }, { status: 500 });
  }

  const receptorLabel = cleanText(receptor?.razon_social) ?? "consumidor final";
  const docWord = esFactura(tipoDte) ? "Factura" : "Boleta";
  const progresoEmitido = {
    origen: "sii_local_extension",
    proveedor: "sii_local",
    boleta_id: boleta.id,
    folio: boleta.folio,
    tipo_dte: tipoDte,
    monto_total: boleta.monto_total,
    receptor: receptorLabel,
  };

  // EMISIÓN DIRECTA (2026-08-27): la solicitud ("Factura única - X", tipo
  // boleta_unica) ya tiene su fila en la mesa — al emitir se ACTUALIZA esa
  // misma fila con el folio, en vez de crear una segunda. Antes quedaban dos:
  // la solicitud eternamente "sin emitir" (mentira ámbar) + el resultado.
  // Guardia dura: SOLO docs tipo boleta_unica (jamás renombrar una cartola).
  let solicitudActualizada = false;
  if (job.propuesta_id) {
    const reqDoc = await documentoDeLaPropuesta(sb, job.propuesta_id);
    if (reqDoc?.tipo === "boleta_unica") {
      const progresoPrevio = (reqDoc.progreso_ia && typeof reqDoc.progreso_ia === "object") ? reqDoc.progreso_ia as Record<string, unknown> : {};
      const origenPrevio = typeof progresoPrevio.origen === "string" ? progresoPrevio.origen : progresoEmitido.origen;
      const { error: updErr } = await sb.from("documentos_subidos").update({
        nombre_archivo: `${docWord} SII #${boleta.folio} - ${receptorLabel}`,
        progreso_ia: { ...progresoPrevio, ...progresoEmitido, origen: origenPrevio },
      }).eq("id", reqDoc.id);
      solicitudActualizada = !updErr;
    }
  }
  if (!solicitudActualizada) {
    await sb.from("documentos_subidos").insert({
      empresa_id: empresaId,
      nombre_archivo: `${docWord} SII #${boleta.folio} - ${receptorLabel}`,
      tipo: "boleta_sii_local",
      // CARRILES SEPARADOS (cazado en vivo 2026-08-27): sin mesa explícita el
      // doc caía al default 'boleta' y las FACTURAS aparecían en la mesa de
      // boletas. Cada mesa ve solo lo suyo.
      mesa: esFactura(tipoDte) ? "factura" : "boleta",
      storage_path: pdfUpload.storagePath ?? `sii-local-pdf-pendiente/${empresaId}/${tipoDte}-${folio}`,
      estado: "procesado",
      movimientos_detectados: 1,
      created_at: new Date().toISOString(),
      progreso_ia: progresoEmitido,
    });
  }

  // Glosa/receptor pedidos y NO escritos por el RPA (tanda 1, 2026-09-10): la
  // boleta ya es REAL (folio guardado arriba), así que esto jamás bloquea; solo
  // deja rastro visible en ops_events (antes se perdía en sii_local_resultados).
  if (result?.glosa_omitida === true) {
    // "Documento", no "Boleta": este camino lo recorren también las facturas 33/34.
    await recordSiiLocalFailure(sb, job, "GLOSA_OMITIDA", "Documento emitido sin la glosa pedida", { folio, tipo_dte: tipoDte }, "warn");
  }
  if (result?.receptor_omitido === true) {
    await recordSiiLocalFailure(sb, job, "RECEPTOR_OMITIDO", "Documento emitido sin el receptor pedido", { folio, tipo_dte: tipoDte }, "warn");
  }
  // Rama FELIZ: la boleta ya está guardada; este registro solo alimenta el historial,
  // así que va después de responder (plan-costo-vercel §6 PR 3). Las ramas de FALLA
  // siguen síncronas: son el STASH que usa recover_latest para rescatar el folio.
  // Sin job_id queda SÍNCRONO: recover_latest sin job toma la fila más reciente del
  // usuario, y una "persisted" que llegara tarde podía tapar el stash de falla de la
  // boleta siguiente (falso rescate).
  const registroFeliz = () => rememberResult(sb, { user_id: user.id, job_id: effectiveJobId, folio, status: pdfPendiente ? "persisted_pdf_pendiente" : "persisted", result });
  if (effectiveJobId) after(registroFeliz);
  else await registroFeliz();
  if (pdfPendiente) {
    await recordSiiLocalFailure(sb, job, "PDF_PENDIENTE", "Boleta SII local persistida sin PDF adjunto", {
      tipo_dte: tipoDte,
      folio,
      pdf_error: pdfUpload.error,
    }, "warn");
  }
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
  await levantarAdoptado(sb, job);

  return NextResponse.json({ ok: true, boleta_id: boleta.id, folio: boleta.folio, estado: boleta.estado, track_id: boleta.track_id, pdf_pendiente: pdfPendiente });
}

export async function GET() {
  // Lectura del historial: se bloquea con sesión insegura (nada que perder).
  const guard = await requireSesionSegura();
  if (!guard.ok) return guard.response;
  const user = guard.user;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient<Database>(url, key);

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
