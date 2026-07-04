import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";

/**
 * Mock SII — Registro de Compras y Ventas (RCV/RCOF).
 * Agrupa boletas_emitidas del mes por tipo DTE y retorna totales.
 *
 * Query params: ?mes=YYYY-MM (opcional, default mes actual)
 *
 * En producción real el SII publica el RCV propuesto a fin de mes que el
 * contribuyente puede aceptar o corregir. Acá lo construimos desde las
 * boletas que emitimos en el mock — solo el lado de VENTAS.
 */
export async function GET(request: Request) {
  const support = await getDevSupportMode();
  let supabase: SupabaseClient<Database>;
  let empresaId: string | null = null;

  if (support?.ok) {
    supabase = support.sb;
    empresaId = support.empresaId;
  } else {
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("empresa_id")
      .eq("id", user.id)
      .single();
    empresaId = usuario?.empresa_id ?? null;
  }

  if (!empresaId) return NextResponse.json({ ok: false, error: "SIN_EMPRESA" }, { status: 403 });

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ ok: false, error: "MES_INVALIDO", detalle: "Formato YYYY-MM" }, { status: 400 });
  }
  const desde = `${mes}-01`;
  const [y, m] = mes.split("-").map(Number) as [number, number];
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const hasta = `${next.y}-${String(next.m).padStart(2, "0")}-01`;

  const { data: boletas, error } = await supabase
    .from("boletas_emitidas")
    .select("id, tipo_dte, folio, fecha_emision, emisor_rut, receptor_rut, receptor_razon_social, monto_neto, monto_exento, iva, monto_total, estado")
    .eq("empresa_id", empresaId)
    .gte("fecha_emision", desde)
    .lt("fecha_emision", hasta)
    .neq("estado", "anulada")
    .order("folio", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = boletas ?? [];
  const resumen_por_tipo = rows.reduce<Record<number, { docs: number; neto: number; exento: number; iva: number; total: number }>>(
    (acc, b) => {
      const bucket = acc[b.tipo_dte] ?? { docs: 0, neto: 0, exento: 0, iva: 0, total: 0 };
      bucket.docs += 1;
      bucket.neto += b.monto_neto;
      bucket.exento += b.monto_exento;
      bucket.iva += b.iva;
      bucket.total += b.monto_total;
      acc[b.tipo_dte] = bucket;
      return acc;
    },
    {},
  );

  const totales = rows.reduce(
    (s, b) => ({
      docs: s.docs + 1,
      neto: s.neto + b.monto_neto,
      exento: s.exento + b.monto_exento,
      iva: s.iva + b.iva,
      total: s.total + b.monto_total,
    }),
    { docs: 0, neto: 0, exento: 0, iva: 0, total: 0 },
  );

  return NextResponse.json({
    ok: true,
    mes,
    resumen_por_tipo,
    totales,
    detalle: rows,
  });
}
