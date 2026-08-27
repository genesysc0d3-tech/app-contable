/**
 * Factura PERSONALIZADA: la representación con la marca del emisor para los
 * DTE 33 (afecta) y 34 (exenta). Hermana de `boleta-personalizada.ts`, pero
 * NO es un voucher: una factura es un documento comercial formal, se imprime,
 * se archiva y se le manda al cliente. Va en CARTA, con receptor completo
 * (giro, dirección, comuna), forma de pago y desglose neto/IVA.
 *
 * CRITERIO DE DISEÑO (fundador: limpio, contenido, nivel Apple — nada flashy):
 * la jerarquía la hace la TIPOGRAFÍA y el AIRE, no las cajas ni los fondos.
 * Un solo gesto de marca (el filo superior). Las únicas líneas son las que
 * separan lo que de verdad hay que separar. El recuadro rojo del SII se
 * conserva porque es la convención que un contador chileno reconoce de un
 * vistazo — no es decoración nuestra.
 *
 * El documento tributario sigue siendo el del SII; esto es una "cara" — por eso
 * el timbre PDF417 auténtico y la leyenda de resolución son obligatorios.
 */
import { jsPDF } from "jspdf";

export interface FacturaPersonalizadaData {
  folio: number;
  tipoDte: 33 | 34 | number; // 33 afecta | 34 exenta
  fechaEmision: string; // YYYY-MM-DD
  /** "Contado" | "Crédito" (lo que quedó en el documento). */
  formaPago?: string | null;
  emisor: {
    razonSocial: string;
    rut: string;
    giro?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  };
  receptor?: {
    razonSocial?: string | null;
    rut?: string | null;
    giro?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  } | null;
  detalles: { nombre: string; cantidad?: number | null; monto: number }[];
  montoNeto: number;
  montoExento: number;
  iva: number;
  montoTotal: number;
  timbrePng: Buffer | null;
  logo?: { data: Buffer; formato: "PNG" | "JPEG" } | null;
}

// Carta (216 × 279 mm).
const ANCHO = 216;
const ALTO = 279;
const MARGEN = 20;
const COL_DER = ANCHO - MARGEN;
const ANCHO_UTIL = COL_DER - MARGEN;

const INK = "#131211"; // negro cálido, no puro
const CUERPO = "#3d3936";
const MUTED = "#7d7671";
const FAINT = "#a8a19b";
const LINEA = "#e6e1db"; // hairline cálida
const PAPEL = "#faf8f5"; // tinte del bloque de total
const ROJO = "#c0392b"; // convención SII
const VERDE = "#17603d";
const ACENTO = "#E8553E"; // marca massdte — se usa UNA vez

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

function fechaHumana(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  if (!y || !m || !d) return iso;
  return `${d} de ${meses[m - 1]} de ${y}`;
}

const esExenta = (tipo: number) => tipo === 34;
const tituloDte = (tipo: number) => (esExenta(tipo) ? "FACTURA NO AFECTA O EXENTA ELECTRÓNICA" : "FACTURA ELECTRÓNICA");

export function generarFacturaPersonalizada(f: FacturaPersonalizadaData): Buffer {
  const doc = new jsPDF({ unit: "mm", format: [ANCHO, ALTO], compress: true });

  type Op = {
    size?: number; font?: "helvetica" | "times"; style?: "normal" | "bold" | "italic";
    color?: string; align?: "center" | "left" | "right"; x?: number; charSpace?: number;
  };
  const texto = (s: string, ty: number, o: Op = {}) => {
    doc.setFont(o.font ?? "helvetica", o.style ?? "normal");
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(o.color ?? CUERPO);
    if (o.charSpace) doc.setCharSpace(o.charSpace);
    doc.text(s, o.x ?? MARGEN, ty, { align: o.align ?? "left" });
    if (o.charSpace) doc.setCharSpace(0);
  };

  /** Texto que respeta un ancho: devuelve el alto consumido. */
  const parrafo = (s: string, ty: number, ancho: number, o: Op = {}, interlinea = 4.2, maxLineas = 3) => {
    doc.setFont(o.font ?? "helvetica", o.style ?? "normal");
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(o.color ?? CUERPO);
    const lineas = (doc.splitTextToSize(s, ancho) as string[]).slice(0, maxLineas);
    lineas.forEach((ln, i) => doc.text(ln, o.x ?? MARGEN, ty + i * interlinea, { align: o.align ?? "left" }));
    return lineas.length * interlinea;
  };

  /** Etiqueta menuda: el idioma de los rótulos en todo el documento. */
  const rotulo = (s: string, ty: number, x = MARGEN, align: "left" | "right" = "left") =>
    texto(s, ty, { size: 6.2, color: FAINT, charSpace: 1.1, x, align });

  const hairline = (ry: number, x1 = MARGEN, x2 = COL_DER, color = LINEA) => {
    doc.setDrawColor(color);
    doc.setLineWidth(0.25);
    doc.line(x1, ry, x2, ry);
  };

  // ===== EL gesto de marca: un filo al tope de la página =====
  doc.setFillColor(ACENTO);
  doc.rect(0, 0, ANCHO, 1.6, "F");

  let y = MARGEN + 8;

  // ===== cabecera =====
  // Recuadro del SII (derecha). Convención chilena: RUT · tipo · folio.
  const cajaW = 68;
  const cajaX = COL_DER - cajaW;
  const cajaY = y - 5;
  const cajaCx = cajaX + cajaW / 2;
  doc.setDrawColor(ROJO);
  doc.setLineWidth(0.5);
  doc.roundedRect(cajaX, cajaY, cajaW, 31, 1.2, 1.2);
  texto(`R.U.T. ${f.emisor.rut}`, cajaY + 7.5, { size: 9.5, style: "bold", color: ROJO, align: "center", x: cajaCx });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(ROJO);
  const tituloLineas = (doc.splitTextToSize(tituloDte(f.tipoDte), cajaW - 10) as string[]).slice(0, 2);
  let tY = cajaY + 13.5;
  for (const ln of tituloLineas) { doc.text(ln, cajaCx, tY, { align: "center" }); tY += 3.8; }
  hairline(cajaY + 22.5, cajaX + 12, cajaX + cajaW - 12, "#eec4be");
  texto(`N° ${f.folio.toLocaleString("es-CL")}`, cajaY + 28, { font: "times", size: 13, style: "bold", color: ROJO, align: "center", x: cajaCx });

  // Emisor (izquierda). El nombre manda: serif grande y tranquilo.
  const anchoEmisor = cajaX - MARGEN - 12;
  if (f.logo) {
    try {
      const hLogo = 11;
      const props = doc.getImageProperties(f.logo.data);
      const wLogo = Math.min(40, (props.width / props.height) * hLogo);
      doc.addImage(f.logo.data, f.logo.formato, MARGEN, y - 5, wLogo, hLogo);
      y += hLogo + 2;
    } catch { /* logo ilegible: seguimos sin él */ }
  }
  y += parrafo(f.emisor.razonSocial, y + 2, anchoEmisor, { font: "times", size: 15, style: "bold", color: INK }, 6.2, 2) + 2.6;
  if (f.emisor.giro) y += parrafo(f.emisor.giro, y, anchoEmisor, { size: 7.8, color: MUTED }, 3.8, 2) - 0.4;
  const dirEmisor = [f.emisor.direccion, f.emisor.comuna].filter(Boolean).join(", ");
  if (dirEmisor) y += parrafo(dirEmisor, y + 3.8, anchoEmisor, { size: 7.8, color: MUTED }, 3.8, 2);

  y = Math.max(y, cajaY + 31) + 14;

  // ===== receptor =====
  rotulo("FACTURADO A", y);
  y += 6.2;
  y += parrafo(f.receptor?.razonSocial?.trim() || "—", y, ANCHO_UTIL, { font: "times", size: 13, style: "bold", color: INK }, 5.6, 2) + 3.4;

  // Rejilla de datos: tres columnas, rótulo arriba y valor abajo. Sin cajas.
  const colW = ANCHO_UTIL / 3;
  const campos: Array<[string, string | null | undefined]> = [
    ["R.U.T.", f.receptor?.rut],
    ["GIRO", f.receptor?.giro],
    ["DIRECCIÓN", [f.receptor?.direccion, f.receptor?.comuna].filter(Boolean).join(", ") || null],
  ];
  let altoFila = 0;
  campos.forEach(([k, v], i) => {
    if (!v || !String(v).trim()) return;
    const x = MARGEN + i * colW;
    rotulo(k, y, x);
    const h = parrafo(String(v).trim(), y + 4.6, colW - 8, { size: 8.4, color: CUERPO }, 3.9, 2);
    altoFila = Math.max(altoFila, h);
  });
  y += 4.6 + altoFila + 8;

  // Fecha y forma de pago, en la misma rejilla para que todo respire igual.
  rotulo("FECHA DE EMISIÓN", y);
  texto(fechaHumana(f.fechaEmision), y + 4.6, { size: 8.4 });
  if (f.formaPago) {
    rotulo("FORMA DE PAGO", y, MARGEN + colW);
    texto(f.formaPago, y + 4.6, { size: 8.4, style: "bold", color: INK, x: MARGEN + colW });
  }
  y += 13;

  // ===== detalle =====
  const xCant = COL_DER - 72;
  const xPrecio = COL_DER - 42;
  hairline(y - 4.6, MARGEN, COL_DER, "#d6d0c9");
  rotulo("DETALLE", y);
  rotulo("CANT.", y, xCant, "right");
  rotulo("PRECIO", y, xPrecio, "right");
  rotulo("TOTAL", y, COL_DER, "right");
  y += 3.4;
  hairline(y);
  y += 6.4;

  for (const d of f.detalles) {
    const cant = d.cantidad && d.cantidad > 0 ? d.cantidad : 1;
    const unitario = Math.round(d.monto / cant);
    const h = parrafo(d.nombre, y, xCant - MARGEN - 8, { size: 8.8, color: INK }, 4.2, 2);
    texto(String(cant), y, { size: 8.8, align: "right", x: xCant });
    texto(fmt(unitario), y, { size: 8.8, color: MUTED, align: "right", x: xPrecio });
    texto(fmt(d.monto), y, { size: 8.8, style: "bold", color: INK, align: "right", x: COL_DER });
    y += Math.max(h, 4.2) + 2.6;
    hairline(y - 1.6, MARGEN, COL_DER, "#f0ebe5");
  }

  y += 6;

  // ===== totales: la única superficie con fondo de todo el documento =====
  const totX = COL_DER - 76;
  const filaTot = (k: string, v: string, ty: number) => {
    texto(k, ty, { size: 8.2, color: MUTED, x: totX });
    texto(v, ty, { size: 8.2, color: CUERPO, align: "right", x: COL_DER });
  };
  if (esExenta(f.tipoDte)) {
    filaTot("Monto exento", fmt(f.montoExento || f.montoTotal), y); y += 5.6;
    filaTot("IVA", "—", y); y += 5.6;
  } else {
    filaTot("Monto neto", fmt(f.montoNeto), y); y += 5.6;
    filaTot("IVA (19%)", fmt(f.iva), y); y += 5.6;
    if (f.montoExento > 0) { filaTot("Monto exento", fmt(f.montoExento), y); y += 5.6; }
  }

  y += 1.4;
  const totalH = 16;
  doc.setFillColor(PAPEL);
  doc.roundedRect(totX - 6, y, COL_DER - totX + 6, totalH, 1.4, 1.4, "F");
  texto("TOTAL", y + 10, { size: 7.4, style: "bold", color: MUTED, charSpace: 1.2, x: totX });
  texto(fmt(f.montoTotal), y + 11.2, { font: "times", size: 19, style: "bold", color: INK, align: "right", x: COL_DER - 6 });
  y += totalH + 6.5;

  // Sello de emisión (el check se DIBUJA: Helvetica no trae el glifo ✓).
  doc.setFontSize(7); doc.setFont("helvetica", "bold");
  const wSello = doc.getTextWidth("Emitida en el SII");
  const cx0 = COL_DER - wSello - 4.4;
  doc.setDrawColor(VERDE); doc.setLineWidth(0.5);
  doc.line(cx0, y - 1.5, cx0 + 1, y - 0.5);
  doc.line(cx0 + 1, y - 0.5, cx0 + 2.7, y - 2.6);
  texto("Emitida en el SII", y, { size: 7, style: "bold", color: VERDE, align: "right", x: COL_DER });

  // ===== timbre: abajo a la izquierda, como en el documento oficial =====
  const timbreY = ALTO - MARGEN - 32;
  if (f.timbrePng) {
    const tw = 60; const th = 19;
    try {
      doc.addImage(f.timbrePng, "PNG", MARGEN, timbreY, tw, th);
      rotulo("TIMBRE ELECTRÓNICO SII", timbreY + th + 4.6);
      texto("Res. 99 de 2014 · Verifique este documento en www.sii.cl", timbreY + th + 9, { size: 6.6, color: MUTED });
    } catch { /* png ilegible: el pie igual cierra el documento */ }
  }

  // ===== pie =====
  hairline(ALTO - MARGEN - 5);
  texto("Emitido con MASSDTE", ALTO - MARGEN, { size: 6.4, color: FAINT, charSpace: 0.6 });
  texto("massdte.cl", ALTO - MARGEN, { size: 6.4, color: FAINT, charSpace: 0.6, align: "right", x: COL_DER });

  return Buffer.from(doc.output("arraybuffer"));
}
