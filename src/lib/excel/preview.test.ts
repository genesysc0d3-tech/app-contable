import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { workbookToPreviewSheets } from "./preview";

describe("workbookToPreviewSheets", () => {
  it("returns cell text as structured rows instead of HTML", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Cliente", "Nota"],
      ["ACME", '<img src=x onerror="alert(1)">'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Hoja 1");

    const [preview] = workbookToPreviewSheets(workbook);

    expect(preview).toEqual({
      name: "Hoja 1",
      rowCount: 2,
      colCount: 2,
      rows: [
        ["Cliente", "Nota"],
        ["ACME", '<img src=x onerror="alert(1)">'],
      ],
    });
  });
});
