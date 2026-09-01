import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_BASE64_LARGO } from "@/lib/parsers/excel-guard";
import { rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const limited = await enforceRateLimitGlobal({
    key: rateLimitKey("subir-ejemplo-formato", user.id),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

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
  if (body.base64.length > MAX_BASE64_LARGO) {
    return NextResponse.json({ error: "ARCHIVO_DEMASIADO_GRANDE" }, { status: 413 });
  }

  const buffer = Buffer.from(body.base64, "base64");

  // Parse the Excel and compute fingerprint. Solo se usa la fila 0 de cada
  // hoja: sheetRows acota la materialización aunque el rango declarado mienta.
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", sheetRows: 5 });

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
    mensaje: "Formato registrado. Ahora sube una cartola igual desde Subir y usa Mapear campos.",
  });
}
