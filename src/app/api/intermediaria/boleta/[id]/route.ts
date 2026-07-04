import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

/**
 * Retorna el detalle completo de una boleta emitida para render de PDF
 * en cliente. RLS restringe a la empresa del usuario autenticado.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireAccountApiAccess({ requirePlan: true });
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.service
    .from("boletas_emitidas")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", guard.empresaId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "NO_ENCONTRADA" }, { status: 404 });

  return NextResponse.json({ ok: true, boleta: data });
}
