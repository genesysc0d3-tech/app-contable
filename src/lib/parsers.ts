import * as XLSX from "xlsx";

type Row = (string | number | null | undefined)[];

// Parse Chilean number: "1.600.000" or "80,000" or "1.234,56" → integer
function parseChileanNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // Strip all non-digit chars (drops thousands separators and decimals)
  const digits = s.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function normalizeDate(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  // dd/mm/yyyy → yyyy-mm-dd
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

// Detect cartola header row and return column indices for: fecha, desc, ndoc, cargo, abono
function detectCartolaHeader(
  rows: Row[]
): { headerIdx: number; cols: { fecha: number; desc: number; ndoc: number; cargo: number; abono: number } } | null {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i];
    if (!r) continue;
    const norm = r.map((c) => String(c ?? "").toLowerCase().trim());
    const fechaIdx = norm.findIndex((c) => c === "fecha");
    const descIdx = norm.findIndex((c) => c.includes("descripci"));
    const cargoIdx = norm.findIndex((c) => c.includes("cargo") || c.includes("cheques"));
    const abonoIdx = norm.findIndex((c) => c.includes("abono") || c.includes("depósit") || c.includes("deposit"));
    const ndocIdx = norm.findIndex((c) => c.includes("documento") || c === "n° documento" || c === "n documento");
    if (fechaIdx >= 0 && descIdx >= 0 && cargoIdx >= 0 && abonoIdx >= 0) {
      return {
        headerIdx: i,
        cols: { fecha: fechaIdx, desc: descIdx, ndoc: ndocIdx, cargo: cargoIdx, abono: abonoIdx },
      };
    }
  }
  return null;
}

// Deterministic cartola extraction: skips metadata, drops saldo column,
// pre-computes tipo_flujo, emits one self-describing line per tx.
// Format per line: TIPO_FLUJO|FECHA|MONTO|DESCRIPCION|N_DOCUMENTO
function extractCartola(rows: Row[]): string | null {
  const detected = detectCartolaHeader(rows);
  if (!detected) return null;
  const { headerIdx, cols } = detected;
  const lines: string[] = [];
  // Prepend format hint so Mistral knows each row is pre-classified
  lines.push("# Cartola pre-parseada. Formato: TIPO|FECHA|MONTO|DESCRIPCION|NDOC. TIPO ya viene clasificado (ENTRADA/SALIDA) — NO invertir.");
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const fechaRaw = r[cols.fecha];
    if (!fechaRaw || !String(fechaRaw).match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/)) continue;
    const cargo = parseChileanNumber(r[cols.cargo]);
    const abono = parseChileanNumber(r[cols.abono]);
    if (!cargo && !abono) continue;
    const tipo = cargo ? "SALIDA" : "ENTRADA";
    const monto = cargo || abono;
    const fecha = normalizeDate(fechaRaw);
    const desc = String(r[cols.desc] ?? "").trim();
    const ndoc = cols.ndoc >= 0 ? String(r[cols.ndoc] ?? "").trim() : "";
    lines.push(`${tipo}|${fecha}|${monto}|${desc}|${ndoc}`);
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

export function parseExcel(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: "array" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });

    // Try deterministic cartola extraction first
    const cartola = extractCartola(rows);
    if (cartola) {
      lines.push(`--- Hoja: ${sheetName} (cartola pre-parseada) ---`);
      lines.push(cartola);
      continue;
    }

    // Fallback: generic CSV for non-cartola sheets
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
    if (csv.trim()) {
      lines.push(`--- Hoja: ${sheetName} ---`);
      lines.push(csv);
    }
  }

  return lines.join("\n");
}
