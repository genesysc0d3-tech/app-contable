import * as XLSX from "xlsx";

export function parseExcel(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: "array" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert to CSV — tab-separated for better readability by LLM
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
    if (csv.trim()) {
      lines.push(`--- Hoja: ${sheetName} ---`);
      lines.push(csv);
    }
  }

  return lines.join("\n");
}
