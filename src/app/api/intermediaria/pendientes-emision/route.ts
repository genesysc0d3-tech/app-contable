import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPendientesEmision, type EmpresaCtx } from "@/lib/intermediario/pendientes-emision";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas!usuarios_empresa_id_fkey(giro, razon_social, tipo_contribuyente)")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  const empresaCtx = (usuario.empresas as unknown as EmpresaCtx | null) ?? { giro: null, razon_social: "", tipo_contribuyente: null };

  try {
    const result = await getPendientesEmision(supabase, usuario.empresa_id, empresaCtx);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
