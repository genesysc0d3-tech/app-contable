import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseFecha } from "@/lib/ai/fecha";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  }

  const body = await request.json();
  const { documento_id, fecha, descripcion, monto, tipo_flujo, origen } = body;

  if (!documento_id || !descripcion || monto == null) {
    return NextResponse.json({ error: "Campos requeridos: documento_id, descripcion, monto" }, { status: 400 });
  }

  const svc = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await svc
    .from("movimientos_raw")
    .insert({
      empresa_id: usuario.empresa_id,
      documento_id,
      fecha: parseFecha(fecha),
      descripcion,
      monto,
      tipo_flujo: tipo_flujo || "entrada",
      origen: origen || null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, movimiento_id: data.id });
}
