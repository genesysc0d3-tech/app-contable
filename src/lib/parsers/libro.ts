import * as XLSX from "xlsx";

/**
 * Lee el libro de una cartola. Un CSV/TXT se lee como TEXTO (raw): SheetJS
 * convertía "1.500" en 1,5 y "05/09/2026" en 9 de mayo (mm/dd) — adversarial-1
 * falla 5. Las fechas y los montos los decide el lector por columna
 * (parseFechaCartola, LectorMontos). Excel (xlsx/xls) sigue igual.
 */
export function leerLibroCartola(buffer: ArrayBuffer, extra: XLSX.ParsingOptions = {}): XLSX.WorkBook {
  return esTextoPlano(buffer)
    ? XLSX.read(buffer, { ...extra, type: "array", raw: true, cellDates: false })
    : XLSX.read(buffer, { ...extra, type: "array", cellDates: true, dateNF: "dd-mm-yyyy" });
}

/** ¿El archivo es texto plano (CSV/TXT) y no un Excel (zip "PK", OLE, HTML/XML)? */
export function esTextoPlano(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer.slice(0, 512));
  if (b.length === 0) return false;
  if (b[0] === 0x50 && b[1] === 0x4b) return false; // xlsx (zip)
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return false; // xls (OLE)
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0; // BOM
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  if (b[i] === 0x3c) return false; // "<": HTML/XML (xls exportado como html)
  for (let k = i; k < b.length; k++) if (b[k] === 0) return false; // binario
  return true;
}
