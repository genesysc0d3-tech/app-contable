import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

function monthRange(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, "0")}-01`;
  return { start, end };
}

export async function GET(request: Request) {
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const range = monthRange(year, month);
  if (!range) return NextResponse.json({ ok: false, error: "MONTH_INVALID" }, { status: 400 });

  const { data, error } = await guard.service
    .from("boletas_emitidas")
    .select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
    .eq("empresa_id", guard.empresaId)
    .gte("fecha_emision", range.start)
    .lt("fecha_emision", range.end)
    .order("fecha_emision", { ascending: false })
    .order("folio", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    year,
    month,
    boletas: data ?? [],
    truncated: (data ?? []).length >= 1000,
  });
}

export const dynamic = "force-dynamic";
