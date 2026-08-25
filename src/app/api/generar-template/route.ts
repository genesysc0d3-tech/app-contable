import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { PLANTILLA_FACTURAS_HEADERS } from "@/lib/facturas/plantilla";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const wb = XLSX.utils.book_new();

  // Mesa Facturas: UN solo campo de monto = VALOR TOTAL (criterio de Matías) y
  // receptor COMPLETO obligatorio (decisión del fundador): la factura
  // individualiza a su receptor — solo el Email es opcional (contacto, no
  // dato fiscal).
  if (new URL(request.url).searchParams.get("mesa") === "factura") {
    const wsF = XLSX.utils.aoa_to_sheet([
      [...PLANTILLA_FACTURAS_HEADERS],
      ["Ej: 12.345.678-5", "Asesoría mensual agosto", 500000, "Empresa Ejemplo SpA", "Servicios informáticos", "Av. Ejemplo 1234, of. 56", "Santiago", "(opcional)"],
    ]);
    wsF["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 13 }, { wch: 30 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsF, "Facturas");
    const bufF = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(bufF, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="plantilla-facturas.xlsx"`,
      },
    });
  }

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
