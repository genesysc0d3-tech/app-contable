import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { esTextoPlano, leerLibroCartola, textoUtf16 } from "@/lib/parsers/libro";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import { computeFingerprint } from "@/lib/parsers/fingerprint";
import { detectHeuristic } from "@/lib/parsers/heuristic";
import { detectByNames } from "@/lib/parsers/named";
import { hojaExcedeCeldas } from "@/lib/parsers/excel-guard";
import { rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";
import { recordOpsEvent } from "@/lib/ops/events";
import { applyAdapter } from "@/lib/parsers/apply";
import type { AdapterConfig, Row } from "@/lib/parsers/types";
import { adapterDelDocumento } from "@/lib/parsers/adapter-store";
import { leerCuadre } from "@/lib/cartola/cuadre-mesa";
import { bajarArchivoCartola, esPlanillaMapeable, clienteServicio, configDelCliente } from "@/lib/parsers/documento-cartola";

const PREVIEW_ROWS = 30;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const limited = await enforceRateLimitGlobal({
    key: rateLimitKey("parser-preview", user.id),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  const { documento_id } = await request.json();
  if (!documento_id) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });

  // Modo soporte (dev): la vista previa es LECTURA, así que el operador puede
  // mirar el excel del cliente con la empresa del soporte (antes esta ruta
  // buscaba con SU empresa → "Documento no encontrado" fantasma). Las rutas
  // de ESCRITURA (save-mapping, procesar) siguen bloqueadas en solo-lectura.
  const support = await getDevSupportMode();
  const sb = support?.ok ? support.sb : supabase;
  const empresaIdEfectiva = support?.ok ? support.empresaId : usuario.empresa_id;

  const { data: documento } = await sb
    .from("documentos_subidos")
    .select("*")
    .eq("id", documento_id)
    .eq("empresa_id", empresaIdEfectiva)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (!esPlanillaMapeable(documento.tipo)) {
    return NextResponse.json({ error: "Solo Excel soporta mapeo visual" }, { status: 400 });
  }

  let ab: ArrayBuffer;
  try { ab = await bajarArchivoCartola(sb, documento, { cache: true }); }
  catch { return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 }); }
  // El archivo ya pasó el cap de 10MB al subir, pero 10MB COMPRIMIDOS pueden
  // declarar un rango gigante que sheet_to_json expande a millones de celdas.
  // CSV/TXT como texto (libro.ts): "1.500" y "05/09/2026" tal cual, no 1,5 ni 9 de mayo.
  const workbook = esTextoPlano(ab) || textoUtf16(ab) != null ? leerLibroCartola(ab, { sheetRows: 10_000 }) : XLSX.read(ab, { type: "array", sheetRows: 10_000 });
  if (workbook.SheetNames.some((n) => hojaExcedeCeldas(workbook.Sheets[n]))) {
    await recordOpsEvent({
      severity: "warn",
      source: "upload",
      eventName: "excel_zip_bomb_rechazado",
      summary: "Excel con rango declarado gigante rechazado en el mapeo visual",
      empresaId: empresaIdEfectiva,
      usuarioId: user.id,
      metadata: { ruta: "parser-preview", documento_id },
    });
    return NextResponse.json({ error: "EXCEL_DEMASIADO_GRANDE" }, { status: 422 });
  }

  // Popup "Revisa las columnas": PRE-LLENADO con el mapa con que el lector leyó
  // ESTA cartola (el propio de la empresa), para que si está bien sea un clic en
  // "Listo". Sin él (global, capa 4), la sugerencia de los detectores.
  // Vuelta 3 (2026-10-03): el mapa con que se leyó ESTE documento queda en su
  // cuadre (mapa.config). La fila del adaptador puede haber cambiado después con
  // otra cartola; el popup muestra el de este documento. Sin él (docs viejos), el
  // adaptador del documento como antes.
  const mapaDelDoc = leerCuadre(((documento as { progreso_ia?: unknown }).progreso_ia ?? {}) as Record<string, unknown>)?.mapa?.config ?? null;
  const sbServicio = clienteServicio();
  const delLector = mapaDelDoc ? null : sbServicio ? await adapterDelDocumento(sbServicio, documento.id, empresaIdEfectiva) : null;
  const lector = mapaDelDoc ? configDelCliente(mapaDelDoc) : delLector?.config ? configDelCliente(delLector.config) : null;

  type SheetData = {
    name: string;
    rows: string[][];
    totalRows: number;
    nonEmptyBeyondPreview: number;
    cols: number;
    fingerprint: string;
    suggested: AdapterConfig | null;
    suggestedSource: "named" | "heuristic" | null;
    /** El mapa del lector produce movimientos en esta hoja (la que se leyó). */
    leeLector: boolean;
  };

  const sheets: SheetData[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const allRows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });
    const preview = allRows.slice(0, PREVIEW_ROWS).map((r) =>
      r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
    );
    const fingerprint = allRows.length > 0 ? computeFingerprint(allRows) : "";
    const cols = Math.max(0, ...preview.map((r) => r.length));
    // Los bancos rellenan la hoja con filas vacías al final (una cartola de 7
    // movimientos puede venir en 103 filas). El conteo de "movimientos a importar"
    // debe ignorarlas; el cliente solo ve PREVIEW_ROWS, así que le contamos las no
    // vacías del resto acá, donde tenemos la hoja completa.
    const nonEmptyBeyondPreview = allRows
      .slice(PREVIEW_ROWS)
      .filter((r) => r.some((cell) => String(cell ?? "").trim() !== "")).length;

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

    let leeLector = false;
    if (lector && allRows.length > 0) {
      try { leeLector = applyAdapter(allRows, lector).length > 0; } catch { /* esta hoja no */ }
    }

    return { name, rows: preview, totalRows: allRows.length, nonEmptyBeyondPreview, cols, fingerprint, suggested, suggestedSource, leeLector };
  });

  const primary = sheets.find((s) => s.leeLector) ?? sheets.find((s) => s.totalRows > 0) ?? sheets[0] ?? null;
  if (!primary) return NextResponse.json({ error: "Excel vacío" }, { status: 422 });


  return NextResponse.json({
    documento_id: documento.id,
    sheetName: primary.name,
    fingerprint: primary.fingerprint,
    totalRows: primary.totalRows,
    nonEmptyBeyondPreview: primary.nonEmptyBeyondPreview,
    cols: primary.cols,
    rows: primary.rows,
    suggested: lector && primary.leeLector ? lector : primary.suggested,
    suggestedSource: lector && primary.leeLector ? "lector" : primary.suggestedSource,
    allSheets: sheets.map((s) => ({ name: s.name, totalRows: s.totalRows })),
  });
}
