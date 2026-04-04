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
  const { documento_id, fecha, descripcion, monto, tipo_flujo, origen, tipo_propuesto } = body;

  if (!documento_id || !descripcion || monto == null) {
    return NextResponse.json({ error: "Campos requeridos: documento_id, descripcion, monto" }, { status: 400 });
  }

  const svc = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Insert movimiento
  const { data: movimiento, error: movError } = await svc
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

  if (movError) {
    return NextResponse.json({ error: movError.message }, { status: 500 });
  }

  // 2. Create propuesta_ia with estado "aprobado"
  const montoNum = Number(monto) || 0;
  const tipoFinal = tipo_propuesto || "transferencia_p2p";
  const tieneIva = tipoFinal === "boleta" || tipoFinal === "boleta_honorarios" || tipoFinal === "factura" || tipoFinal === "factura_afecta" || tipoFinal === "gasto" || tipoFinal === "gasto_egreso";
  const montoNeto = tieneIva ? Math.round(montoNum / 1.19) : montoNum;
  const iva = tieneIva ? montoNum - montoNeto : 0;

  const { error: propError } = await svc
    .from("propuestas_ia")
    .insert({
      empresa_id: usuario.empresa_id,
      movimiento_id: movimiento.id,
      tipo_propuesto: tipoFinal,
      monto_neto: montoNeto,
      iva,
      total: montoNum,
      confianza: 1.0,
      estado: "aprobado",
      notas: "Agregado manualmente desde visor de omitidos",
    });

  if (propError) {
    // Rollback: delete the movimiento if propuesta fails
    await svc.from("movimientos_raw").delete().eq("id", movimiento.id);
    return NextResponse.json({ error: propError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, movimiento_id: movimiento.id });
}
