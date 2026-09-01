import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { computeFingerprint } from "@/lib/parsers/fingerprint";
import { findTransactionBlockStart } from "@/lib/parsers/heuristic";
import { MAX_BASE64_LARGO, hojaExcedeCeldas } from "@/lib/parsers/excel-guard";
import { rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";
import { recordOpsEvent } from "@/lib/ops/events";
import type { Row } from "@/lib/parsers/types";

const PREVIEW_ROWS = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const limited = await enforceRateLimitGlobal({
    key: rateLimitKey("preview-formato", user.id),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let body: { base64?: string; nombre?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (!body.base64) return NextResponse.json({ error: "BASE64_REQUERIDO" }, { status: 422 });
  if (body.base64.length > MAX_BASE64_LARGO) {
    return NextResponse.json({ error: "ARCHIVO_DEMASIADO_GRANDE" }, { status: 413 });
  }

  const buffer = Buffer.from(body.base64, "base64");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dateNF: "dd-mm-yyyy", sheetRows: 5000 });

  // Techo de celdas ANTES de expandir: un rango declarado gigante infla
  // millones de strings con defval y bota la función.
  if (workbook.SheetNames.some((n) => hojaExcedeCeldas(workbook.Sheets[n]))) {
    await recordOpsEvent({
      severity: "warn",
      source: "upload",
      eventName: "excel_zip_bomb_rechazado",
      summary: "Excel con rango declarado gigante rechazado en preview-formato",
      usuarioId: user.id,
      metadata: { ruta: "preview-formato", nombre: body.nombre ?? null },
    });
    return NextResponse.json({ error: "EXCEL_DEMASIADO_GRANDE" }, { status: 422 });
  }

  const firstSheet = workbook.SheetNames.find((n) => {
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[n], { header: 1, defval: "" });
    return rows.length > 0;
  });

  if (!firstSheet) return NextResponse.json({ error: "Excel vacío" }, { status: 422 });

  const allRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheet], { header: 1, defval: "" });
  const fingerprint = computeFingerprint(allRows);

  // Detect where the transaction block starts (first row with date + number)
  const txStart = findTransactionBlockStart(allRows);

  // Build preview: try to find a header row just before txStart, then show transaction rows
  let previewStart = 0;
  let headerRow: string[] = [];
  let dataStartRow = 0;

  if (txStart > 0) {
    // Use the row just before txStart as header (column names)
    previewStart = Math.max(0, txStart - 1);
    headerRow = (allRows[previewStart] ?? []).map((c) =>
      c === null || c === undefined ? "" : String(c)
    );
    dataStartRow = txStart;
  }

  // Show data rows (from dataStartRow, up to PREVIEW_ROWS)
  const dataRows = allRows.slice(dataStartRow, dataStartRow + PREVIEW_ROWS).map((r) =>
    r.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );

  // Combine header + data for the full preview
  const preview = headerRow.length > 0
    ? [headerRow, ...dataRows]
    : allRows.slice(0, PREVIEW_ROWS).map((r) =>
        r.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
      );

  const cols = Math.max(0, ...preview.map((r) => r.length));

  return NextResponse.json({
    ok: true,
    sheetName: firstSheet,
    fingerprint,
    totalRows: allRows.length,
    cols,
    rows: preview,
    txStart: dataStartRow,
    hasHeader: headerRow.length > 0,
  });
}
