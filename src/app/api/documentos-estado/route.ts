import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  const { data: documentos } = await supabase
    .from("documentos_subidos")
    .select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia")
    .eq("empresa_id", usuario.empresa_id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ documentos: documentos ?? [] });
}
