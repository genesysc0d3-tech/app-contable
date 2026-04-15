import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { computeFingerprint } from "@/lib/parsers/fingerprint";
import { detectHeuristic } from "@/lib/parsers/heuristic";
import { detectByNames } from "@/lib/parsers/named";
import type { AdapterConfig, Row } from "@/lib/parsers/types";

const PREVIEW_ROWS = 30;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  const { documento_id } = await request.json();
  if (!documento_id) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, storage_path, tipo")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (documento.tipo !== "excel") {
    return NextResponse.json({ error: "Solo Excel soporta mapeo visual" }, { status: 400 });
  }

  const { data: file } = await supabase.storage.from("documentos").download(documento.storage_path);
  if (!file) return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 });

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  type SheetData = {
    name: string;
    rows: string[][];
    totalRows: number;
    cols: number;
    fingerprint: string;
    suggested: AdapterConfig | null;
    suggestedSource: "named" | "heuristic" | null;
  };

  const sheets: SheetData[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const allRows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });
    const preview = allRows.slice(0, PREVIEW_ROWS).map((r) =>
      r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
    );
    const fingerprint = allRows.length > 0 ? computeFingerprint(allRows) : "";
    const cols = Math.max(0, ...preview.map((r) => r.length));

    // Run detectors against the FULL sheet (not just preview rows) for accuracy
    let suggested: AdapterConfig | null = null;
    let suggestedSource: "named" | "heuristic" | null = null;
    if (allRows.length > 0) {
      const named = detectByNames(allRows);
      if (named) { suggested = named; suggestedSource = "named"; }
      else {
        const heur = detectHeuristic(allRows);
        if (heur) { suggested = heur; suggestedSource = "heuristic"; }
      }
    }

    return { name, rows: preview, totalRows: allRows.length, cols, fingerprint, suggested, suggestedSource };
  });

  const primary = sheets.find((s) => s.totalRows > 0) ?? sheets[0] ?? null;
  if (!primary) return NextResponse.json({ error: "Excel vacío" }, { status: 422 });

  return NextResponse.json({
    documento_id: documento.id,
    sheetName: primary.name,
    fingerprint: primary.fingerprint,
    totalRows: primary.totalRows,
    cols: primary.cols,
    rows: primary.rows,
    suggested: primary.suggested,
    suggestedSource: primary.suggestedSource,
    allSheets: sheets.map((s) => ({ name: s.name, totalRows: s.totalRows })),
  });
}
