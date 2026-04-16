import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Retorna el detalle completo de una boleta emitida para render de PDF
 * en cliente. RLS restringe a la empresa del usuario autenticado.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data, error } = await supabase
    .from("boletas_emitidas")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "NO_ENCONTRADA" }, { status: 404 });

  return NextResponse.json({ ok: true, boleta: data });
}
