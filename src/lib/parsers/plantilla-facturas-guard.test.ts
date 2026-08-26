import { describe, expect, it } from "vitest";
import { PlantillaFacturasEnCartolaError, parseExcelWithOrchestrator } from "./orchestrator";
import * as XLSX from "xlsx";

// La barrera anti-mesa-equivocada: una plantilla de FACTURAS subida al carril
// de cartolas debe frenar con mensaje humano, no convertirse en boletas.
describe("plantilla de facturas en el carril de cartolas", () => {
  function xlsxDe(rows: (string | number)[][]): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Hoja1");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  it("frena con el error definitivo y el mensaje que dice dónde subirla", async () => {
    const ab = xlsxDe([
      ["RUT Receptor", "Detalle", "Valor Total"],
      ["76.086.428-5", "Asesoría", 100000],
    ]);
    await expect(parseExcelWithOrchestrator(ab)).rejects.toThrow(PlantillaFacturasEnCartolaError);
    await expect(parseExcelWithOrchestrator(ab)).rejects.toThrow(/mesa Facturas/);
  });

  it("la plantilla de BOLETAS (Fecha/Glosa/Monto) sigue pasando como siempre", async () => {
    const ab = xlsxDe([
      ["Fecha", "Glosa", "Monto"],
      ["13-05-2026", "Honorarios asesoría", 250000],
    ]);
    const { result } = await parseExcelWithOrchestrator(ab);
    expect(result.preExtracted?.length).toBe(1);
  });
});
