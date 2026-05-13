import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { computeFingerprint } from "@/lib/parsers/fingerprint";
import type { Row } from "@/lib/parsers/types";

const PREVIEW_ROWS = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { base64?: string; nombre?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (!body.base64) return NextResponse.json({ error: "BASE64_REQUERIDO" }, { status: 422 });

  const buffer = Buffer.from(body.base64, "base64");
  const workbook = XLSX.read(buffer, { type: "array" });

  const firstSheet = workbook.SheetNames.find((n) => {
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[n], { header: 1, defval: "" });
    return rows.length > 0;
  });

  if (!firstSheet) return NextResponse.json({ error: "Excel vacío" }, { status: 422 });

  const allRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheet], { header: 1, defval: "" });
  const preview = allRows.slice(0, PREVIEW_ROWS).map((r) =>
    r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );
  const fingerprint = computeFingerprint(allRows);
  const cols = Math.max(0, ...preview.map((r) => r.length));

  return NextResponse.json({
    ok: true,
    sheetName: firstSheet,
    fingerprint,
    totalRows: allRows.length,
    cols,
    rows: preview,
  });
}
