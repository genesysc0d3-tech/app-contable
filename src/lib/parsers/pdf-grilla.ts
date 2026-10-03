import * as XLSX from "xlsx";
import type { Row } from "./types";
import { cellEsFecha } from "./celdas";
import { leerCeldaMonto } from "./numeros";
import { normalizarTitulo } from "./encabezados";

/**
 * CARTOLA EN PDF → GRILLA (2026-10-02, "comida para entrenamiento").
 *
 * Antes un PDF entraba como TEXTO PLANO (pdf-parse): las columnas se perdían
 * (el texto no dice si "$ 120.000" estaba bajo Cargos o bajo Abonos) y la
 * cartola iba entera a la IA, sin juez ni sello. Peor: una cartola corta (≤3000
 * caracteres, p. ej. Itaú de una página y media) se trataba como COMPROBANTE.
 *
 * Ahora se leen las POSICIONES de cada trozo de texto (pdf.js) y se arma la
 * misma grilla filas×columnas que trae un Excel. Esa grilla pasa por el MISMO
 * lector determinístico (orquestador → heurística/títulos → juez del banco →
 * sello). Nada se adivina acá: este módulo solo ubica texto en celdas; quién es
 * cargo, abono o saldo lo decide el lector, y si no hay PRUEBA (saldo corrido o
 * totales del banco) la cartola sale sin sello y va al popup "Revisar columnas".
 *
 * Reglas de la grilla (todas por FORMA, ninguna por banco):
 *   - Línea = trozos con la misma altura (±4 pt) en la misma página.
 *   - Trozos pegados (hueco < 3 pt) son la misma celda.
 *   - Fila de MOVIMIENTO = trae una fecha y al menos un monto en otra celda.
 *   - Columnas = intervalos horizontales de las celdas de los movimientos que
 *     se solapan (montos alineados a la derecha y glosas a la izquierda se
 *     solapan dentro de su columna, no con la vecina).
 *   - Títulos: la línea con "Fecha" justo arriba del primer movimiento de la
 *     página (y sus líneas de continuación: "Depósitos / o abonos") se ubican en
 *     la columna con la que más se solapan. Repetidos en cada página → una vez.
 *   - Entre movimientos, una línea sin fecha (glosa partida) también va por
 *     columnas: el lector ya pega la continuación a la glosa anterior.
 *   - Fuera de la tabla (encabezado del banco, resumen): celdas en orden, y una
 *     línea de SOLO montos se alinea bajo sus etiquetas de la línea de arriba
 *     ("Saldo anterior" arriba, "$ 1.234" abajo), como lo lee el juez.
 */

export interface ItemPdf {
  str: string;
  /** Borde izquierdo (pt). */
  x: number;
  /** Línea base (pt, crece hacia ARRIBA como en PDF). */
  y: number;
  /** Ancho (pt). */
  w: number;
  pagina: number;
}

export interface Celda { texto: string; x0: number; x1: number }
export interface Linea { pagina: number; y: number; celdas: Celda[] }

const TOL_Y = 4;
const HUECO_MISMA_CELDA = 3;
/** Sobre este número de páginas el PDF NO se lee (no se sella una cartola con páginas sin leer). */
export const MAX_PAGINAS = 80;

/**
 * Lee los trozos de texto con su posición. Solo server. Va por el MISMO pdf.js
 * que ya abre el PDF en la cola (el de pdf-parse): cargar además pdfjs-dist
 * directo en el mismo proceso choca de versión con el worker que dejó pdf-parse
 * ("API version 6.x does not match the Worker version 5.x").
 */
export async function itemsDePdf(data: Uint8Array, clave?: string): Promise<ItemPdf[]> {
  return (await leerItemsPdf(data, clave)).items;
}

/** Items + páginas del PDF. `truncado` = trae más de MAX_PAGINAS (solo se leyeron las primeras). */
export async function leerItemsPdf(data: Uint8Array, clave?: string): Promise<{ items: ItemPdf[]; paginas: number; truncado: boolean }> {
  const { PDFParse } = await import("pdf-parse");
  // COPIA: pdf.js se apropia del buffer y lo deja desprendido.
  const copia = new Uint8Array(data);
  const parser = new PDFParse(clave ? { data: copia, password: clave } : { data: copia });
  const out: ItemPdf[] = [];
  let paginas = 0;
  try {
    // load() es interno de pdf-parse (el doc de pdf.js ya abierto, con clave).
    const doc = await (parser as unknown as { load(): Promise<DocPdf> }).load();
    paginas = doc.numPages;
    // Sobre el tope no se lee NADA (ni las primeras páginas): no se sella una
    // cartola con páginas sin leer y no se gasta CPU en un PDF gigante.
    if (paginas > MAX_PAGINAS) return { items: [], paginas, truncado: true };
    const n = doc.numPages;
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      empujarItems(tc.items, p, out);
    }
  } finally {
    await parser.destroy().catch(() => {});
  }
  return { items: out, paginas, truncado: paginas > MAX_PAGINAS };
}

/** Lo que sale de UNA apertura del PDF: texto plano + posiciones + páginas. */
export interface LecturaPdf {
  /** El MISMO texto que `new PDFParse(...).getText()` (flujo de texto / comprobante / IA). */
  texto: string;
  /** Posiciones (vacío si `truncado`: sobre MAX_PAGINAS no se juntan). */
  items: ItemPdf[];
  paginas: number;
  truncado: boolean;
}

/**
 * UNA SOLA APERTURA del PDF (2026-10-03). Antes la cola abría y parseaba cada
 * PDF dos veces con pdf.js: una para el texto (getText de pdf-parse) y otra para
 * las posiciones (leerItemsPdf). Ahora un solo documento y UN getTextContent por
 * página entregan las dos cosas.
 *
 * El texto lo sigue armando pdf-parse (su getText, sin tocar sus parámetros) →
 * es byte a byte el de antes. Las posiciones se copian en el camino: se envuelve
 * getPage del documento ya abierto para fotografiar los items de cada
 * getTextContent ANTES de que getPageText los mute (le antepone "\t" a str).
 * Sobre MAX_PAGINAS el texto se lee entero (el flujo de antes lo necesita) pero
 * no se juntan posiciones (la grilla no lee un PDF así). Errores de clave salen
 * tal cual (el caller prueba las variantes del RUT).
 */
export async function leerPdf(data: Uint8Array, clave?: string): Promise<LecturaPdf> {
  const { PDFParse } = await import("pdf-parse");
  // COPIA: pdf.js se apropia del buffer y lo deja desprendido.
  const copia = new Uint8Array(data);
  const parser = new PDFParse(clave ? { data: copia, password: clave } : { data: copia });
  try {
    const doc = await (parser as unknown as { load(): Promise<DocPdf> }).load();
    const paginas = doc.numPages;
    const truncado = paginas > MAX_PAGINAS;
    const items: ItemPdf[] = [];
    if (!truncado) {
      const getPage = doc.getPage.bind(doc);
      doc.getPage = async (p: number) => {
        const page = await getPage(p);
        const getTextContent = page.getTextContent.bind(page);
        page.getTextContent = async (...a: unknown[]) => {
          const tc = await getTextContent(...a);
          empujarItems(tc.items, p, items);
          return tc;
        };
        return page;
      };
    }
    // getText reusa el MISMO doc (load() lo deja en caché): no vuelve a abrir.
    const texto = (await parser.getText()).text;
    return { texto, items, paginas, truncado };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Lectura sospechosa: no truncada, SIN posiciones y CON texto de verdad (fuera de
 * los separadores de página "-- N of M --" que pdf-parse pone siempre). Un PDF
 * escaneado (solo imagen) no tiene ni lo uno ni lo otro → no es sospechoso.
 */
export function sinPosicionesConTexto(l: LecturaPdf): boolean {
  if (l.truncado || l.items.length) return false;
  return /\S/.test(l.texto.replace(/^-- \d+ of \d+ --$/gm, ""));
}

/**
 * Error de ESTRUCTURA del PDF (pdf.js/pdf-parse): determinista para los mismos
 * bytes y la misma versión de pdf.js; reabrir el PDF daría el mismo error. Los
 * errores de la copia de posiciones (TypeError, etc.) NO calzan acá.
 */
export function esPdfInvalido(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "InvalidPDFException" || name === "FormatError";
}

function empujarItems(raw: { str?: string; transform?: number[]; width?: number }[], pagina: number, out: ItemPdf[]) {
  for (const it of raw) {
    if (typeof it.str !== "string" || !it.str.trim() || !it.transform) continue;
    out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, pagina });
  }
}

interface PaginaPdf {
  getTextContent(...a: unknown[]): Promise<{ items: { str?: string; transform?: number[]; width?: number }[] }>;
}
interface DocPdf {
  numPages: number;
  getPage(n: number): Promise<PaginaPdf>;
}

export function agruparLineas(items: ItemPdf[]): Linea[] {
  const porPagina = new Map<number, ItemPdf[]>();
  for (const it of items) {
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    const arr = porPagina.get(it.pagina) ?? [];
    arr.push(it);
    porPagina.set(it.pagina, arr);
  }
  const lineas: Linea[] = [];
  for (const pagina of [...porPagina.keys()].sort((a, b) => a - b)) {
    const arr = porPagina.get(pagina)!.sort((a, b) => b.y - a.y || a.x - b.x);
    let grupo: ItemPdf[] = [];
    let yRef = 0;
    const cerrar = () => {
      if (!grupo.length) return;
      grupo.sort((a, b) => a.x - b.x);
      const celdas: Celda[] = [];
      for (const it of grupo) {
        const x1 = it.x + Math.max(it.w, 0);
        const ult = celdas[celdas.length - 1];
        if (ult && it.x - ult.x1 < HUECO_MISMA_CELDA) {
          const pegado = it.x - ult.x1 < 0.5 || /\s$/.test(ult.texto) || /^\s/.test(it.str);
          ult.texto = pegado ? ult.texto + it.str : `${ult.texto} ${it.str}`;
          ult.x1 = Math.max(ult.x1, x1);
        } else {
          celdas.push({ texto: it.str, x0: it.x, x1 });
        }
      }
      for (const c of celdas) c.texto = c.texto.replace(/\s+/g, " ").trim();
      lineas.push({ pagina, y: yRef, celdas: celdas.filter((c) => c.texto) });
      grupo = [];
    };
    for (const it of arr) {
      if (grupo.length && Math.abs(yRef - it.y) > TOL_Y) cerrar();
      if (!grupo.length) yRef = it.y;
      grupo.push(it);
    }
    cerrar();
  }
  return lineas.filter((l) => l.celdas.length);
}

/** ¿La línea es un movimiento? Fecha en una de las 2 primeras celdas + algún monto en otra. */
export function esMovimiento(l: Linea): boolean {
  const iFecha = l.celdas.slice(0, 2).findIndex((c) => cellEsFecha(c.texto));
  if (iFecha < 0) return false;
  return l.celdas.some((c, i) => i !== iFecha && /\d/.test(c.texto) && leerCeldaMonto(c.texto) != null);
}

function solape(a: { x0: number; x1: number }, b: { x0: number; x1: number }): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

/** Columnas = uniones de intervalos solapados de las celdas de los movimientos. */
function columnasDe(movs: Linea[]): { x0: number; x1: number }[] {
  const ints = movs.flatMap((l) => l.celdas.map((c) => ({ x0: c.x0, x1: c.x1 }))).sort((a, b) => a.x0 - b.x0);
  const cols: { x0: number; x1: number }[] = [];
  for (const it of ints) {
    const ult = cols[cols.length - 1];
    if (ult && it.x0 < ult.x1) ult.x1 = Math.max(ult.x1, it.x1);
    else cols.push({ ...it });
  }
  return cols;
}

function columnaDe(c: Celda, cols: { x0: number; x1: number }[]): number {
  let mejor = -1;
  let mejorSolape = 0;
  cols.forEach((col, i) => {
    const s = solape(c, col);
    if (s > mejorSolape) { mejorSolape = s; mejor = i; }
  });
  if (mejor >= 0) return mejor;
  const centro = (c.x0 + c.x1) / 2;
  let dist = Infinity;
  cols.forEach((col, i) => {
    const d = Math.min(Math.abs(centro - col.x0), Math.abs(centro - col.x1));
    if (d < dist) { dist = d; mejor = i; }
  });
  return mejor;
}

function filaPorColumnas(l: Linea, cols: { x0: number; x1: number }[]): string[] {
  const fila: string[] = cols.map(() => "");
  for (const c of l.celdas) {
    const i = columnaDe(c, cols);
    fila[i] = fila[i] ? `${fila[i]} ${c.texto}` : c.texto;
  }
  return fila;
}

const soloMontos = (l: Linea) => l.celdas.every((c) => /\d/.test(c.texto) && leerCeldaMonto(c.texto) != null);
const conLetras = (l: Linea) => l.celdas.every((c) => /[a-záéíóúñ]/i.test(c.texto));

/** Monto bajo cada etiqueta (por solape o cercanía); null si dos montos caen bajo la misma. */
function alinearBajo(valores: Linea, etiquetas: Celda[]): string[] | null {
  const fila: string[] = etiquetas.map(() => "");
  for (const c of valores.celdas) {
    const i = columnaDe(c, etiquetas);
    if (i < 0 || fila[i]) return null;
    fila[i] = c.texto;
  }
  return fila;
}

const cubreA = (abajo: Linea, arriba: Linea) => abajo.celdas.every((c) => arriba.celdas.some((e) => solape(c, e) > 0));

/** Arma la grilla filas×columnas de una cartola PDF (vacía si no hay ≥2 movimientos). */
export function grillaDesdeItems(items: ItemPdf[]): Row[] {
  const lineas = agruparLineas(items);
  const movs = lineas.filter(esMovimiento);
  if (movs.length < 2) return [];
  const cols = columnasDe(movs);

  // Por página: títulos (línea con "fecha" hasta 3 arriba del 1er movimiento) y
  // cuerpo de la tabla (del 1er al último movimiento).
  const titulos = new Set<Linea>();
  const cuerpo = new Set<Linea>();
  const paginas = [...new Set(lineas.map((l) => l.pagina))];
  const porPagina = new Map<number, { lp: Linea[]; iUltimo: number }>();
  for (const p of paginas) {
    const lp = lineas.filter((l) => l.pagina === p);
    const iPrimero = lp.findIndex(esMovimiento);
    if (iPrimero < 0) continue;
    let iUltimo = iPrimero;
    lp.forEach((l, i) => { if (esMovimiento(l)) iUltimo = i; });
    for (let i = iPrimero; i <= iUltimo; i++) cuerpo.add(lp[i]);
    porPagina.set(p, { lp, iUltimo });
    for (let k = iPrimero - 1; k >= Math.max(0, iPrimero - 3); k--) {
      if (lp[k].celdas.some((c) => /^fecha\b/.test(normalizarTitulo(c.texto)))) {
        for (let i = k; i < iPrimero; i++) titulos.add(lp[i]);
        break;
      }
    }
  }
  // Columna con TÍTULO pero vacía en esta cartola (un mes sin abonos): el título
  // no se solapa con ninguna columna de los movimientos → columna propia. Si no,
  // "Abonos" caía en la columna vecina ("Cargos Abonos") y la hoja no se leía.
  for (const l of titulos) {
    for (const c of l.celdas) {
      if (!cols.some((col) => solape(c, col) > 0)) cols.push({ x0: c.x0, x1: c.x1 });
    }
  }
  cols.sort((a, b) => a.x0 - b.x0);

  // Columnas de TEXTO: la mayoría de sus celdas de movimiento traen letras (glosa).
  const deTexto = cols.map((_, i) => {
    const celdas = movs.flatMap((l) => l.celdas.filter((c) => columnaDe(c, cols) === i));
    return celdas.length > 0 && celdas.filter((c) => /[a-záéíóúñ]/i.test(c.texto)).length * 2 > celdas.length;
  });
  // Glosa partida justo al FINAL de una página: la 2ª línea queda después del
  // último movimiento (y antes del pie), así que el lector no la ve "entre
  // movimientos". Se pega acá si está más cerca que el paso entre filas y solo
  // trae texto en columnas de texto.
  const pegar = new Set<Linea>();
  const pasosDoc = paginas.flatMap((p) => {
    const ys = lineas.filter((l) => l.pagina === p && esMovimiento(l)).map((l) => l.y);
    return ys.slice(1).map((y, k) => ys[k] - y).filter((d) => d > 0);
  }).sort((a, b) => a - b);
  const pasoDoc = pasosDoc.length ? pasosDoc[Math.floor(pasosDoc.length / 2)] : 0;
  for (const { lp, iUltimo } of porPagina.values()) {
    const ys = lp.filter(esMovimiento).map((l) => l.y);
    const pasos = ys.slice(1).map((y, k) => ys[k] - y).filter((d) => d > 0).sort((a, b) => a - b);
    // Página con UN solo movimiento (la última, típicamente): el paso de todo el documento.
    const paso = pasos.length ? pasos[Math.floor(pasos.length / 2)] : pasoDoc;
    const sig = lp[iUltimo + 1];
    if (sig && paso > 0 && lp[iUltimo].y - sig.y < 0.85 * paso
      && sig.celdas.every((c) => /[a-záéíóúñ]/i.test(c.texto) && leerCeldaMonto(c.texto) == null && !cellEsFecha(c.texto)
        && cols.some((col, k) => deTexto[k] && solape(c, col) > 0 && columnaDe(c, cols) === k))) {
      pegar.add(sig);
    }
  }

  const rows: Row[] = [];
  let tituloVisto: string | null = null;
  let bloqueTitulo: string[] | null = null;
  // Fuera de la tabla: las 2 últimas líneas sueltas y su fila en `rows`.
  let previas: { l: Linea; fila: number; celdas: Celda[] }[] = [];
  for (const l of lineas) {
    if (titulos.has(l)) {
      const f = filaPorColumnas(l, cols);
      bloqueTitulo = bloqueTitulo ? bloqueTitulo.map((t, i) => (f[i] ? (t ? `${t} ${f[i]}` : f[i]) : t)) : f;
      previas = [];
      continue;
    }
    if (bloqueTitulo) {
      const clave = bloqueTitulo.map((t) => normalizarTitulo(t)).join("|");
      if (tituloVisto == null || tituloVisto !== clave) rows.push(bloqueTitulo);
      tituloVisto ??= clave;
      bloqueTitulo = null;
    }
    if (cuerpo.has(l)) {
      rows.push(filaPorColumnas(l, cols));
      previas = [];
      continue;
    }
    if (pegar.has(l)) {
      const ant = rows[rows.length - 1] as string[];
      filaPorColumnas(l, cols).forEach((t, i) => { if (t) ant[i] = ant[i] ? `${ant[i]} ${t}` : t; });
      continue;
    }
    // Línea fuera de la tabla. Si trae SOLO montos, cada uno va bajo su
    // etiqueta de la línea de arriba ("Saldo anterior" arriba → su monto abajo),
    // que es como el juez lee el resumen del banco. Si entre las etiquetas y los
    // montos hay una línea de texto que es CONTINUACIÓN de las etiquetas ("Saldo
    // promedio" / "últimos tres meses"), se pliega a su etiqueta.
    if (soloMontos(l) && previas.length) {
      const p1 = previas[previas.length - 1];
      const p2 = previas.length > 1 ? previas[previas.length - 2] : null;
      if (conLetras(p1.l) && p1.l.celdas.length >= l.celdas.length) {
        const f = alinearBajo(l, p1.celdas);
        if (f) { rows.push(f); previas = []; continue; }
      }
      if (p2 && p2.fila === rows.length - 2 && conLetras(p2.l) && conLetras(p1.l) && cubreA(p1.l, p2.l) && p2.l.celdas.length >= l.celdas.length) {
        const f = alinearBajo(l, p2.celdas);
        if (f) {
          const etiquetas = rows[p2.fila] as string[];
          for (const c of p1.l.celdas) {
            const i = columnaDe(c, p2.celdas);
            etiquetas[i] = `${etiquetas[i]} ${c.texto}`;
          }
          rows.pop();
          rows.push(f);
          previas = [];
          continue;
        }
      }
    }
    rows.push(l.celdas.map((c) => c.texto));
    previas.push({ l, fila: rows.length - 1, celdas: l.celdas });
    if (previas.length > 2) previas.shift();
  }
  if (bloqueTitulo) rows.push(bloqueTitulo);
  return rows;
}

/** La grilla como libro .xlsx con TODAS las celdas de texto (el lector decide fechas y montos). */
export function libroDesdeGrilla(rows: Row[]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v == null ? "" : String(v)))), { cellDates: false });
  // aoa_to_sheet infiere números de strings? No: los strings quedan "s". Se fuerza igual.
  for (const k of Object.keys(ws)) {
    if (k.startsWith("!")) continue;
    const cell = ws[k] as XLSX.CellObject;
    if (cell.t !== "s") { cell.v = String(cell.v ?? ""); cell.t = "s"; }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cartola PDF");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

/** Cuántos movimientos (fecha + monto) ve la grilla — para decidir si el PDF es cartola. */
export function contarMovimientos(items: ItemPdf[]): number {
  return agruparLineas(items).filter(esMovimiento).length;
}
