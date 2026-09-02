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

  // Plantilla EXTENDIDA (2026-09-02, hoja de trabajo del contador): 3 columnas
  // obligatorias + 4 opcionales rotuladas. Las opcionales se detectan por
  // header (named.ts) y son 100% deterministas — lo que el cliente escribe
  // manda. La fila-guía explica cada una; el parser la salta (fecha inválida).
  const wsData = [
    ["Fecha", "Glosa", "Monto", "Tipo (opcional)", "RUT receptor (opcional)", "Nombre receptor (opcional)", "Medio de pago (opcional)"],
    [
      "dd-mm-aaaa",
      "Qué vendiste o prestaste",
      "Monto en CLP",
      "Afecta o Exenta — vacío: lo decide tu empresa",
      "Obligatorio solo si la venta supera ~$5,5 millones; bajo eso no se guarda (privacidad)",
      "Vacío = sin identificar (legal bajo ese monto)",
      "Transferencia / Efectivo / Tarjeta — vacío: Transferencia",
    ],
    ["13-05-2026", "Honorarios asesoría contable", 250000, "", "", "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Fila TOTAL con fórmula de fábrica: los contadores cuadran contra el total
  // del banco. El parser la salta solo (sin fecha) — visto en cartolas reales.
  XLSX.utils.sheet_add_aoa(ws, [["", "TOTAL (la app no lo cuenta como venta)"]], { origin: "A200" });
  ws["C200"] = { t: "n", f: "SUM(C3:C199)" };
  if (ws["!ref"]) ws["!ref"] = ws["!ref"].replace(/:.*$/, ":G200");

  ws["!cols"] = [
    { wch: 14 },
    { wch: 40 },
    { wch: 14 },
    { wch: 22 },
    { wch: 30 },
    { wch: 28 },
    { wch: 26 },
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
