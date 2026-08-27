import { NextResponse } from "next/server";
import { downloadFromR2 } from "@/lib/r2";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { extraerTimbrePng } from "@/lib/pdf/timbre-extract";
import { generarBoletaPersonalizada } from "@/lib/pdf/boleta-personalizada";
import { generarFacturaPersonalizada } from "@/lib/pdf/factura-personalizada";

/**
 * Boleta PERSONALIZADA a pedido (no se almacena): datos de la boleta + timbre
 * auténtico extraído del PDF oficial + logo de la empresa. Si no hay PDF
 * oficial del cual sacar el timbre, NO se genera (sin timbre no es una
 * representación válida del documento).
 */

function getPdfMeta(proveedorRespuesta: unknown): { storagePath: string | null; provider: string | null } {
  if (!proveedorRespuesta || typeof proveedorRespuesta !== "object") return { storagePath: null, provider: null };
  const pdf = (proveedorRespuesta as { pdf?: unknown }).pdf;
  if (!pdf || typeof pdf !== "object") return { storagePath: null, provider: null };
  const sp = (pdf as { storage_path?: unknown }).storage_path;
  const pv = (pdf as { provider?: unknown }).provider;
  return {
    storagePath: typeof sp === "string" && sp.trim() ? sp.trim() : null,
    provider: typeof pv === "string" ? pv : null,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAccountApiAccess({ requirePlan: true });
  if (!guard.ok) return guard.response;

  const { data: boleta, error } = await guard.service
    .from("boletas_emitidas")
    .select(
      "id, tipo_dte, folio, fecha_emision, medio_pago, detalles, monto_neto, monto_exento, iva, monto_total, receptor_razon_social, receptor_rut, receptor_giro, receptor_direccion, receptor_comuna, emisor_razon_social, emisor_rut, emisor_giro, emisor_direccion, emisor_comuna, proveedor_respuesta",
    )
    .eq("id", id)
    .eq("empresa_id", guard.empresaId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!boleta) return NextResponse.json({ ok: false, error: "NO_ENCONTRADA" }, { status: 404 });

  // 1. PDF oficial (fuente del timbre auténtico).
  const { storagePath, provider } = getPdfMeta(boleta.proveedor_respuesta);
  if (!storagePath) {
    return NextResponse.json(
      { ok: false, error: "PERSONALIZADA_NO_DISPONIBLE", detalle: "Esta boleta no tiene PDF oficial guardado del cual tomar el timbre." },
      { status: 404 },
    );
  }
  let oficial: Uint8Array;
  try {
    if (provider === "r2") {
      oficial = new Uint8Array(await downloadFromR2(storagePath));
    } else {
      const { data: file, error: dErr } = await guard.service.storage.from("documentos").download(storagePath);
      if (dErr || !file) throw new Error(dErr?.message ?? "PDF_DOWNLOAD_FAILED");
      oficial = new Uint8Array(await file.arrayBuffer());
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "PDF_OFICIAL_FAILED" }, { status: 500 });
  }

  // 2. Timbre.
  let timbrePng: Buffer | null = null;
  try {
    const timbre = await extraerTimbrePng(oficial);
    timbrePng = timbre?.png ?? null;
  } catch { /* sin timbre → se rechaza abajo */ }
  if (!timbrePng) {
    return NextResponse.json(
      { ok: false, error: "TIMBRE_NO_DISPONIBLE", detalle: "No se pudo extraer el timbre del PDF oficial." },
      { status: 422 },
    );
  }

  // 3. Logo de la empresa (opcional; mismo origen que /api/empresa/logo).
  let logo: { data: Buffer; formato: "PNG" | "JPEG" } | null = null;
  try {
    const dir = `${guard.empresaId}/logos`;
    const { data: files } = await guard.service.storage.from("documentos").list(dir);
    const f = files?.find((x) => x.name.startsWith("logo.") && !x.name.endsWith(".svg"));
    if (f) {
      const ext = f.name.split(".").pop()?.toLowerCase();
      const formato = ext === "png" ? "PNG" : ext === "jpg" || ext === "jpeg" ? "JPEG" : null;
      if (formato) {
        const { data: blob } = await guard.service.storage.from("documentos").download(`${dir}/${f.name}`);
        if (blob) logo = { data: Buffer.from(await blob.arrayBuffer()), formato };
      }
    }
  } catch { /* sin logo: el voucher sale igual */ }

  // 4. Detalles (Json → líneas; fallback humano si viene vacío).
  const detallesRaw = Array.isArray(boleta.detalles) ? boleta.detalles : [];
  const detalles = detallesRaw
    .map((d) => {
      const o = d as { nombre?: unknown; monto?: unknown };
      const cant = (d as { qty?: unknown; cantidad?: unknown });
      const n = typeof cant?.cantidad === "number" ? cant.cantidad : typeof cant?.qty === "number" ? cant.qty : null;
      return {
        nombre: typeof o?.nombre === "string" && o.nombre.trim() ? o.nombre.trim() : "Venta",
        monto: typeof o?.monto === "number" ? o.monto : boleta.monto_total,
        cantidad: n,
      };
    })
    .slice(0, 12);
  if (detalles.length === 0) {
    const exento = boleta.tipo_dte === 41 || boleta.tipo_dte === 34;
    detalles.push({ nombre: exento ? "Venta exenta" : "Venta", monto: boleta.monto_total, cantidad: 1 });
  }

  // FACTURAS (33/34): documento formal en carta, NO el voucher de boleta. Sin
  // esta rama el ojo dibujaba una "boleta" rotulada TIPO 41 para una factura —
  // el tipo tributario equivocado en la cara del documento.
  const esFactura = boleta.tipo_dte === 33 || boleta.tipo_dte === 34;
  if (esFactura) {
    const pdfFactura = generarFacturaPersonalizada({
      folio: boleta.folio,
      tipoDte: boleta.tipo_dte,
      fechaEmision: boleta.fecha_emision,
      formaPago: boleta.medio_pago ?? null, // en facturas acá vive Contado/Crédito
      emisor: {
        razonSocial: boleta.emisor_razon_social,
        rut: boleta.emisor_rut,
        giro: boleta.emisor_giro,
        direccion: boleta.emisor_direccion,
        comuna: boleta.emisor_comuna,
      },
      receptor: {
        razonSocial: boleta.receptor_razon_social,
        rut: boleta.receptor_rut,
        giro: boleta.receptor_giro,
        direccion: boleta.receptor_direccion,
        comuna: boleta.receptor_comuna,
      },
      detalles,
      montoNeto: boleta.monto_neto,
      montoExento: boleta.monto_exento,
      iva: boleta.iva,
      montoTotal: boleta.monto_total,
      timbrePng,
      logo,
    });
    return new Response(new Uint8Array(pdfFactura), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${boleta.tipo_dte}-${boleta.folio}.pdf"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const pdf = generarBoletaPersonalizada({
    folio: boleta.folio,
    tipoDte: boleta.tipo_dte,
    fechaEmision: boleta.fecha_emision,
    medioPago: boleta.medio_pago,
    emisor: {
      razonSocial: boleta.emisor_razon_social,
      rut: boleta.emisor_rut,
      giro: boleta.emisor_giro,
      direccion: boleta.emisor_direccion,
      comuna: boleta.emisor_comuna,
    },
    receptor: { razonSocial: boleta.receptor_razon_social, rut: boleta.receptor_rut },
    detalles,
    montoNeto: boleta.monto_neto,
    montoExento: boleta.monto_exento,
    iva: boleta.iva,
    montoTotal: boleta.monto_total,
    timbrePng,
    logo,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="boleta-${boleta.tipo_dte}-${boleta.folio}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}

export const dynamic = "force-dynamic";
