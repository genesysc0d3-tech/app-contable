import { NextResponse } from "next/server";
import { recibirDTE } from "@/lib/sii-mock/recepcion";

/**
 * Endpoint mock del SII. Thin wrapper sobre `recibirDTE` (lib/sii-mock).
 * Expone el contrato HTTP que un intermediario real (Haulmer/OpenFactura)
 * consumiría; internamente la lógica vive en el módulo lib para que también
 * se pueda llamar in-process desde el `intermediario` sin pasar por HTTP.
 */
export async function POST(request: Request) {
  let body: { xml_dte?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const result = recibirDTE(body.xml_dte ?? "");
  const status = result.ok ? 200 : result.error === "XML_REQUERIDO" ? 400 : 422;
  return NextResponse.json(result, { status });
}
