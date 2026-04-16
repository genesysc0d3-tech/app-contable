import { NextResponse } from "next/server";
import { consultarEstadoDTE } from "@/lib/sii-mock/recepcion";

/**
 * Mock del SII `getEstDte` — consulta el estado de un DTE ya recibido.
 * El intermediario (Haulmer-style) consulta acá después de enviar un DTE,
 * igual que en producción real con el SII.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const result = consultarEstadoDTE(trackId);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
