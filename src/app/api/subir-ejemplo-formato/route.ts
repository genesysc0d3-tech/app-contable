import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  let body: { empresa_id?: string; nombre?: string; base64?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  if (!body.base64 || !body.nombre) {
    return NextResponse.json({ error: "ARCHIVO_REQUERIDO" }, { status: 422 });
  }

  const buffer = Buffer.from(body.base64, "base64");

  // Parse the Excel and compute fingerprint
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });

  const fingerprints: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    if (rows.length > 0) {
      const headerRow = rows[0] as string[];
      const headerStr = headerRow.map((h) => h.toLowerCase().trim()).join("|");
      fingerprints.push(headerStr);
    }
  }

  return NextResponse.json({
    ok: true,
    nombre: body.nombre,
    hojas: workbook.SheetNames,
    fingerprints,
    mensaje: "Formato registrado. Ahora subí una cartola igual desde Subir y usa Mapear campos.",
  });
}
