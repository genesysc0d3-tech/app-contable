import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Último folio emitido vía SimpleAPI para la empresa del usuario.
 * La extensión lo consulta antes de asignar folio desde el CAF local:
 * el contador del vault vive en chrome.storage y se resetea al reinstalar
 * o cambiar de equipo, así que la fuente de verdad es boletas_emitidas.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });

  const tipoDte = Number(new URL(request.url).searchParams.get("tipo_dte"));
  if (![33, 34, 39, 41].includes(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_INVALID" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("boletas_emitidas")
    .select("folio")
    .eq("empresa_id", usuario.empresa_id)
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
