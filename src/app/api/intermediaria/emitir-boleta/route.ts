import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { validarBoleta, type BoletaInput } from "@/lib/sii/validation";
import { generarDTE, generarTED } from "@/lib/sii/dte-xml";
import { enviarDTE, asegurarFoliosDisponibles, obtenerConfigEmision } from "@/lib/intermediario/client";
import { chileDateString } from "@/lib/chile-date";

/**
 * Capa intermediaria (emula Haulmer / OpenFactura).
 * Recibe datos simples del usuario, valida, consume folio del CAF,
 * genera el XML DTE, lo "envía" al SII mock, y persiste la boleta.
 *
 * Si en el futuro se cambia a integración real, solo se reemplaza la
 * llamada interna a /api/sii-mock/dte/recibir por la URL real del SII
 * — la app no se entera.
 */

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas(rut, razon_social, giro, direccion, comuna)")
    .eq("id", user.id)
    .single();
  if (!usuario || !usuario.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  const empresa = usuario.empresas as unknown as {
    rut: string; razon_social: string; giro: string | null; direccion: string | null; comuna: string | null;
  } | null;
  if (!empresa?.rut || !empresa?.razon_social) {
    return NextResponse.json(
      { ok: false, error: "EMPRESA_SIN_DATOS_FISCALES", detalle: "Empresa debe tener RUT y razón social configurados" },
      { status: 422 },
    );
  }

  // DEMO: omitimos verificación de certificado SII.
  // En producción: const certCheck = await verificarCertificado(usuario.empresa_id);

  // 2. Parse body
  let body: BoletaInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // 3. Validar usando reglas del SII
  const validation = validarBoleta(body);
  if (!validation.ok || !validation.totales) {
    return NextResponse.json(
      { ok: false, error: "VALIDACION_FALLIDA", errores: validation.errors },
      { status: 422 },
    );
  }

  // 4. Service client para folio + insert (bypassea RLS controlado por la lógica del endpoint)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const sb = createServiceClient(url, key);
  const emisionConfig = await obtenerConfigEmision(usuario.empresa_id).catch(() => null);
  if (!emisionConfig) {
    return NextResponse.json(
      { ok: false, error: "EMISION_CONFIG_ERROR", detalle: "No se pudo leer el proveedor de emisión de la empresa" },
      { status: 500 },
    );
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[emitir-boleta] proveedor efectivo", {
      empresaId: usuario.empresa_id,
      proveedor: emisionConfig.proveedor,
    });
  }

  if (emisionConfig.proveedor === "sii_local") {
    return NextResponse.json(
      { ok: false, error: "SII_LOCAL_REQUIERE_EXTENSION", detalle: "La emisión SII local debe continuar en la ventana segura de e-Boleta." },
      { status: 409 },
    );
  }

  if (emisionConfig.proveedor === "libredte") {
    return NextResponse.json(
      { ok: false, error: "LIBREDTE_PENDIENTE", detalle: "LibreDTE está seleccionado, pero su integración backend aún no está conectada." },
      { status: 422 },
    );
  }

  // 5. Mock consume CAF local.
  const fecha_emision = chileDateString();
  let trackId: string | null = null;
  let estadoSii: "aceptado" | "aceptado_reparos" | "rechazado" | null = null;
  const fechaEmisionReal = fecha_emision;
  const proveedorRespuesta: Record<string, unknown> | null = null;

  await asegurarFoliosDisponibles(usuario.empresa_id, body.tipo_dte);
  const { data: folioRes, error: folioErr } = await sb.rpc("consume_next_folio", {
    p_empresa_id: usuario.empresa_id,
    p_tipo_dte: body.tipo_dte,
  });
  if (folioErr || !folioRes || folioRes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SIN_FOLIOS_DISPONIBLES", detalle: "El intermediario no pudo obtener folios del SII" },
      { status: 502 },
    );
  }
  const folioData = folioRes[0] as { folio: number; caf_id: string };
  const folio = folioData.folio;
  const caf_id = folioData.caf_id;

  // 6. Generar XML DTE + TED local para respaldo/compatibilidad interna.
  const dteArgs = {
    tipo_dte: body.tipo_dte,
    folio,
    fecha_emision: fechaEmisionReal,
    emisor: {
      rut: empresa.rut,
      razon_social: empresa.razon_social,
      giro: empresa.giro,
      direccion: empresa.direccion,
      comuna: empresa.comuna,
    },
    receptor: body.receptor_rut
      ? {
          rut: body.receptor_rut,
          razon_social: body.receptor_razon_social,
          direccion: body.receptor_direccion,
          comuna: body.receptor_comuna,
        }
      : undefined,
    totales: validation.totales,
    detalles: body.detalles,
  };
  const xml_dte = generarDTE(dteArgs);
  const ted = generarTED(dteArgs);

  if (emisionConfig.proveedor === "mock") {
    const envio = await enviarDTE(xml_dte);
    if (!envio.ok || !envio.track_id || !envio.estado_persistencia) {
      return NextResponse.json(
        {
          ok: false,
          error: "SII_RECHAZO",
          codigo_rechazo: envio.codigo_rechazo,
          detalle: envio.detalle ?? envio.mensaje,
        },
        { status: 422 },
      );
    }
    trackId = envio.track_id;
    estadoSii = envio.estado_persistencia;
  }

  if (!trackId || !estadoSii) {
    return NextResponse.json(
      { ok: false, error: "EMISION_SIN_CONFIRMACION", detalle: "El proveedor no devolvió track_id o estado" },
      { status: 502 },
    );
  }

  // 8. Persistir boleta
  const { data: boleta, error: insertErr } = await sb
    .from("boletas_emitidas")
    .insert({
      empresa_id: usuario.empresa_id,
      tipo_dte: body.tipo_dte,
      folio,
      caf_id,
      fecha_emision: fechaEmisionReal,
      emisor_rut: empresa.rut,
      emisor_razon_social: empresa.razon_social,
      emisor_giro: empresa.giro,
      emisor_direccion: empresa.direccion,
      emisor_comuna: empresa.comuna,
      receptor_rut: body.receptor_rut ?? null,
      receptor_razon_social: body.receptor_razon_social ?? null,
      receptor_direccion: body.receptor_direccion ?? null,
      receptor_comuna: body.receptor_comuna ?? null,
      monto_neto: validation.totales.neto,
      monto_exento: validation.totales.exento,
      iva: validation.totales.iva,
      monto_total: validation.totales.total,
      detalles: body.detalles,
      xml_dte,
      ted,
      track_id: trackId,
      estado: estadoSii,
      emision_proveedor: emisionConfig.proveedor,
      emision_sandbox: false,
      proveedor_respuesta: proveedorRespuesta,
    })
    .select("id, folio, monto_total, estado, track_id, fecha_emision")
    .single();

  if (insertErr || !boleta) {
    return NextResponse.json(
      { ok: false, error: "DB_INSERT_FAILED", detalle: insertErr?.message },
      { status: 500 },
    );
  }

  const receptorLabel = body.receptor_razon_social?.trim() || "consumidor final";
  const { error: docInsertErr } = await sb.from("documentos_subidos").insert({
    empresa_id: usuario.empresa_id,
    nombre_archivo: `Boleta unica #${boleta.folio} - ${receptorLabel}`,
    tipo: "boleta_unica",
    storage_path: `boleta-unica://${boleta.id}`,
    estado: "procesado",
    movimientos_detectados: 1,
    created_at: `${fechaEmisionReal}T12:00:00.000Z`,
    progreso_ia: {
      origen: "emision_directa",
      proveedor: emisionConfig.proveedor,
      sandbox: false,
      boleta_id: boleta.id,
      folio: boleta.folio,
      tipo_dte: body.tipo_dte,
      monto_total: boleta.monto_total,
      receptor: receptorLabel,
      etiqueta: "Boleta unica",
    },
  });

  return NextResponse.json({
    ok: true,
    boleta_id: boleta.id,
    folio: boleta.folio,
    tipo_dte: body.tipo_dte,
    fecha_emision: boleta.fecha_emision,
    monto_total: boleta.monto_total,
    track_id: boleta.track_id,
    estado: boleta.estado,
    registro_agregados: docInsertErr ? "warning" : "ok",
    proveedor: emisionConfig.proveedor,
    sandbox: false,
    mensaje: `Boleta tipo ${body.tipo_dte} folio ${boleta.folio} emitida (${emisionConfig.proveedor})`,
  });
}

export const dynamic = "force-dynamic";
