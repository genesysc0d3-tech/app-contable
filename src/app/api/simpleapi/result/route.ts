import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface SimpleApiResultPayload {
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

function safeJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function totalsFor(tipoDte: number, total: number) {
  if (tipoDte === 34) return { monto_neto: 0, iva: 0, monto_exento: total };
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
  const tipoDte = result?.dte?.tipoDte === 33 || result?.dte?.tipoDte === 34 ? result.dte.tipoDte : null;
  const folio = positiveInt(result?.dte?.folio);
  const montoTotal = positiveInt(result?.dte?.total ?? payload.draft?.monto_total);
  const fechaEmision = chileDate(result?.dte?.fecha);
  const trackId = cleanText(result?.trackId);
  const xmlDte = cleanText(result?.dteXml);
  const pdfBase64 = cleanText(result?.pdf?.base64);

  if (!tipoDte || !folio || !montoTotal || !fechaEmision || !trackId || !xmlDte || !pdfBase64) {
    return NextResponse.json({ ok: false, error: "RESULTADO_SIMPLEAPI_INSUFICIENTE" }, { status: 422 });
  }
  if (result?.pdf?.content_type !== "application/pdf") {
    return NextResponse.json({ ok: false, error: "PDF_CONTENT_TYPE_INVALID" }, { status: 422 });
  }
  if (!validDteXml({ xml: xmlDte, tipoDte, folio, total: montoTotal })) {
    return NextResponse.json({ ok: false, error: "XML_DTE_INVALID" }, { status: 422 });
  }
  if (!isAcceptedEnvio(result?.envio) || !isAcceptedDte(result?.consultaDte)) {
    return NextResponse.json({ ok: false, error: "SII_ACCEPTANCE_REQUIRED" }, { status: 422 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas(rut, razon_social, giro, direccion, comuna)")
    .eq("id", user.id)
    .single();

  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  const empresa = usuario.empresas as unknown as { rut: string; razon_social: string; giro: string | null; direccion: string | null; comuna: string | null } | null;
  if (!empresa?.rut || !empresa?.razon_social) return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient(url, key);

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  const invalidPdf = validatePdfBuffer(pdfBuffer);
  if (invalidPdf) return NextResponse.json({ ok: false, error: invalidPdf }, { status: 422 });

  const storagePath = storagePathFor({ empresaId: usuario.empresa_id, tipoDte, folio });
  const { error: uploadErr } = await sb.storage.from("documentos").upload(storagePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadErr) return NextResponse.json({ ok: false, error: "PDF_UPLOAD_FAILED", detalle: uploadErr.message }, { status: 502 });

  const { data: existing } = await sb
    .from("boletas_emitidas")
    .select("id, folio, estado, track_id, proveedor_respuesta")
    .eq("empresa_id", usuario.empresa_id)
    .eq("tipo_dte", tipoDte)
    .eq("folio", folio)
    .maybeSingle();

  const proveedorRespuesta = {
    origen: "simpleapi_extension",
    track_id: trackId,
    envio: safeJson(result?.envio),
    consulta_dte: safeJson(result?.consultaDte),
    envio_xml: cleanText(result?.envioXml),
    pdf: {
      storage_path: storagePath,
      filename: cleanText(result?.pdf?.filename) ?? `simpleapi-${tipoDte}-${folio}.pdf`,
      content_type: "application/pdf",
    },
  };

  if (existing) {
    const previous = existing.proveedor_respuesta && typeof existing.proveedor_respuesta === "object" ? existing.proveedor_respuesta as Record<string, unknown> : {};
    const { error: updateErr } = await sb
      .from("boletas_emitidas")
      .update({ proveedor_respuesta: { ...previous, ...proveedorRespuesta } })
      .eq("id", existing.id);
    if (updateErr) return NextResponse.json({ ok: false, error: "DB_UPDATE_FAILED", detalle: updateErr.message, already_exists: true, boleta_id: existing.id }, { status: 500 });
    return NextResponse.json({ ok: true, boleta_id: existing.id, folio, estado: existing.estado, track_id: existing.track_id, already_exists: true });
  }

  const totals = totalsFor(tipoDte, montoTotal);
  const detalleNombre = cleanText(payload.draft?.detalle_nombre) ?? "Servicio prestado";
  const { data: boleta, error: insertErr } = await sb
    .from("boletas_emitidas")
    .insert({
      empresa_id: usuario.empresa_id,
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
    await sb.storage.from("documentos").remove([storagePath]);
    return NextResponse.json({ ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message }, { status: 500 });
  }

  const receptorLabel = cleanText(payload.draft?.receptor_razon_social) ?? "cliente sin identificar";
  await sb.from("documentos_subidos").insert({
    empresa_id: usuario.empresa_id,
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

  return NextResponse.json({ ok: true, boleta_id: boleta.id, folio: boleta.folio, estado: boleta.estado, track_id: boleta.track_id });
}

export const dynamic = "force-dynamic";
