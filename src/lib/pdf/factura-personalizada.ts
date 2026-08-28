/**
 * Factura PERSONALIZADA: la cara con la marca del emisor para los DTE 33
 * (afecta) y 34 (exenta). Hermana de `boleta-personalizada.ts`, pero no es un
 * voucher: una factura es un documento comercial formal, se imprime, se archiva
 * y se le manda al cliente.
 *
 * DISEÑO — aprobado por el fundador sobre un mockup suyo (2026-08-27):
 * papel crema, tarjetas blancas de esquinas redondeadas, franja terracota en el
 * encabezado de la tabla, TOTAL destacado, y el recuadro normativo en
 * condensada para que golpee a la vista. Los bloques de datos van en tarjetas
 * tituladas con un ícono, no en una rejilla de etiquetas.
 *
 * ALTO DE LA HOJA: la norma lo deja LIBRE entre 11 y 33 cm (Manual de Muestras
 * Impresas del SII v3.0 §1.1.1), así que una factura corta se corta al
 * contenido en vez de arrastrar medio metro de blanco. Cuando el detalle no
 * cabe, el documento pasa a VARIAS HOJAS CARTA en vez de recortarse: el tope de
 * 33 cm es un techo legal por hoja, no una autorización para perder el timbre.
 *
 * NORMATIVA que se cumple explícitamente (Manual v3.0 + Circular 32/2005):
 * borde sin letras ≥5 mm · logo arriba a la izquierda ≤1/5 del documento ·
 * recuadro de 1,5×5,5 a 4×8 cm, letras ≥10 pt altas y negritas, solo RUT +
 * nombre del documento + folio · Unidad del SII bajo el recuadro · el recuadro
 * se repite en TODAS las hojas · timbre de 2×5 a 4×9 cm en la parte inferior a
 * ≥2 cm del borde izquierdo · recuadro de acuse de recibo de la Ley 19.983.
 *
 * El documento tributario sigue siendo el del SII; esto es una representación —
 * por eso el timbre PDF417 auténtico y la leyenda de resolución son obligatorios.
 *
 * OJO CON EL PIE: acá NO se escribe que massdte "emita" nada. Emitir un DTE
 * requiere autorización del SII, y quien emite es el contribuyente con sus
 * propias credenciales — nosotros automatizamos su trámite. Por eso abajo va el
 * wordmark solo, sin verbo: una marca de fábrica no afirma nada.
 */
import { jsPDF } from "jspdf";
import { ARCHIVO_NARROW_BOLD_B64 } from "./fonts/archivo-narrow-bold";
import { MASSDTE_WORDMARK_B64 } from "./assets/massdte-wordmark";

export interface FacturaPersonalizadaData {
  folio: number;
  tipoDte: 33 | 34 | number; // 33 afecta | 34 exenta
  fechaEmision: string; // YYYY-MM-DD
  /** "Contado" | "Crédito" (lo que quedó en el documento). */
  formaPago?: string | null;
  /** "S.I.I. - SAN BERNARDO", leído del PDF oficial. La norma lo exige. */
  unidadSii?: string | null;
  /** La fecha TAL COMO la imprime el portal, si se pudo leer del original. */
  fechaEmisionTexto?: string | null;
  /** Referencias del documento (orden de compra, guía de despacho…). */
  referencias?: string[] | null;
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
    ciudad?: string | null;
  } | null;
  detalles: { nombre: string; cantidad?: number | null; monto: number }[];
  montoNeto: number;
  montoExento: number;
  iva: number;
  montoTotal: number;
  timbrePng: Buffer | null;
  logo?: { data: Buffer; formato: "PNG" | "JPEG" } | null;
}

const ANCHO = 216;        // 21,5 cm normativos ≈ el ancho carta
const ALTO_MIN = 110;     // 11 cm — mínimo normativo
const ALTO_MAX = 330;     // 33 cm — máximo normativo
const ALTO_CARTA = 279.4; // alto de cada hoja cuando hay más de una
const MARGEN = 13;
const COL_DER = ANCHO - MARGEN;
const UTIL = COL_DER - MARGEN;
const CALLE = 6;
const COL_W = (UTIL - CALLE) / 2;
const X_COL2 = MARGEN + COL_W + CALLE;

// Paleta massdte.
const MARCA = "#E8553E";
const MARCA_SUAVE = "#FDEDE8";
const PAPEL = "#FDF7F4";
const BLANCO = "#FFFFFF";
const TINTA = "#1A1612";
const CUERPO = "#453F39";
const GRIS = "#6B6559";
const TENUE = "#A79E96";
const BORDE = "#F2E4DD";
const SEP = "#F4EAE5";

const FUENTE_TITULO = "ArchivoNarrow";
const RADIO = 2.6;

// Los aires, todos juntos a propósito: el fundador pidió apretar el diseño
// ("hay mucho aire"), y así se ajusta desde un solo lugar en vez de perseguir
// números sueltos por todo el archivo.
const AIRE_CABECERA = 8;  // cabecera → tarjetas
const AIRE_TARJETAS = 7;  // tarjetas → tabla
const AIRE_TABLA = 6;     // tabla → totales
const AIRE_TOTALES = 7;   // totales → zona legal
const AIRE_ZONA = 7;      // zona legal → pie
const H_CAB_TABLA = 10;
const H_FILA_TOT = 9.2;
const H_ZONA = 34;
const H_FILA_MIN = 9.4;

const CAJA_W = 80, CAJA_H = 38; // recuadro normativo en su máximo legal (4×8 cm)

const fmt = (n: number) => "$ " + Math.round(n).toLocaleString("es-CL");

function fechaHumana(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  if (!y || !m || !d) return iso;
  return `${d} de ${meses[m - 1]} de ${y}`;
}

/**
 * RUT con puntos y guion. La base lo guarda a veces pelado ("771551564") y en
 * la cara de un documento tributario eso se lee como un número cualquiera.
 */
function rutBonito(rut: string | null | undefined): string {
  const t = (rut ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (t.length < 2) return (rut ?? "").trim();
  return `${t.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${t.slice(-1)}`;
}

const esExenta = (tipo: number) => tipo === 34;

/** El nombre del documento va en el recuadro en MÁXIMO DOS LÍNEAS (norma). */
const lineasTitulo = (tipo: number): string[] =>
  esExenta(tipo) ? ["FACTURA NO AFECTA", "O EXENTA ELECTRÓNICA"] : ["FACTURA ELECTRÓNICA"];

type Op = {
  size?: number; bold?: boolean; color?: string; x?: number;
  align?: "center" | "left" | "right"; ls?: number; titulo?: boolean;
};
type Campo = { k: string; lineas: string[] };

/** Ayudantes de dibujo atados a un documento. */
function api(doc: jsPDF) {
  const t = (s: string, y: number, o: Op = {}) => {
    if (o.titulo) doc.setFont(FUENTE_TITULO, "bold");
    else doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 8.4); doc.setTextColor(o.color ?? CUERPO);
    if (o.ls) doc.setCharSpace(o.ls);
    doc.text(s, o.x ?? MARGEN, y, { align: o.align ?? "left" });
    if (o.ls) doc.setCharSpace(0);
  };
  const partir = (s: string, ancho: number, size: number, bold = false, max = 3) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    return (doc.splitTextToSize(s, ancho) as string[]).slice(0, max);
  };
  const tarjeta = (x: number, y: number, w: number, h: number, relleno = BLANCO, borde = BORDE) => {
    doc.setFillColor(relleno); doc.setDrawColor(borde); doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, RADIO, RADIO, "FD");
  };
  return { t, partir, tarjeta };
}

// ─────────────────────────── medición ───────────────────────────

interface Medidas {
  hLogo: number; wLogo: number;
  lnNombre: string[]; lnGiro: string[]; lnDir: string[];
  hEmisor: number; hBanda: number; anchoIzq: number;
  camposRec: Campo[]; camposDoc: Campo[]; hTarjetas: number;
  alturasFila: number[];
  hTotales: number;
  lnPie: string[]; hPie: number;
}

function medir(doc: jsPDF, f: FacturaPersonalizadaData): Medidas {
  const { partir } = api(doc);
  const anchoIzq = COL_DER - CAJA_W - MARGEN - 12;

  let hLogo = 0, wLogo = 0;
  if (f.logo) {
    try {
      const props = doc.getImageProperties(f.logo.data);
      hLogo = Math.min(14, (anchoIzq * props.height) / props.width);
      wLogo = (props.width / props.height) * hLogo;
    } catch { hLogo = 0; }
  }
  const lnNombre = partir(f.emisor.razonSocial, anchoIzq, 12.5, true, 3);
  const lnGiro = f.emisor.giro ? partir(`Giro: ${f.emisor.giro}`, anchoIzq, 8.2, false, 2) : [];
  // Dirección y comuna en UNA línea: apiladas eran dos renglones cortos que
  // dejaban la columna con aspecto de lista suelta.
  const dir = [f.emisor.direccion, f.emisor.comuna].filter(Boolean).join(" · ");
  const lnDir = dir ? partir(dir, anchoIzq, 8.2, false, 2) : [];
  const hEmisor = (hLogo ? hLogo + 5 : 0) + lnNombre.length * 5.2
    + (lnGiro.length ? 2.6 + lnGiro.length * 4 : 0)
    + (lnDir.length ? 2.2 + lnDir.length * 4 : 0);
  const hDer = CAJA_H + (f.unidadSii ? 9.5 : 0);

  const campo = (k: string, v: string | string[] | null | undefined, ancho: number): Campo | null => {
    if (!v || (Array.isArray(v) && v.length === 0)) return null;
    const lineas = (Array.isArray(v) ? v : [String(v)]).flatMap((s) => partir(s, ancho, 8, false, 2));
    return lineas.length ? { k, lineas } : null;
  };
  const anchoValRec = COL_W - 12 - 32;
  const anchoValDoc = COL_W - 12 - 36;
  // "Santiago, Santiago" es ruido: si la ciudad repite la comuna, se omite.
  const ciudadDistinta = Boolean(f.receptor?.ciudad
    && f.receptor.ciudad.trim().toLowerCase() !== (f.receptor?.comuna ?? "").trim().toLowerCase());
  const camposRec = [
    campo("Razón social", f.receptor?.razonSocial, anchoValRec),
    campo("RUT", f.receptor?.rut ? rutBonito(f.receptor.rut) : null, anchoValRec),
    campo("Giro", f.receptor?.giro, anchoValRec),
    campo("Dirección", f.receptor?.direccion, anchoValRec),
    campo("Comuna", f.receptor?.comuna, anchoValRec),
    ciudadDistinta ? campo("Ciudad / Región", f.receptor?.ciudad, anchoValRec) : null,
  ].filter((c): c is Campo => c !== null);
  const camposDoc = [
    campo("Fecha de emisión", f.fechaEmisionTexto || fechaHumana(f.fechaEmision), anchoValDoc),
    campo("Forma de pago", f.formaPago, anchoValDoc),
    campo("Referencias", f.referencias?.length ? f.referencias : null, anchoValDoc),
  ].filter((c): c is Campo => c !== null);
  const altoCampos = (cs: Campo[]) => cs.reduce((a, c) => a + c.lineas.length * 3.8 + 1.5, 0);
  const hTarjetas = 17 + Math.max(altoCampos(camposRec), altoCampos(camposDoc)) + 2.5;

  const alturasFila = f.detalles.map((d) =>
    Math.max(H_FILA_MIN, 5 + partir(d.nombre, COL_DER - 96 - MARGEN - 12, 8.2, false, 2).length * 4.2));

  const nFilasTot = esExenta(f.tipoDte) ? 2 : 3;
  const hTotales = nFilasTot * H_FILA_TOT + H_FILA_TOT + 2;

  const lnPie = partir(`Documento emitido electrónicamente por ${f.emisor.razonSocial}`,
    COL_DER - 34 - (MARGEN + 19), 7.8, false, 2);
  const hPie = Math.max(3 + 4.8 + (lnPie.length - 1) * 3.9 + 1.2, 10);

  return {
    hLogo, wLogo, lnNombre, lnGiro, lnDir,
    hEmisor, hBanda: Math.max(hEmisor, hDer), anchoIzq,
    camposRec, camposDoc, hTarjetas, alturasFila, hTotales, lnPie, hPie,
  };
}

// ─────────────────────────── secciones ───────────────────────────

/** Recuadro normativo + unidad del SII. Va en TODAS las hojas (norma). */
function pintarRecuadro(doc: jsPDF, f: FacturaPersonalizadaData, top: number): number {
  const { t } = api(doc);
  const cx = COL_DER - CAJA_W, cxm = cx + CAJA_W / 2;
  doc.setDrawColor(MARCA); doc.setLineWidth(1); doc.setFillColor(BLANCO);
  doc.roundedRect(cx, top, CAJA_W, CAJA_H, RADIO, RADIO, "FD");
  t(`RUT: ${rutBonito(f.emisor.rut)}`, top + 8.4, { size: 13, titulo: true, color: MARCA, align: "center", x: cxm });
  doc.setDrawColor("#F6CFC6"); doc.setLineWidth(0.4);
  doc.line(cx + 8, top + 11.6, cx + CAJA_W - 8, top + 11.6);
  const tit = lineasTitulo(f.tipoDte);
  const tam = tit.length === 1 ? 17 : 13;
  let ty = top + (tit.length === 1 ? 22.5 : 19.5);
  for (const ln of tit) { t(ln, ty, { size: tam, titulo: true, color: MARCA, align: "center", x: cxm }); ty += tam * 0.42; }
  t(`N° ${f.folio.toLocaleString("es-CL")}`, top + CAJA_H - 5.5, { size: 19, titulo: true, color: MARCA, align: "center", x: cxm });
  let fin = top + CAJA_H;
  if (f.unidadSii) {
    t(f.unidadSii.toUpperCase(), fin + 6.4, { size: 10.5, bold: true, color: TINTA, align: "center", x: cxm });
    fin += 9.5;
  }
  return fin;
}

/** Cabecera completa: emisor a la izquierda, recuadro a la derecha. */
function pintarCabecera(doc: jsPDF, f: FacturaPersonalizadaData, m: Medidas, top: number): number {
  const { t } = api(doc);
  const cIzq = MARGEN + m.anchoIzq / 2;
  const hDer = CAJA_H + (f.unidadSii ? 9.5 : 0);
  // Las dos columnas se centran una contra la otra: con el logo arriba, la del
  // emisor cambia de alto por empresa y colgar ambas del tope dejaba la
  // cabecera coja.
  pintarRecuadro(doc, f, top + (m.hBanda - hDer) / 2);

  let y = top + (m.hBanda - m.hEmisor) / 2;
  if (m.hLogo && f.logo) {
    try {
      doc.addImage(f.logo.data, f.logo.formato, cIzq - m.wLogo / 2, y, m.wLogo, m.hLogo);
      y += m.hLogo + 5;
    } catch { /* logo ilegible: manda el nombre y no se inventa un sello */ }
  }
  m.lnNombre.forEach((ln, i) => t(ln, y + 4.1 + i * 5.2, { size: 12.5, bold: true, color: TINTA, align: "center", x: cIzq }));
  y += m.lnNombre.length * 5.2;
  if (m.lnGiro.length) {
    m.lnGiro.forEach((ln, i) => t(ln, y + 2.6 + i * 4, { size: 8.2, color: CUERPO, align: "center", x: cIzq }));
    y += 2.6 + m.lnGiro.length * 4;
  }
  m.lnDir.forEach((ln, i) => t(ln, y + 2.2 + i * 4, { size: 8.2, color: GRIS, align: "center", x: cIzq }));
  return top + m.hBanda;
}

/** Cabecera de las hojas de continuación: identidad mínima + el recuadro. */
function pintarCabeceraCompacta(
  doc: jsPDF, f: FacturaPersonalizadaData, m: Medidas, top: number, subtitulo: string,
): number {
  const { t } = api(doc);
  const fin = pintarRecuadro(doc, f, top);
  const cIzq = MARGEN + m.anchoIzq / 2;
  const usadas = m.lnNombre.slice(0, 2);
  const yTexto = top + CAJA_H / 2 - (usadas.length - 1) * 2.5;
  usadas.forEach((ln, i) => t(ln, yTexto + i * 5, { size: 11, bold: true, color: TINTA, align: "center", x: cIzq }));
  t(subtitulo, yTexto + usadas.length * 5 + 1, { size: 8, color: GRIS, align: "center", x: cIzq });
  return fin;
}

function pintarTarjetas(doc: jsPDF, m: Medidas, top: number): number {
  const { t, tarjeta } = api(doc);
  /** Ícono dentro de un anillo de radio 5: TODO el glifo cabe en radio 3,6. */
  const icono = (x: number, cyy: number, tipo: "persona" | "doc") => {
    const cx2 = x + 5;
    doc.setDrawColor(MARCA); doc.setLineWidth(0.45);
    doc.circle(cx2, cyy, 5);
    doc.setLineWidth(0.4);
    if (tipo === "persona") {
      doc.circle(cx2, cyy - 1.5, 1.35);
      doc.lines([[0, -2.6, 5.2, -2.6, 5.2, 0]], cx2 - 2.6, cyy + 2.9); // hombros: UNA curva
    } else {
      doc.roundedRect(cx2 - 2.3, cyy - 1.6, 4.6, 4, 0.5, 0.5);
      doc.line(cx2 - 2.3, cyy - 0.2, cx2 + 2.3, cyy - 0.2);
      doc.line(cx2 - 1.1, cyy - 2.5, cx2 - 1.1, cyy - 1.6);
      doc.line(cx2 + 1.1, cyy - 2.5, cx2 + 1.1, cyy - 1.6);
    }
  };
  const pintarCampos = (x: number, y: number, anchoEtiqueta: number, cs: Campo[]) => {
    let cur = y;
    for (const c of cs) {
      t(c.k, cur, { size: 8, bold: true, color: TINTA, x });
      t(":", cur, { size: 8, color: TENUE, x: x + anchoEtiqueta });
      c.lineas.forEach((ln, i) => t(ln, cur + i * 3.8, { size: 8, color: CUERPO, x: x + anchoEtiqueta + 4 }));
      cur += c.lineas.length * 3.8 + 1.5;
    }
  };
  tarjeta(MARGEN, top, COL_W, m.hTarjetas);
  tarjeta(X_COL2, top, COL_W, m.hTarjetas);
  icono(MARGEN + 6, top + 8.4, "persona");
  icono(X_COL2 + 6, top + 8.4, "doc");
  t("DATOS DEL RECEPTOR", top + 9.6, { size: 9.4, bold: true, color: MARCA, ls: 0.25, x: MARGEN + 19 });
  t("DATOS DEL DOCUMENTO", top + 9.6, { size: 9.4, bold: true, color: MARCA, ls: 0.25, x: X_COL2 + 19 });
  pintarCampos(MARGEN + 6, top + 17, 28, m.camposRec);
  pintarCampos(X_COL2 + 6, top + 17, 32, m.camposDoc);
  return top + m.hTarjetas;
}

const COLS = [MARGEN, COL_DER - 96, COL_DER - 62, COL_DER - 30];
const centroCol = (i: number) => (COLS[i] + (i === 3 ? COL_DER : COLS[i + 1])) / 2;

function pintarCabeceraTabla(doc: jsPDF, top: number): number {
  const { t } = api(doc);
  doc.setFillColor(MARCA);
  doc.roundedRect(MARGEN, top, UTIL, H_CAB_TABLA, RADIO, RADIO, "F");
  doc.rect(MARGEN, top + H_CAB_TABLA - RADIO, UTIL, RADIO, "F"); // esquinas de abajo rectas
  const rot = (s: string, x: number, align: "left" | "center") =>
    t(s, top + 6.4, { size: 8, bold: true, color: BLANCO, ls: 0.3, align, x });
  rot("DESCRIPCIÓN", MARGEN + 6, "left");
  rot("CANTIDAD", centroCol(1), "center");
  rot("PRECIO UNITARIO", centroCol(2), "center");
  rot("MONTO", centroCol(3), "center");
  return top + H_CAB_TABLA;
}

/** Dibuja un tramo de filas con su marco. Devuelve el borde inferior. */
function pintarFilas(
  doc: jsPDF, f: FacturaPersonalizadaData, m: Medidas, top: number, desde: number, hasta: number,
): number {
  const { t, partir } = api(doc);
  const alto = m.alturasFila.slice(desde, hasta).reduce((a, b) => a + b, 0);
  doc.setFillColor(BLANCO); doc.setDrawColor(BORDE); doc.setLineWidth(0.3);
  doc.rect(MARGEN, top, UTIL, alto, "FD");
  let y = top;
  for (let i = desde; i < hasta; i++) {
    const d = f.detalles[i];
    const cant = d.cantidad && d.cantidad > 0 ? d.cantidad : 1;
    partir(d.nombre, COLS[1] - MARGEN - 12, 8.2, false, 2)
      .forEach((ln, k) => t(ln, y + 6.2 + k * 4.2, { size: 8.2, color: TINTA, x: MARGEN + 6 }));
    t(String(cant), y + 6.2, { size: 8.2, color: CUERPO, align: "center", x: centroCol(1) });
    t(fmt(Math.round(d.monto / cant)), y + 6.2, { size: 8.2, color: CUERPO, align: "center", x: centroCol(2) });
    t(fmt(d.monto), y + 6.2, { size: 8.2, color: TINTA, align: "center", x: centroCol(3) });
    y += m.alturasFila[i];
    if (i < hasta - 1) { doc.setDrawColor(SEP); doc.setLineWidth(0.25); doc.line(MARGEN, y, COL_DER, y); }
  }
  doc.setDrawColor(SEP); doc.setLineWidth(0.25);
  for (const c of COLS.slice(1)) doc.line(c, top, c, top + alto);
  return top + alto;
}

function pintarTotales(doc: jsPDF, f: FacturaPersonalizadaData, top: number): number {
  const { t } = api(doc);
  const tx = COL_DER - 96, tw = 96, corte = tx + 56;
  let y = top;
  const fila = (k: string, v: string, destacada = false) => {
    const h = H_FILA_TOT + (destacada ? 2 : 0);
    doc.setFillColor(destacada ? MARCA_SUAVE : BLANCO);
    doc.setDrawColor(destacada ? MARCA : BORDE); doc.setLineWidth(destacada ? 0.5 : 0.3);
    doc.rect(tx, y, tw, h, "FD");
    doc.setDrawColor(destacada ? "#F3BCB0" : BORDE); doc.setLineWidth(0.25);
    doc.line(corte, y, corte, y + h);
    const cy = y + (destacada ? 7.4 : 6.2);
    t(k, cy, { size: destacada ? 12 : 8.4, bold: true, color: destacada ? MARCA : TINTA, x: tx + 5 });
    t(v, cy, { size: destacada ? 12 : 8.4, bold: destacada, color: destacada ? MARCA : CUERPO, align: "right", x: COL_DER - 5 });
    y += h;
  };
  if (esExenta(f.tipoDte)) {
    fila("MONTO EXENTO", fmt(f.montoExento || f.montoTotal));
    fila("IVA", "—");
  } else {
    fila("MONTO NETO", fmt(f.montoNeto));
    fila("IVA (19%)", fmt(f.iva));
    fila("MONTO EXENTO", fmt(f.montoExento));
  }
  fila("TOTAL", fmt(f.montoTotal), true);
  return y;
}

function pintarZonaLegal(doc: jsPDF, f: FacturaPersonalizadaData, top: number): number {
  const { t, tarjeta } = api(doc);
  const wTimbre = 96, xAcuse = MARGEN + wTimbre + CALLE, wAcuse = COL_DER - xAcuse;
  tarjeta(MARGEN, top, wTimbre, H_ZONA, BLANCO, "#F6D9D0");
  if (f.timbrePng) {
    try {
      // 2×5 cm mínimo, 4×9 cm máximo (norma), a ≥2 cm del borde izquierdo.
      const props = doc.getImageProperties(f.timbrePng);
      const hT = 20.5, wT = Math.min(wTimbre - 14, Math.max(50, (props.width / props.height) * hT));
      doc.addImage(f.timbrePng, "PNG", MARGEN + (wTimbre - wT) / 2, top + 4, wT, hT);
    } catch { /* png ilegible: la tarjeta igual rotula el timbre */ }
  }
  t("TIMBRE ELECTRÓNICO SII", top + 28.4, { size: 8.6, bold: true, color: TINTA, ls: 0.2, align: "center", x: MARGEN + wTimbre / 2 });
  t("Res. 99 de 2014 · Verifique en www.sii.cl", top + 32.4, { size: 7.6, color: MARCA, align: "center", x: MARGEN + wTimbre / 2 });

  tarjeta(xAcuse, top, wAcuse, H_ZONA);
  t("ACUSE DE RECIBO LEY 19.983", top + 7, { size: 8.8, bold: true, color: MARCA, ls: 0.2, x: xAcuse + 6 });
  doc.setLineDashPattern([0.5, 0.9], 0);
  ["Nombre:", "RUT:", "Fecha:", "Recinto:", "Firma:"].forEach((k, i) => {
    const yy = top + 13.4 + i * 4.6;
    t(k, yy, { size: 7.8, bold: i === 4, color: i === 4 ? TINTA : CUERPO, x: xAcuse + 6 });
    doc.setDrawColor("#CDC4BC"); doc.setLineWidth(0.25);
    doc.line(xAcuse + 28, yy + 0.8, xAcuse + wAcuse - 6, yy + 0.8);
  });
  doc.setLineDashPattern([], 0);
  return top + H_ZONA;
}

function pintarPie(doc: jsPDF, f: FacturaPersonalizadaData, m: Medidas, top: number): number {
  const { t } = api(doc);
  doc.setDrawColor(BORDE); doc.setLineWidth(0.3); doc.line(MARGEN, top, COL_DER, top);
  const y = top + 6;
  // Los tres elementos (visto, texto, wordmark) se centran sobre UN MISMO EJE;
  // colgado cada uno de su propia altura quedaban en tres alturas distintas.
  const wMarca = 26, hMarca = wMarca * (172 / 800);
  const eje = y + m.hPie / 2;

  doc.setDrawColor(MARCA); doc.setLineWidth(0.45); doc.circle(MARGEN + 5, eje, 5);
  doc.setLineWidth(0.7); doc.setLineCap("round"); doc.setLineJoin("round");
  doc.lines([[1.7, 1.8], [3.4, -4.2]], MARGEN + 2.5, eje + 0.4);
  doc.setLineWidth(0.3); doc.setLineCap("butt");

  const topTexto = eje - m.hPie / 2;
  t("Gracias por su preferencia", topTexto + 3, { size: 8.4, bold: true, color: TINTA, x: MARGEN + 19 });
  m.lnPie.forEach((ln, i) => t(ln, topTexto + 7.8 + i * 3.9, { size: 7.8, color: GRIS, x: MARGEN + 19 }));

  // Wordmark SIN verbo: ver la nota de arriba sobre "emitir".
  try {
    doc.addImage(MASSDTE_WORDMARK_B64, "PNG", COL_DER - wMarca, eje - hMarca / 2, wMarca, hMarca);
  } catch { /* si el logo no carga, el pie igual cierra el documento */ }

  return y + m.hPie;
}

const pintarPapel = (doc: jsPDF, alto: number) => {
  doc.setFillColor(PAPEL); doc.rect(0, 0, ANCHO, alto + 4, "F");
};

/** Registra la condensada del recuadro. jsPDF la necesita en CADA documento. */
function nuevoDoc(alto: number): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: [ANCHO, alto], compress: true });
  doc.addFileToVFS("ArchivoNarrow-Bold.ttf", ARCHIVO_NARROW_BOLD_B64);
  doc.addFont("ArchivoNarrow-Bold.ttf", FUENTE_TITULO, "bold");
  return doc;
}

// ─────────────────────────── armado ───────────────────────────

export function generarFacturaPersonalizada(f: FacturaPersonalizadaData): Buffer {
  const m = medir(nuevoDoc(ALTO_MAX), f); // pasada de medición, sobre un doc de sacrificio

  const hArriba = m.hBanda + AIRE_CABECERA + m.hTarjetas + AIRE_TARJETAS + H_CAB_TABLA;
  const hCierre = AIRE_TABLA + m.hTotales + AIRE_TOTALES + H_ZONA + AIRE_ZONA + 6 + m.hPie;
  const hFilas = m.alturasFila.reduce((a, b) => a + b, 0);
  const unaSola = MARGEN + hArriba + hFilas + hCierre + MARGEN;

  const componer = (doc: jsPDF, desde: number, hasta: number, primera: boolean, cierra: boolean) => {
    let y = primera
      ? pintarCabecera(doc, f, m, MARGEN) + AIRE_CABECERA
      // La hoja de cierre no trae filas: decir "continuación del detalle" ahí
      // sería mentirle al que la lee.
      : pintarCabeceraCompacta(doc, f, m, MARGEN,
          hasta > desde ? "continuación del detalle" : "totales, timbre y acuse") + AIRE_CABECERA;
    if (primera) y = pintarTarjetas(doc, m, y) + AIRE_TARJETAS;
    if (hasta > desde) {
      y = pintarCabeceraTabla(doc, y);
      y = pintarFilas(doc, f, m, y, desde, hasta);
    }
    if (cierra) {
      y = pintarTotales(doc, f, y + AIRE_TABLA) + AIRE_TOTALES;
      y = pintarZonaLegal(doc, f, y) + AIRE_ZONA;
      pintarPie(doc, f, m, y);
    } else {
      api(doc).t("continúa en la hoja siguiente", y + 5, { size: 7.4, color: TENUE, align: "right", x: COL_DER });
    }
  };

  // ── caso normal: UNA hoja cortada al contenido ──
  if (unaSola <= ALTO_MAX) {
    const alto = Math.min(ALTO_MAX, Math.max(ALTO_MIN, Math.ceil(unaSola)));
    const doc = nuevoDoc(alto);
    pintarPapel(doc, alto);
    componer(doc, 0, f.detalles.length, true, true);
    return Buffer.from(doc.output("arraybuffer"));
  }

  // ── no cabe: se reparte en hojas carta ──
  // Recortar sería perder el timbre y el acuse; el tope de 33 cm es un techo
  // legal por hoja, no una autorización para mutilar el documento.
  const H = ALTO_CARTA;
  const hCompacta = CAJA_H + (f.unidadSii ? 9.5 : 0);
  const AVISO = 7;
  const tramos: [number, number][] = [];
  let i = 0;
  while (i < f.detalles.length) {
    const primera = tramos.length === 0;
    const arriba = MARGEN + (primera ? hArriba : hCompacta + AIRE_CABECERA + H_CAB_TABLA);
    const tope = H - arriba - MARGEN;
    let j = i, usado = 0;
    while (j < f.detalles.length && usado + m.alturasFila[j] <= tope - AVISO) { usado += m.alturasFila[j]; j++; }
    if (j === i) j = i + 1; // una fila gigante no puede trabar el reparto
    // Si son las últimas filas, hay que ver si el cierre cabe bajo ellas.
    if (j === f.detalles.length && usado + hCierre > tope) {
      tramos.push([i, j]);
      tramos.push([j, j]); // hoja final, solo con el cierre
      i = j;
      break;
    }
    tramos.push([i, j]);
    i = j;
  }

  const doc = nuevoDoc(H);
  tramos.forEach(([desde, hasta], idx) => {
    if (idx > 0) doc.addPage([ANCHO, H]);
    pintarPapel(doc, H);
    componer(doc, desde, hasta, idx === 0, idx === tramos.length - 1);
    api(doc).t(`Página ${idx + 1} de ${tramos.length}`, H - 6, { size: 7, color: TENUE, align: "right", x: COL_DER });
  });

  return Buffer.from(doc.output("arraybuffer"));
}
