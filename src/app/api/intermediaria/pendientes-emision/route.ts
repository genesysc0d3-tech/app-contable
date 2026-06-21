import { NextResponse } from "next/server";
import { getPendientesEmision, type EmpresaCtx } from "@/lib/intermediario/pendientes-emision";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

export async function GET() {
  const guard = await requireAccountApiAccess({ requirePlan: true });
  if (!guard.ok) return guard.response;
  const { data: empresa } = await guard.service
    .from("empresas")
    .select("giro, razon_social, tipo_contribuyente")
    .eq("id", guard.empresaId)
    .maybeSingle();
  const empresaCtx = (empresa as EmpresaCtx | null) ?? { giro: null, razon_social: "", tipo_contribuyente: null };

  try {
    const result = await getPendientesEmision(guard.service, guard.empresaId, empresaCtx);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
