import * as XLSX from "xlsx";

export type ExcelPreviewSheet = {
  name: string;
  rows: string[][];
  rowCount: number;
  colCount: number;
};

export function worksheetToPreviewSheet(name: string, sheet: XLSX.WorkSheet): ExcelPreviewSheet {
  const ref = sheet["!ref"];
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  const rowCount = range ? range.e.r - range.s.r + 1 : 0;
  const colCount = range ? range.e.c - range.s.c + 1 : 0;
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });

  const rows = rawRows.map((row) =>
    Array.from({ length: colCount }, (_, index) => {
      const value = row[index];
      return value === null || value === undefined ? "" : String(value);
    })
  );

  return { name, rows, rowCount, colCount };
}

export function workbookToPreviewSheets(workbook: XLSX.WorkBook): ExcelPreviewSheet[] {
  return workbook.SheetNames.map((name) => worksheetToPreviewSheet(name, workbook.Sheets[name]));
}
