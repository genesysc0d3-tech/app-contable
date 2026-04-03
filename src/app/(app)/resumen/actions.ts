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

  const { data } = await supabase
    .from("propuestas_ia")
    .select("tipo_propuesto, monto_neto, iva, total, movimientos_raw(fecha, tipo_flujo)")
    .eq("empresa_id", empresaId)
    .in("estado", ["aprobado", "editado"])
    .gte("movimientos_raw.fecha", startDate)
    .lt("movimientos_raw.fecha", endDate);

  const propuestas = (data ?? []).filter(
    (p) => p.movimientos_raw && !Array.isArray(p.movimientos_raw)
  );

  let totalIngresos = 0;
  let totalEgresos = 0;
  let ivaDebito = 0;
  let ivaCredito = 0;
  const porTipo: Record<string, { count: number; total: number }> = {};

  for (const p of propuestas) {
    const mov = p.movimientos_raw as unknown as { tipo_flujo: string };
    const total = Number(p.total) || 0;
    const iva = Number(p.iva) || 0;

    if (mov.tipo_flujo === "entrada") {
      totalIngresos += total;
      ivaDebito += iva;
    } else {
      totalEgresos += total;
      ivaCredito += iva;
    }

    const tipo = p.tipo_propuesto;
    if (!porTipo[tipo]) porTipo[tipo] = { count: 0, total: 0 };
    porTipo[tipo].count++;
    porTipo[tipo].total += total;
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
      .from("propuestas_ia")
      .select("total, movimientos_raw(fecha, tipo_flujo)")
      .eq("empresa_id", empresaId)
      .in("estado", ["aprobado", "editado"])
      .gte("movimientos_raw.fecha", startDate)
      .lt("movimientos_raw.fecha", endDate);

    let ingresos = 0;
    let egresos = 0;
    for (const p of data ?? []) {
      if (!p.movimientos_raw || Array.isArray(p.movimientos_raw)) continue;
      const mov = p.movimientos_raw as unknown as { tipo_flujo: string };
      const total = Number(p.total) || 0;
      if (mov.tipo_flujo === "entrada") ingresos += total;
      else egresos += total;
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
