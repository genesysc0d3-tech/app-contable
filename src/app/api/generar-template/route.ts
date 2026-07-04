import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const wb = XLSX.utils.book_new();

  const wsData = [
    ["Fecha", "Glosa", "Monto"],
    ["dd-mm-aaaa", "Descripción del servicio o producto", "Monto en CLP"],
    ["13-05-2026", "Honorarios asesoría contable", 250000],
    ["13-05-2026", "Venta de productos", 180000],
    ["14-05-2026", "Servicio de consultoría", 350000],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws["!cols"] = [
    { wch: 14 },
    { wch: 40 },
    { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Boletas");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-boletas.xlsx"`,
    },
  });
}
