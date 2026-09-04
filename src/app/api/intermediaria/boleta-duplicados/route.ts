import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function parseAmount(value: string | null) {
  const n = Number(value ?? "");
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const tipoDte = Number(url.searchParams.get("tipo_dte"));
  const montoTotal = parseAmount(url.searchParams.get("monto_total"));
  const receptorRut = normalize(url.searchParams.get("receptor_rut"));
  const receptorNombre = normalize(url.searchParams.get("receptor_razon_social"));
  const detalle = normalize(url.searchParams.get("detalle"));

  if (!montoTotal || ![39, 41].includes(tipoDte)) {
    return NextResponse.json({ ok: true, candidatos: [] });
  }

  const desde = new Date();
  desde.setDate(desde.getDate() - 90);

  const { data, error } = await guard.service
    .from("boletas_emitidas")
    .select("id,folio,tipo_dte,fecha_emision,receptor_rut,receptor_razon_social,monto_total,estado,detalles")
    .eq("empresa_id", guard.empresaId)
    .neq("estado", "anulada")
    .gte("fecha_emision", desde.toISOString().slice(0, 10))
    .order("fecha_emision", { ascending: false })
    .limit(80);

  if (error) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: error.message }, { status: 500 });
  }

  const candidatos = (data ?? [])
    .map((row) => {
      const rowDetalle = Array.isArray(row.detalles)
        ? normalize(row.detalles.map((d) => (d && typeof d === "object" && !Array.isArray(d) ? String(d.nombre ?? "") : "")).join(" "))
        : "";
      const motivos: string[] = [];
      let score = 0;

      if (row.tipo_dte === tipoDte) { score += 2; motivos.push("mismo tipo"); }
      if (Math.round(Number(row.monto_total ?? 0)) === montoTotal) { score += 4; motivos.push("mismo monto"); }
      if (receptorRut && normalize(row.receptor_rut) === receptorRut) { score += 3; motivos.push("mismo RUT"); }
      if (!receptorRut && receptorNombre && normalize(row.receptor_razon_social) === receptorNombre) { score += 2; motivos.push("mismo receptor"); }
      if (detalle && rowDetalle && (rowDetalle.includes(detalle) || detalle.includes(rowDetalle))) { score += 2; motivos.push("detalle similar"); }

      return { row, motivos, score, rowDetalle };
    })
    .filter((item) => item.score >= 6)
    .slice(0, 5)
    .map(({ row, motivos, rowDetalle }) => ({
      id: row.id,
      folio: row.folio,
      tipo_dte: row.tipo_dte,
      fecha_emision: row.fecha_emision,
      receptor_rut: row.receptor_rut,
      receptor_razon_social: row.receptor_razon_social,
      monto_total: row.monto_total,
      estado: row.estado,
      detalle: rowDetalle,
      motivos,
    }));

  return NextResponse.json({ ok: true, candidatos });
}
