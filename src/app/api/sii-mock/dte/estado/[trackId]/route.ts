import { NextResponse } from "next/server";
import { consultarEstadoDTE } from "@/lib/sii-mock/recepcion";
import { mockSiiHttpHabilitado, requireSesionSegura } from "@/lib/api/sesion-segura";

/**
 * Mock del SII `getEstDte` — consulta el estado de un DTE ya recibido.
 * El intermediario (Haulmer-style) consulta acá después de enviar un DTE,
 * igual que en producción real con el SII.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  // Mock SIN protección propia (antes dependía 100 % del proxy). Solo fuera de
  // producción, y aun así con sesión segura: ver mockSiiHttpHabilitado.
  if (!mockSiiHttpHabilitado(process.env)) return NextResponse.json({ ok: false, error: "NO_ENCONTRADO" }, { status: 404 });
  const guard = await requireSesionSegura();
  if (!guard.ok) return guard.response;
  const { trackId } = await params;
  const result = consultarEstadoDTE(trackId);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
