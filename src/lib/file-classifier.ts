/**
 * Classifies files into processing categories:
 * - grande: >50 rows Excel/CSV, >300KB PDF, processes independently
 * - chico: small Excel/CSV/PDF, can be grouped
 * - imagen: images, always grouped, OCR first
 */

export type FileCategory = "grande" | "chico" | "imagen";

/**
 * ¿El Excel es la plantilla massDTE? MISMA detección del server
 * (detectPlantillaBoletas, lib pura — una función, dos lados). Se usa para NO
 * mostrar el botón "más info a IA": en la plantilla el cliente ya clasificó
 * fila a fila y la nota no se leería (fix del contexto placebo). Ilegible
 * client-side ⇒ false (se muestra el botón; el acuse server-side es la verdad).
 */
export async function esPlantillaMassdte(file: File): Promise<boolean> {
  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  if (!["xls", "xlsx", "xlsm"].includes(ext)) return false;
  try {
    const [{ read, utils }, { detectPlantillaBoletas }] = await Promise.all([
      import("xlsx"),
      import("@/lib/parsers/named"),
    ]);
    const buffer = await file.arrayBuffer();
    const wb = read(buffer, { type: "array", sheetRows: 12 });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return false;
    const rows = utils.sheet_to_json(sheet, { header: 1, defval: "" }) as (string | number)[][];
    return detectPlantillaBoletas(rows) != null;
  } catch {
    return false;
  }
}

const ROW_THRESHOLD = 50;
const PDF_SIZE_THRESHOLD = 300 * 1024; // 300KB
const FALLBACK_SIZE_THRESHOLD = 500 * 1024; // 500KB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const SPREADSHEET_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

/**
 * Count rows in a CSV by reading as text.
 */
async function countCsvRows(file: File): Promise<number> {
  try {
    const text = await file.text();
    return text.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Count rows in an Excel file by parsing with xlsx in the browser.
 */
async function countExcelRows(file: File): Promise<number> {
  try {
    const { read, utils } = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const wb = read(buffer, { type: "array", sheetRows: ROW_THRESHOLD + 5 });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) return 0;
    const sheet = wb.Sheets[firstSheet];
    const rows = utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * Classify a file. Async because it may need to read file contents
 * to count rows for Excel/CSV.
 */
export async function classifyFile(file: File): Promise<FileCategory> {
  if (IMAGE_TYPES.has(file.type)) return "imagen";

  if (file.type === "text/csv") {
    const rows = await countCsvRows(file);
    if (rows > ROW_THRESHOLD) return "grande";
    return "chico";
  }

  if (SPREADSHEET_TYPES.has(file.type)) {
    const rows = await countExcelRows(file);
    if (rows > ROW_THRESHOLD) return "grande";
    // Fallback: if we couldn't read rows, use size
    if (rows === 0 && file.size > FALLBACK_SIZE_THRESHOLD) return "grande";
    return "chico";
  }

  if (file.type === "application/pdf") {
    return file.size > PDF_SIZE_THRESHOLD ? "grande" : "chico";
  }

  // Fallback for other types
  return file.size > FALLBACK_SIZE_THRESHOLD ? "grande" : "chico";
}

export function getCategoryLabel(cat: FileCategory): string {
  switch (cat) {
    case "grande": return "Documento grande";
    case "chico": return "Documento";
    case "imagen": return "Imagen";
  }
}

export function getCategoryColor(cat: FileCategory): string {
  switch (cat) {
    case "grande": return "text-[#E8553E]";
    case "chico": return "text-[#F59E0B]";
    case "imagen": return "text-[#22C55E]";
  }
}

export const BADGE_COLORS: Record<number, string> = {
  1: "bg-[#E8553E]",
  2: "bg-[#3B82F6]",
  3: "bg-[#22C55E]",
  4: "bg-[#7C3AED]",
  5: "bg-[#F59E0B]",
};
