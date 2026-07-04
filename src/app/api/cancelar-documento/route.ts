import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  if (!new Set(["owner", "admin", "contador"]).has(String(usuario.rol))) {
    return NextResponse.json({ error: "ROL_SIN_PERMISO" }, { status: 403 });
  }

  let body: { documento_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  if (!body.documento_id) return NextResponse.json({ error: "DOCUMENTO_ID_REQUERIDO" }, { status: 422 });

  const { error } = await supabase
    .from("documentos_subidos")
    .update({
      estado: "error",
      progreso_ia: { estado: "error", error: "Cancelado por el usuario" },
    })
    .eq("id", body.documento_id)
    .eq("empresa_id", usuario.empresa_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
