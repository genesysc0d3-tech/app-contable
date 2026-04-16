import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";

/**
 * Lista propuestas tipo "boleta" aprobadas/editadas que aún NO están emitidas.
 * Cada item incluye los datos necesarios para emitir + un flag listo_emitir
 * que indica si pasa las validaciones del SII (RUT receptor si > $180k).
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }

  // 1) Propuestas aprobadas tipo boleta (con cliente + movimiento)
  const { data: propuestas, error: pErr } = await supabase
    .from("propuestas_ia")
    .select(`
      id,
      tipo_propuesto,
      receptor_nombre,
      receptor_rut,
      monto_neto,
      iva,
      total,
      estado,
      created_at,
      cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto)
    `)
    .eq("empresa_id", usuario.empresa_id)
    .in("estado", ["aprobado", "editado"])
    .eq("tipo_propuesto", "boleta")
    .order("created_at", { ascending: false });

  if (pErr) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: pErr.message }, { status: 500 });
  }

  // 2) IDs ya emitidas (vigentes, no anuladas) — service client porque la tabla
  //    aún no está en database.types
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);
  let yaEmitidas = new Set<string>();
  try {
    const { data: emitidas } = await sb
      .from("boletas_emitidas")
      .select("propuesta_id")
      .eq("empresa_id", usuario.empresa_id)
      .neq("estado", "anulada")
      .not("propuesta_id", "is", null);
    yaEmitidas = new Set((emitidas ?? []).map((e: { propuesta_id: string }) => e.propuesta_id));
  } catch {
    /* tabla aún no existe — todas son pendientes */
  }

  // 3) Mapear y enriquecer
  const items = (propuestas ?? [])
    .filter((p) => !yaEmitidas.has(p.id))
    .map((p) => {
      const cliente = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as {
        id: string; nombre: string; rut: string | null;
      } | null;
      const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as {
        fecha: string; descripcion: string; monto: number;
      } | null;
      const total = Number(p.total ?? mov?.monto ?? 0);
      const receptor_rut = p.receptor_rut ?? cliente?.rut ?? null;
      const receptor_nombre = p.receptor_nombre ?? cliente?.nombre ?? null;
      const requiereReceptor = total > RECEPTOR_OBLIGATORIO_DESDE;
      const tieneReceptor = !!receptor_rut && !!receptor_nombre;
      const listo_emitir = total > 0 && (!requiereReceptor || tieneReceptor);
      const motivo_no_listo = !listo_emitir
        ? total <= 0
          ? "Monto inválido"
          : "Falta RUT y razón social del receptor (monto > $180.000)"
        : null;

      return {
        id: p.id,
        descripcion: mov?.descripcion ?? "Sin descripción",
        fecha: mov?.fecha ?? p.created_at.slice(0, 10),
        receptor_rut,
        receptor_nombre,
        monto_total: total,
        listo_emitir,
        motivo_no_listo,
      };
    });

  const totales = {
    total_pendientes: items.length,
    listas_emitir: items.filter((i) => i.listo_emitir).length,
    bloqueadas: items.filter((i) => !i.listo_emitir).length,
    monto_total: items.reduce((s, i) => s + i.monto_total, 0),
    monto_listo: items.filter((i) => i.listo_emitir).reduce((s, i) => s + i.monto_total, 0),
  };

  return NextResponse.json({ ok: true, items, totales });
}
