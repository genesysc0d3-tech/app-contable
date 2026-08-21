/**
 * Boleta PERSONALIZADA: la representación con la marca del emisor (voucher
 * ~80mm estilo ticket fino, diseño aprobado por el fundador 2026-08-20).
 * No se almacena: se genera a pedido desde los datos de la boleta + el timbre
 * PDF417 extraído del PDF oficial del SII (auténtico, escaneable) + el logo
 * que la empresa ya subió en su configuración.
 *
 * El documento tributario sigue siendo el del SII; esto es una "cara" —
 * por eso el timbre y la leyenda de resolución son obligatorios en el layout.
 */
import { jsPDF } from "jspdf";

export interface BoletaPersonalizadaData {
  folio: number;
  tipoDte: number; // 39 afecta | 41 exenta
  fechaEmision: string; // YYYY-MM-DD
  medioPago?: string | null;
  emisor: {
    razonSocial: string;
    rut: string;
    giro?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  };
  receptor?: { razonSocial?: string | null; rut?: string | null } | null;
  detalles: { nombre: string; monto: number }[];
  montoNeto: number;
  montoExento: number;
  iva: number;
  montoTotal: number;
  timbrePng: Buffer | null; // null = sin timbre disponible (no debería pasar)
  logo?: { data: Buffer; formato: "PNG" | "JPEG" } | null;
}

const ANCHO = 80; // mm (voucher)
const MARGEN = 8;
const INK = "#141414";
const MUTED = "#6e6a66";
const FAINT = "#a39e99";
const DASH = "#d8d4cf";
const VERDE = "#17603d";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

function fechaHumana(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  if (!y || !m || !d) return iso;
  return `${d} ${meses[m - 1]} ${y}`;
}

export function generarBoletaPersonalizada(b: BoletaPersonalizadaData): Buffer {
  // Alto estimado por secciones (el voucher es una columna determinista).
  const altoDetalles = b.detalles.length * 5.4;
  const altoReceptor = b.receptor?.razonSocial || b.receptor?.rut ? 11 : 0;
  const alto = 96 + altoDetalles + altoReceptor + (b.timbrePng ? 30 : 6);

  const doc = new jsPDF({ unit: "mm", format: [ANCHO, alto], compress: true });
  const cx = ANCHO / 2;
  let y = 11;

  const texto = (
    s: string,
    ty: number,
    o: { size?: number; font?: "helvetica" | "times"; style?: "normal" | "bold"; color?: string; align?: "center" | "left" | "right"; x?: number; charSpace?: number } = {},
  ) => {
    doc.setFont(o.font ?? "helvetica", o.style ?? "normal");
    doc.setFontSize(o.size ?? 8);
    doc.setTextColor(o.color ?? INK);
    if (o.charSpace) doc.setCharSpace(o.charSpace);
    doc.text(s, o.x ?? cx, ty, { align: o.align ?? "center" });
    if (o.charSpace) doc.setCharSpace(0);
  };

  const cut = (cy: number) => {
    doc.setDrawColor(DASH);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([1.1, 1.1], 0);
    doc.line(MARGEN, cy, ANCHO - MARGEN, cy);
    doc.setLineDashPattern([], 0);
  };

  const filaKV = (k: string, v: string, fy: number, vBold = true) => {
    texto(k, fy, { size: 6.6, color: MUTED, align: "left", x: MARGEN });
    texto(v, fy, { size: 6.6, style: vBold ? "bold" : "normal", align: "right", x: ANCHO - MARGEN });
  };

  // ===== marca =====
  if (b.logo) {
    try {
      const alto = 9;
      const props = doc.getImageProperties(b.logo.data);
      const ancho = Math.min(34, (props.width / props.height) * alto);
      doc.addImage(b.logo.data, b.logo.formato, cx - ancho / 2, y - 5.5, ancho, alto);
      y += 6.5;
    } catch { /* logo ilegible: seguimos sin él */ }
  }
  texto(b.emisor.razonSocial.toUpperCase(), y + 3, { size: 7.4, style: "bold" });
  y += 6.6;
  const linea2 = [`R.U.T. ${b.emisor.rut}`, b.emisor.giro].filter(Boolean).join(" · ");
  texto(linea2, y, { size: 6.2, color: MUTED });
  y += 3.4;
  const linea3 = [b.emisor.direccion, b.emisor.comuna].filter(Boolean).join(", ");
  if (linea3) { texto(linea3, y, { size: 6.2, color: MUTED }); y += 3.4; }

  y += 2.2; cut(y); y += 6;

  // ===== identificación DTE =====
  texto("Boleta Electrónica", y, { font: "times", style: "bold", size: 11.5 });
  y += 4;
  texto(b.tipoDte === 39 ? "AFECTA · TIPO 39" : "EXENTA · TIPO 41", y, { size: 5, color: MUTED, charSpace: 0.7 });
  y += 4.6;
  texto(`FOLIO N° ${b.folio.toLocaleString("es-CL")}`, y, { size: 7.6, style: "bold" });

  y += 3.6; cut(y); y += 5;

  // ===== datos =====
  filaKV("Fecha de emisión", fechaHumana(b.fechaEmision), y); y += 4.2;
  if (b.medioPago) { filaKV("Forma de pago", b.medioPago, y); y += 4.2; }
  if (b.receptor?.razonSocial || b.receptor?.rut) {
    if (b.receptor.razonSocial) { filaKV("Receptor", b.receptor.razonSocial, y); y += 4.2; }
    if (b.receptor.rut) { filaKV("R.U.T. receptor", b.receptor.rut, y); y += 4.2; }
  }

  y += 0.6; cut(y); y += 5;

  // ===== detalle =====
  for (const d of b.detalles) {
    const nombre = d.nombre.length > 34 ? d.nombre.slice(0, 33) + "…" : d.nombre;
    texto(nombre, y, { size: 7, align: "left", x: MARGEN });
    texto(fmt(d.monto), y, { size: 7, style: "bold", align: "right", x: ANCHO - MARGEN });
    y += 5.4;
  }

  cut(y); y += 4.6;

  // ===== totales =====
  if (b.tipoDte === 39) {
    filaKV("Monto neto", fmt(b.montoNeto), y); y += 4.2;
    filaKV("IVA (19%)", fmt(b.iva), y); y += 4.2;
  } else {
    filaKV("Monto exento", fmt(b.montoExento), y); y += 4.2;
    filaKV("IVA", fmt(0), y); y += 4.2;
  }
  y += 2.4;
  texto("TOTAL", y, { size: 6, style: "bold", align: "left", x: MARGEN, charSpace: 0.8 });
  texto(fmt(b.montoTotal), y + 0.6, { font: "times", style: "bold", size: 14.5, align: "right", x: ANCHO - MARGEN });
  y += 4.6;
  // el check se DIBUJA (Helvetica no trae el glifo ✓)
  doc.setFontSize(5.8); doc.setFont("helvetica", "bold");
  const wEm = doc.getTextWidth("Emitida en el SII");
  const checkX = ANCHO - MARGEN - wEm - 3.2;
  doc.setDrawColor(VERDE); doc.setLineWidth(0.45);
  doc.line(checkX, y - 1.1, checkX + 0.8, y - 0.3);
  doc.line(checkX + 0.8, y - 0.3, checkX + 2.2, y - 2);
  texto("Emitida en el SII", y, { size: 5.8, style: "bold", color: VERDE, align: "right", x: ANCHO - MARGEN });

  y += 3; cut(y); y += 4.4;

  // ===== timbre =====
  if (b.timbrePng) {
    const tw = 52; const th = 17;
    try {
      doc.addImage(b.timbrePng, "PNG", cx - tw / 2, y, tw, th);
      y += th + 3.4;
      texto("TIMBRE ELECTRÓNICO SII", y, { size: 4.8, style: "bold", charSpace: 0.7 });
      y += 3;
      texto("Res. 99 de 2014 · Verifique documento en www.sii.cl", y, { size: 5.2, color: MUTED });
      y += 4;
    } catch { /* png ilegible: el pie igual cierra el documento */ }
  }

  // ===== pie =====
  texto("Emitido con MASSDTE · massdte.cl", y + 1.5, { size: 4.8, color: FAINT, charSpace: 0.4 });

  return Buffer.from(doc.output("arraybuffer"));
}
