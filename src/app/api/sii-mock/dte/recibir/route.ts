import { NextResponse } from "next/server";
import { generarTrackId } from "@/lib/sii/dte-xml";

/**
 * Mock del endpoint del SII que recibe un DTE.
 * En el SII real: se envía el XML firmado, retorna track_id, después se consulta estado.
 *
 * Mock comportamiento:
 *   - Valida que el XML tenga estructura mínima (TipoDTE, Folio, RUTEmisor, MntTotal)
 *   - Retorna track_id mock + estado ACEPTADO inmediato
 *
 * NO se conecta al SII real. Solo simula el contrato.
 */
export async function POST(request: Request) {
  let body: { xml_dte?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const xml = body.xml_dte;
  if (!xml || typeof xml !== "string") {
    return NextResponse.json({ ok: false, error: "XML_REQUERIDO" }, { status: 400 });
  }

  // Validación mínima de estructura
  const checks = [
    { tag: "<TipoDTE>", code: "FALTA_TIPO_DTE" },
    { tag: "<Folio>", code: "FALTA_FOLIO" },
    { tag: "<RUTEmisor>", code: "FALTA_RUT_EMISOR" },
    { tag: "<MntTotal>", code: "FALTA_MONTO_TOTAL" },
    { tag: "<TED ", code: "FALTA_TED" },
    { tag: "<Signature ", code: "FALTA_FIRMA" },
  ];
  const missing = checks.filter((c) => !xml.includes(c.tag));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "XML_INVALIDO",
        codigo_rechazo: missing[0]!.code,
        detalle: missing.map((m) => m.code).join(", "),
      },
      { status: 422 },
    );
  }

  const trackId = generarTrackId();
  return NextResponse.json({
    ok: true,
    track_id: trackId,
    estado: "ACEPTADO",
    mensaje: "DTE recibido y aceptado por el SII (mock)",
    fecha_recepcion: new Date().toISOString(),
  });
}
