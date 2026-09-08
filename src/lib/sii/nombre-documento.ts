/**
 * Cómo se LLAMA un documento emitido, en un solo lugar (Matías 2026-09-07):
 * una factura descargada se llamaba `boleta-34-1234.pdf` y en la mesa de
 * facturas los sellos decían "DTE 33" o directamente "EXENTA" para una 33.
 * La información de las dos mesas no se cruza: cada tipo trae su nombre.
 */

export type TipoDteConocido = 33 | 34 | 39 | 41 | 61;

/** "Boleta" | "Factura" | "Nota de crédito" | "Documento" — para títulos y copy. */
export function nombreDocumento(tipoDte: number): string {
  if (tipoDte === 33 || tipoDte === 34) return "Factura";
  if (tipoDte === 39 || tipoDte === 41) return "Boleta";
  if (tipoDte === 61) return "Nota de crédito";
  return "Documento";
}

/** ¿Es un documento exento (sin IVA)? 41 boleta, 34 factura. */
export function esTipoExento(tipoDte: number): boolean {
  return tipoDte === 41 || tipoDte === 34;
}

/** Sello corto para la lista: AFECTA / EXENTA / NC / DTE n. */
export function etiquetaTipo(tipoDte: number): string {
  if (tipoDte === 33 || tipoDte === 39) return "AFECTA";
  if (tipoDte === 34 || tipoDte === 41) return "EXENTA";
  if (tipoDte === 61) return "NC";
  return `DTE ${tipoDte}`;
}

/** "Factura N°1234" / "Boleta N°1234" — el título con folio. */
export function tituloDocumento(tipoDte: number, folio: number | string): string {
  return `${nombreDocumento(tipoDte)} N°${folio}`;
}

/**
 * Nombre del archivo PDF: `Factura N°1234.pdf`, tal cual lo pidió Matías.
 * `sufijo` distingue variantes (p.ej. "personalizada") sin tocar el nombre base.
 */
export function archivoPdf(tipoDte: number, folio: number | string, sufijo?: string): string {
  return `${tituloDocumento(tipoDte, folio)}${sufijo ? ` ${sufijo}` : ""}.pdf`;
}
