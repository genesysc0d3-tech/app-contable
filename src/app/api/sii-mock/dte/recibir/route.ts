import { NextResponse } from "next/server";
import { recibirDTE } from "@/lib/sii-mock/recepcion";
import { mockSiiHttpHabilitado, requireSesionSegura } from "@/lib/api/sesion-segura";

/**
 * Endpoint mock del SII. Thin wrapper sobre `recibirDTE` (lib/sii-mock).
 * Expone el contrato HTTP que un intermediario real (Haulmer/OpenFactura)
 * consumiría; internamente la lógica vive en el módulo lib para que también
 * se pueda llamar in-process desde el `intermediario` sin pasar por HTTP.
 */
export async function POST(request: Request) {
  // Mock SIN protección propia (antes dependía 100 % del proxy). Solo fuera de
  // producción, y aun así con sesión segura: ver mockSiiHttpHabilitado.
  if (!mockSiiHttpHabilitado(process.env)) return NextResponse.json({ ok: false, error: "NO_ENCONTRADO" }, { status: 404 });
  const guard = await requireSesionSegura();
  if (!guard.ok) return guard.response;
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
