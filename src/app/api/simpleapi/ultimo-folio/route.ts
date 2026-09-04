import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

/**
 * Último folio emitido vía SimpleAPI para la empresa del usuario.
 * La extensión lo consulta antes de asignar folio desde el CAF local:
 * el contador del vault vive en chrome.storage y se resetea al reinstalar
 * o cambiar de equipo, así que la fuente de verdad es boletas_emitidas.
 */
export async function GET(request: Request) {
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const tipoDte = Number(new URL(request.url).searchParams.get("tipo_dte"));
  if (![33, 34, 39, 41].includes(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_INVALID" }, { status: 422 });
  }

  const { data, error } = await guard.service
    .from("boletas_emitidas")
    .select("folio")
    .eq("empresa_id", guard.empresaId)
    .eq("tipo_dte", tipoDte)
    .eq("emision_proveedor", "simpleapi")
    .order("folio", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tipo_dte: tipoDte, ultimo_folio: data?.folio ?? null });
}

export const dynamic = "force-dynamic";
