/**
 * Generador de PDF visual de una boleta emitida.
 * Replica el layout típico que imprime un software facturador chileno:
 * encabezado del emisor, cuadro folio+tipo, receptor (si aplica), detalle,
 * totales, y datos de trazabilidad. Para documentos mock imprime el TED local;
 * para documentos de proveedores legados evita mostrar timbres simulados como reales.
 */

export interface BoletaPDFData {
  folio: number;
  tipo_dte: number;
  fecha_emision: string;
  emisor: {
    rut: string;
    razon_social: string;
    giro?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  };
  receptor?: {
    rut?: string | null;
    razon_social?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  };
  detalles: { nombre: string; cantidad?: number; precio?: number; monto: number }[];
  totales: { neto: number; exento: number; iva: number; total: number };
  ted: string;
  track_id: string;
  estado: string;
  emision_proveedor?: "mock" | "baseapi";
  emision_sandbox?: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("es-CL");
}

export async function generarBoletaPDF(b: BoletaPDFData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const isExenta = b.tipo_dte === 41;
  const isNC = b.tipo_dte === 61;
  const isBaseApi = b.emision_proveedor === "baseapi";

  const titulo = isNC ? "NOTA DE CRÉDITO ELECTRÓNICA" : isExenta ? "BOLETA EXENTA ELECTRÓNICA" : "BOLETA ELECTRÓNICA";
  const margin = 14;
  const pageWidth = 210;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(b.emisor.razon_social, margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (b.emisor.giro) { doc.text(b.emisor.giro, margin, y); y += 4; }
  if (b.emisor.direccion) {
    doc.text(`${b.emisor.direccion}${b.emisor.comuna ? `, ${b.emisor.comuna}` : ""}`, margin, y);
    y += 4;
  }
  doc.text(`RUT: ${b.emisor.rut}`, margin, y);
  y += 6;

  const cuadroX = pageWidth - margin - 64;
  const cuadroY = margin;
  const cuadroW = 64;
  const cuadroH = 24;
  doc.setDrawColor(180, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(cuadroX, cuadroY, cuadroW, cuadroH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(180, 0, 0);
  doc.text(`R.U.T.: ${b.emisor.rut}`, cuadroX + cuadroW / 2, cuadroY + 5, { align: "center" });
  doc.setFontSize(10);
  doc.text(titulo, cuadroX + cuadroW / 2, cuadroY + 11, { align: "center" });
  doc.text(`N° ${b.folio}`, cuadroX + cuadroW / 2, cuadroY + 17, { align: "center" });
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(isBaseApi ? "S.I.I. — SANTIAGO" : "DOCUMENTO SIMULADO", cuadroX + cuadroW / 2, cuadroY + 22, { align: "center" });
  doc.setTextColor(0, 0, 0);

  y = Math.max(y, cuadroY + cuadroH + 4);

  doc.setFontSize(8);
  doc.text(`Fecha emisión: ${b.fecha_emision}`, margin, y);
  y += 6;

  if (b.receptor?.rut || b.receptor?.razon_social) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("RECEPTOR", margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    if (b.receptor.razon_social) { doc.text(`Señor(es): ${b.receptor.razon_social}`, margin, y); y += 4; }
    if (b.receptor.rut) { doc.text(`R.U.T.: ${b.receptor.rut}`, margin, y); y += 4; }
    if (b.receptor.direccion) {
      doc.text(`Dirección: ${b.receptor.direccion}${b.receptor.comuna ? `, ${b.receptor.comuna}` : ""}`, margin, y);
      y += 4;
    }
    y += 2;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setFillColor(230, 230, 230);
  doc.rect(margin, y, pageWidth - margin * 2, 6, "F");
  doc.text("Detalle", margin + 2, y + 4);
  doc.text("Monto", pageWidth - margin - 2, y + 4, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  for (const d of b.detalles) {
    const nombre = d.nombre.length > 70 ? d.nombre.slice(0, 67) + "..." : d.nombre;
    doc.text(nombre, margin + 2, y);
    doc.text(`$${fmt(d.monto)}`, pageWidth - margin - 2, y, { align: "right" });
    y += 5;
  }

  y += 4;
  doc.setDrawColor(0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const totalesX = pageWidth - margin - 60;
  if (!isExenta) {
    doc.text("Neto:", totalesX, y);
    doc.text(`$${fmt(b.totales.neto)}`, pageWidth - margin - 2, y, { align: "right" });
    y += 5;
    doc.text("IVA (19%):", totalesX, y);
    doc.text(`$${fmt(b.totales.iva)}`, pageWidth - margin - 2, y, { align: "right" });
    y += 5;
  } else {
    doc.text("Exento:", totalesX, y);
    doc.text(`$${fmt(b.totales.exento)}`, pageWidth - margin - 2, y, { align: "right" });
    y += 5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TOTAL:", totalesX, y);
  doc.text(`$${fmt(b.totales.total)}`, pageWidth - margin - 2, y, { align: "right" });
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
   doc.text(isBaseApi ? "Emision via proveedor legado" : "Timbre simulado para pruebas", margin, y);
  y += 3;
  if (isBaseApi) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      b.emision_sandbox
        ? "Documento emitido usando proveedor legado en modo sandbox."
        : "Documento emitido por proveedor legado. Verifique el respaldo tributario real antes de usarlo.",
      margin,
      y,
    );
    y += 4;
  } else {
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    const tedLines = b.ted.replace(/\n+/g, "\n").split("\n").slice(0, 18);
    for (const ln of tedLines) {
      doc.text(ln.slice(0, 160), margin, y);
      y += 2.4;
    }
  }
  y += 2;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.text(isBaseApi
    ? `Track ID: ${b.track_id}   ·   Estado proveedor: ${b.estado.toUpperCase()}`
    : `Track ID: ${b.track_id}   ·   Estado: SIMULADO (demo)`,
    margin,
    y,
  );
  y += 3;
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  doc.text(isBaseApi
    ? (b.emision_sandbox
      ? "Documento sandbox de proveedor legado. No usar como respaldo tributario real."
      : "Documento proveedor legado. Use solo si cuenta con respaldo tributario real externo.")
    : "DOCUMENTO DE PRUEBA — simulado, no informado al SII y sin validez tributaria real.",
    margin,
    y,
  );

  const filename = `boleta-${b.tipo_dte}-${b.folio}.pdf`;
  doc.save(filename);
}
