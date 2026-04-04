"use server";

import { createClient } from "@/lib/supabase/server";

export interface ResumenMes {
  totalIngresos: number;
  totalEgresos: number;
  ivaDebito: number;
  ivaCredito: number;
  resultado: number;
  porTipo: Record<string, { count: number; total: number }>;
}

export interface PropuestaAprobada {
  id: string;
  tipo_propuesto: string;
  receptor_nombre: string | null;
  monto_neto: number | null;
  iva: number | null;
  total: number | null;
  estado: string;
  created_at: string;
  movimientos_raw: {
    fecha: string;
    descripcion: string;
    monto: number;
    tipo_flujo: string;
  };
}

export async function getResumenMes(
  empresaId: string,
  anio: number,
  mes: number
): Promise<ResumenMes> {
  const supabase = await createClient();

  const startDate = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const endDate =
    mes === 12
      ? `${anio + 1}-01-01`
      : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;

  // Query from movimientos_raw with proper date filter, join propuestas
  const { data } = await supabase
    .from("movimientos_raw")
    .select("monto, tipo_flujo, propuestas_ia(tipo_propuesto, iva)")
    .eq("empresa_id", empresaId)
    .gte("fecha", startDate)
    .lt("fecha", endDate);

  let totalIngresos = 0;
  let totalEgresos = 0;
  let ivaDebito = 0;
  let ivaCredito = 0;
  const porTipo: Record<string, { count: number; total: number }> = {};

  for (const m of data ?? []) {
    // Get the first approved propuesta for this movimiento
    const propuestas = m.propuestas_ia as unknown as { tipo_propuesto: string; iva: number }[] | null;
    const p = Array.isArray(propuestas) ? propuestas[0] : propuestas;
    if (!p) continue; // skip movimientos without propuestas

    const monto = Number(m.monto) || 0;
    const iva = Number(p.iva) || 0;

    if (m.tipo_flujo === "entrada") {
      totalIngresos += monto;
      ivaDebito += iva;
    } else {
      totalEgresos += monto;
      ivaCredito += iva;
    }

    const tipo = p.tipo_propuesto;
    if (!porTipo[tipo]) porTipo[tipo] = { count: 0, total: 0 };
    porTipo[tipo].count++;
    porTipo[tipo].total += monto;
  }

  return {
    totalIngresos,
    totalEgresos,
    ivaDebito,
    ivaCredito,
    resultado: totalIngresos - totalEgresos,
    porTipo,
  };
}

export async function getHistorico6Meses(
  empresaId: string,
  anio: number,
  mes: number
): Promise<{ mes: number; anio: number; ingresos: number; egresos: number }[]> {
  const supabase = await createClient();
  const result: { mes: number; anio: number; ingresos: number; egresos: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    let m = mes - i;
    let a = anio;
    while (m <= 0) { m += 12; a--; }

    const startDate = `${a}-${String(m).padStart(2, "0")}-01`;
    const endM = m === 12 ? 1 : m + 1;
    const endA = m === 12 ? a + 1 : a;
    const endDate = `${endA}-${String(endM).padStart(2, "0")}-01`;

    const { data } = await supabase
      .from("movimientos_raw")
      .select("monto, tipo_flujo, propuestas_ia(id)")
      .eq("empresa_id", empresaId)
      .gte("fecha", startDate)
      .lt("fecha", endDate);

    let ingresos = 0;
    let egresos = 0;
    for (const mov of data ?? []) {
      // Only count movimientos that have at least one propuesta
      const props = mov.propuestas_ia as unknown as { id: string }[] | null;
      if (!props || (Array.isArray(props) && props.length === 0)) continue;
      const monto = Number(mov.monto) || 0;
      if (mov.tipo_flujo === "entrada") ingresos += monto;
      else egresos += monto;
    }

    result.push({ mes: m, anio: a, ingresos, egresos });
  }

  return result;
}

export async function getPropuestasAprobadas(
  empresaId: string,
  fechaDesde?: string,
  fechaHasta?: string,
  limit?: number,
  offset?: number
): Promise<{ data: PropuestaAprobada[]; total: number }> {
  const supabase = await createClient();

  let query = supabase
    .from("propuestas_ia")
    .select("id, tipo_propuesto, receptor_nombre, monto_neto, iva, total, estado, created_at, movimientos_raw(fecha, descripcion, monto, tipo_flujo)", { count: "exact" })
    .eq("empresa_id", empresaId)
    .in("estado", ["aprobado", "editado"])
    .order("created_at", { ascending: false });

  if (fechaDesde) query = query.gte("movimientos_raw.fecha", fechaDesde);
  if (fechaHasta) query = query.lt("movimientos_raw.fecha", fechaHasta);
  if (limit) query = query.limit(limit);
  if (offset) query = query.range(offset, offset + (limit || 50) - 1);

  const { data, count } = await query;

  const filtered = (data ?? []).filter(
    (p) => p.movimientos_raw && !Array.isArray(p.movimientos_raw)
  ) as unknown as PropuestaAprobada[];

  return { data: filtered, total: count ?? filtered.length };
}
