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

  const fechaParsed = parseFecha(fecha);

  // Fix 1: Idempotent — check if already exists
  const { data: existing } = await svc
    .from("movimientos_raw")
    .select("id")
    .eq("documento_id", documento_id)
    .eq("fecha", fechaParsed)
    .eq("monto", monto)
    .eq("descripcion", descripcion)
    .limit(1);

  if (existing && existing.length > 0) {
    // Already exists — remove from duplicados_detalle anyway and return ok
    await removeDuplicadoFromProgreso(svc, documento_id, fecha, monto, descripcion);
    return NextResponse.json({ ok: true, movimiento_id: existing[0].id, already_existed: true });
  }

  // 1. Insert movimiento
  const { data: movimiento, error: movError } = await svc
    .from("movimientos_raw")
    .insert({
      empresa_id: usuario.empresa_id,
      documento_id,
      fecha: fechaParsed,
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

  // 2. Create propuesta_ia with estado "pendiente" — user reviews in /revisar
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
      confianza: 0.7,
      estado: "pendiente",
      notas: "Agregado desde visor de omitidos — revisar antes de aprobar",
    });

  if (propError) {
    await svc.from("movimientos_raw").delete().eq("id", movimiento.id);
    return NextResponse.json({ error: propError.message }, { status: 500 });
  }

  // Fix 2: Remove this entry from progreso_ia.duplicados_detalle
  await removeDuplicadoFromProgreso(svc, documento_id, fecha, monto, descripcion);

  return NextResponse.json({ ok: true, movimiento_id: movimiento.id });
}

/**
 * Remove a specific duplicado entry from progreso_ia.duplicados_detalle
 * so it doesn't reappear on page reload.
 */
async function removeDuplicadoFromProgreso(
  svc: ReturnType<typeof createServiceClient<Database>>,
  documentoId: string,
  fecha: string,
  monto: number,
  descripcion: string
) {
  const { data: doc } = await svc
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .single();

  if (!doc?.progreso_ia) return;

  const progreso = doc.progreso_ia as Record<string, unknown>;
  const detalle = progreso.duplicados_detalle as Array<{
    fecha: string;
    monto: number;
    descripcion: string;
    [key: string]: unknown;
  }> | undefined;

  if (!detalle || !Array.isArray(detalle)) return;

  const montoNum = Number(monto);
  const updated = detalle.filter(
    (d) => !(d.descripcion === descripcion && Number(d.monto) === montoNum && d.fecha === fecha)
  );

  if (updated.length === detalle.length) return; // nothing changed

  const newProgreso = {
    ...progreso,
    duplicados_detalle: updated.length > 0 ? updated : undefined,
    duplicados_saltados: updated.length,
  };

  await svc
    .from("documentos_subidos")
    .update({
      progreso_ia: newProgreso as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
    })
    .eq("id", documentoId);
}
