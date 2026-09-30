/**
 * DAÑOS ECONÓMICOS sobre una cartola ya RENDIDA (batería "false-proof survival",
 * 2026-09-30). A diferencia de mutaciones.ts (que cambia el FORMATO del banco y
 * re-genera), aquí se toca el ARCHIVO como lo tocaría una persona o un sistema:
 * borrar o duplicar un movimiento, cambiar un dígito, dar vuelta la dirección,
 * esconder filas con plata, un AutoFiltro, un subtotal, mover el rango de una
 * =SUM, cambiar solo el valor cacheado <v> (o solo la <f>), otra hoja con
 * movimientos, una celda combinada que desplaza…
 *
 * Cada daño devuelve la VERDAD MUTADA (lo que dicen las celdas después del daño)
 * y un ORÁCULO:
 *   - "lectura":   el sello solo vale si la lectura = verdad mutada Y ningún
 *                  testigo del banco (saldo, resumen, total impreso, fórmula sin
 *                  recalcular) quedó contradiciendo el daño.
 *   - "sin_sello": el archivo quedó ambiguo o contradictorio por construcción
 *                  (fila oculta con plata, filtro, otra hoja, títulos cruzados…):
 *                  cualquier sello es un sello falso.
 * Como Excel al guardar, las =SUM se RECALCULAN salvo en los daños "sin recalcular".
 *
 * Solo scripts de prueba; no lo importa código de producto.
 */
import * as XLSX from "xlsx";
import type { ItemCorpus } from "./corpus";
import { fmtMonto, type ColSpec, type FmtMonto, type Mov, type Rol, type Spec } from "./generador";

export type Oraculo = "lectura" | "sin_sello";
export interface Dano {
  tipo: string;
  buf: ArrayBuffer;
  verdad: Mov[];
  oraculo: Oraculo;
  /** Algún testigo del banco (saldo, resumen, total impreso, fórmula vieja) contradice la verdad mutada. */
  contradice: boolean;
  nota: string;
}

type Celda = XLSX.CellObject | null;
interface MovFisico { fila: number; mov: Mov }

class Libro {
  grid: Celda[][] = [];
  merges: XLSX.Range[] = [];
  props: (XLSX.RowInfo | undefined)[] = [];
  autofilter: { ref: string } | undefined;
  movs: MovFisico[] = [];
  pie: number[] = [];
  extraHojas: { nombre: string; filas: (string | number)[][] }[] = [];
  /** Recalcular las =SUM al escribir (Excel al guardar). */
  recalcular = true;
  wb: XLSX.WorkBook | null = null;
  csvSep = ";";

  constructor(public it: ItemCorpus, public spec: Spec) {
    const f = it.fisico!;
    this.movs = it.verdad.map((mov, k) => ({ fila: f.filaMov[k], mov: { ...mov } }));
    this.pie = [...f.filasPie];
    if (it.ext === "csv") {
      this.csvSep = spec.csv_sep ?? ";";
      const texto = new TextDecoder().decode(new Uint8Array(it.buf));
      this.grid = texto.replace(/\n$/, "").split("\n").map((l) => partirCsv(l, this.csvSep).map((v) => (v === "" ? null : ({ t: "s", v } as XLSX.CellObject))));
      return;
    }
    this.wb = XLSX.read(it.buf, { type: "array", cellFormula: true, cellStyles: true, cellNF: true });
    const ws = this.wb.Sheets[f.hoja];
    if (!ws || !ws["!ref"]) throw new Error(`sin hoja ${f.hoja}`);
    const rango = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 0; r <= rango.e.r; r++) {
      const fila: Celda[] = [];
      for (let c = 0; c <= rango.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        fila.push(cell ? ({ ...cell, w: undefined } as XLSX.CellObject) : null);
      }
      this.grid.push(fila);
    }
    this.merges = (ws["!merges"] ?? []).map((m) => ({ s: { ...m.s }, e: { ...m.e } }));
    this.props = [...(ws["!rows"] ?? [])];
  }

  get cols() { return this.it.fisico!.cols; }
  colSpec(rol: Rol): ColSpec | undefined { return this.spec.columnas.find((c) => c.rol === rol); }
  get ncols() { return this.grid.reduce((m, f) => Math.max(m, f.length), 0); }
  get filaTitulos(): number | null { return this.spec.titulos === false ? null : this.it.fisico!.primeraDatos - 1; }

  cel(r: number, c: number): Celda { return this.grid[r]?.[c] ?? null; }
  set(r: number, c: number, v: Celda) {
    while (this.grid.length <= r) this.grid.push([]);
    const f = this.grid[r];
    while (f.length <= c) f.push(null);
    f[c] = v;
  }

  insertarFila(at: number, fila: Celda[], oculta = false) {
    // `!rows` suele venir ralo o vacío: sin rellenar, splice lo pega al inicio.
    while (this.props.length < this.grid.length) this.props.push(undefined);
    this.grid.splice(at, 0, fila);
    this.props.splice(at, 0, oculta ? { hidden: true } : undefined);
    for (const m of this.merges) { if (m.s.r >= at) m.s.r++; if (m.e.r >= at) m.e.r++; }
    for (const x of this.movs) if (x.fila >= at) x.fila++;
    this.pie = this.pie.map((p) => (p >= at ? p + 1 : p));
    this.ajustarFormulas((r) => (r >= at + 1 ? r + 1 : r), (r) => (r >= at + 1 ? r + 1 : r));
  }

  borrarFila(at: number) {
    while (this.props.length < this.grid.length) this.props.push(undefined);
    this.grid.splice(at, 1);
    this.props.splice(at, 1);
    this.merges = this.merges.filter((m) => !(m.s.r === at && m.e.r === at));
    for (const m of this.merges) { if (m.s.r > at) m.s.r--; if (m.e.r >= at && m.e.r > m.s.r) m.e.r--; }
    this.movs = this.movs.filter((x) => x.fila !== at);
    for (const x of this.movs) if (x.fila > at) x.fila--;
    this.pie = this.pie.filter((p) => p !== at).map((p) => (p > at ? p - 1 : p));
    const d = at + 1;
    this.ajustarFormulas((r) => (r > d ? r - 1 : r), (r) => (r >= d ? r - 1 : r));
  }

  /** Corre las referencias de fila de las fórmulas (inicio y fin de rango por separado). */
  ajustarFormulas(inicio: (r: number) => number, fin: (r: number) => number) {
    for (const fila of this.grid) for (const c of fila) {
      if (!c?.f) continue;
      c.f = c.f.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g, (_, a: string, r1: string, b: string, r2: string) => `${a}${inicio(+r1)}:${b}${Math.max(inicio(+r1), fin(+r2))}`);
    }
  }

  formulas(): { r: number; c: number; col: number; desde: number; hasta: number }[] {
    const out: { r: number; c: number; col: number; desde: number; hasta: number }[] = [];
    this.grid.forEach((fila, r) => fila.forEach((c, j) => {
      const m = c?.f?.match(/^\s*SUMA?\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)\s*$/i);
      if (m) out.push({ r, c: j, col: XLSX.utils.decode_col(m[1]), desde: +m[2] - 1, hasta: +m[4] - 1 });
    }));
    return out;
  }

  recalc() {
    for (const f of this.formulas()) {
      let s = 0;
      for (let r = f.desde; r <= f.hasta; r++) { const c = this.cel(r, f.col); if (c && c.t === "n" && typeof c.v === "number") s += c.v; }
      const cell = this.cel(f.r, f.c)!;
      cell.v = s; cell.t = "n";
    }
  }

  escribir(): ArrayBuffer {
    if (this.it.ext === "csv") {
      const esc = (v: string) => (v.includes(this.csvSep) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
      const lineas = this.grid.map((f) => f.map((c) => (c == null || c.v == null ? "" : esc(String(c.v)))).join(this.csvSep).replace(new RegExp(`${this.csvSep === ";" ? ";" : ","}+$`), ""));
      const u = new TextEncoder().encode(lineas.join("\n") + "\n");
      return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
    }
    if (this.recalcular) this.recalc();
    const wb = XLSX.utils.book_new();
    const hoja = this.it.fisico!.hoja;
    for (const n of this.wb!.SheetNames) {
      if (n !== hoja) { XLSX.utils.book_append_sheet(wb, this.wb!.Sheets[n], n); continue; }
      const ws: XLSX.WorkSheet = {};
      let maxC = 0;
      this.grid.forEach((fila, r) => fila.forEach((c, j) => {
        if (!c || (c.v == null && !c.f)) return;
        const cell: XLSX.CellObject = { t: c.t, v: c.v } as XLSX.CellObject;
        if (c.z) cell.z = c.z;
        if (c.f) cell.f = c.f;
        ws[XLSX.utils.encode_cell({ r, c: j })] = cell;
        maxC = Math.max(maxC, j);
      }));
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, this.grid.length - 1), c: Math.max(maxC, this.ncols - 1) } });
      if (this.merges.length) ws["!merges"] = this.merges;
      if (this.props.some((p) => p?.hidden)) ws["!rows"] = this.props.map((p) => p ?? {});
      if (this.autofilter) ws["!autofilter"] = this.autofilter;
      XLSX.utils.book_append_sheet(wb, ws, n);
    }
    for (const h of this.extraHojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h.filas), h.nombre);
    return XLSX.write(wb, { type: "array", bookType: this.it.ext === "xls" ? "biff8" : "xlsx" }) as ArrayBuffer;
  }

  // --- plata ---------------------------------------------------------------

  esCsv() { return this.it.ext === "csv"; }
  celdaMonto(rol: Rol, n: number): Celda {
    const cs = this.colSpec(rol);
    if (cs?.celda === "s") return { t: "s", v: fmtMonto(n, (cs.fmt as FmtMonto) ?? "cl") };
    if (this.esCsv()) return { t: "s", v: String(n) };
    return { t: "n", v: n, ...(cs?.z ? { z: cs.z } : {}) } as XLSX.CellObject;
  }
  celdaVacia(rol: Rol): Celda {
    const cs = this.colSpec(rol);
    switch (cs?.vacio ?? "vacia") {
      case "vacia": return null;
      case "cero": return cs?.celda === "s" || this.esCsv() ? { t: "s", v: "0" } : ({ t: "n", v: 0, ...(cs?.z ? { z: cs.z } : {}) } as XLSX.CellObject);
      case "cero_txt": return { t: "s", v: "$0" };
      case "guion": return { t: "s", v: "-" };
    }
  }
  layout(): "two_cols" | "monto_signo" | "flag" | "monto" | null {
    const c = this.cols;
    if (c.cargo != null && c.abono != null) return "two_cols";
    if (c.monto_signo != null) return "monto_signo";
    if (c.monto != null && c.flag != null) return "flag";
    if (c.monto != null) return "monto";
    return null;
  }
  /** Escribe el movimiento (monto y dirección) en su fila física. */
  escribirMov(fila: number, monto: number, tipo: Mov["tipo"]) {
    while (this.grid.length <= fila) this.grid.push([]);
    this.escribirMovEn(this.grid[fila], monto, tipo);
  }
  escribirMovEn(f: Celda[], monto: number, tipo: Mov["tipo"]) {
    const c = this.cols;
    const put = (j: number, v: Celda) => { while (f.length <= j) f.push(null); f[j] = v; };
    switch (this.layout()) {
      case "two_cols":
        put(c.cargo!, tipo === "SALIDA" ? this.celdaMonto("cargo", monto) : this.celdaVacia("cargo"));
        put(c.abono!, tipo === "ENTRADA" ? this.celdaMonto("abono", monto) : this.celdaVacia("abono"));
        break;
      case "monto_signo": put(c.monto_signo!, this.celdaMonto("monto_signo", tipo === "ENTRADA" ? monto : -monto)); break;
      case "flag": {
        const fl = this.colSpec("flag")?.flag ?? { entrada: "A", salida: "C" };
        put(c.monto!, this.celdaMonto("monto", monto));
        put(c.flag!, { t: "s", v: tipo === "ENTRADA" ? fl.entrada : fl.salida });
        break;
      }
      case "monto": put(c.monto!, this.celdaMonto("monto", monto)); break;
    }
  }
  saldoDe(fila: number): number | null {
    const col = this.cols.saldo;
    if (col == null) return null;
    const c = this.cel(fila, col);
    if (!c || c.v == null || c.v === "") return null;
    if (typeof c.v === "number") return c.v;
    const t = String(c.v).replace(/[$\s]/g, "");
    const neg = t.startsWith("-");
    const d = t.replace(/[^\d]/g, "");
    if (!d) return null;
    // Formatos del generador: cl (miles con punto), cl_dec (",00"), en ("," miles), plano.
    const sinDec = /[.,]\d{2}$/.test(t) && !/^-?\d{1,3}([.,]\d{3})+$/.test(t) ? d.slice(0, -2) : d;
    return (neg ? -1 : 1) * Number(sinDec);
  }
  setSaldo(fila: number, n: number) { if (this.cols.saldo != null) this.set(fila, this.cols.saldo, this.celdaMonto("saldo", n)); }
  setSaldoEn(f: Celda[], n: number) { if (this.cols.saldo != null) { while (f.length <= this.cols.saldo) f.push(null); f[this.cols.saldo] = this.celdaMonto("saldo", n); } }
  verdad(): Mov[] { return [...this.movs].sort((a, b) => a.fila - b.fila).map((x) => x.mov); }
}

function partirCsv(l: string, sep: string): string[] {
  const out: string[] = [];
  let cur = ""; let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Testigos del banco en el archivo ORIGINAL (qué contradiría un daño económico)

/**
 * El resumen impreso cuenta como testigo solo si trae un TOTAL o un SALDO FINAL
 * con etiqueta inequívoca. "Saldo disponible" NO (en Chile incluye retenciones o
 * la línea de crédito: no es el saldo contable, decisión documentada).
 */
const RE_TESTIGO_RESUMEN = /^(total(es)?\b.*\b(cargos?|abonos?|d[eé]bitos?|cr[eé]ditos?|egresos?|ingresos?|dep[oó]sitos?|giros?|cheques?)\b|saldo\b.*\bfinal\b|saldo\s+contable\s+al\b)/i;
function resumenReconocible(spec: Spec): boolean {
  const textos: string[] = [];
  const junta = (x: unknown) => { if (Array.isArray(x)) x.forEach(junta); else if (typeof x === "string") textos.push(x); };
  junta([spec.arriba, spec.abajo, (spec.hojas_extra ?? []).map((h) => h.filas), (spec.pie ?? []).map((p) => [p.etiqueta, Object.values(p.celdas ?? {})])]);
  return textos.some((t) => RE_TESTIGO_RESUMEN.test(t.trim()));
}

export function testigos(it: ItemCorpus, spec: Spec): { saldo: boolean; resumen: boolean; totalValor: boolean; formula: boolean } {
  const pie = spec.pie ?? [];
  return {
    saldo: it.meta.tieneSaldo,
    resumen: resumenReconocible(spec),
    totalValor: pie.some((p) => p.tipo === "fila_total" && !p.formula),
    formula: pie.some((p) => p.tipo === "sum" || (p.tipo === "fila_total" && !!p.formula)),
  };
}

// ---------------------------------------------------------------------------
// Catálogo

type R = () => number;
const entre = (r: R, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const uno = <T>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)];

type Aplicar = (L: Libro, r: R) => { oraculo: Oraculo; economico: boolean; nota: string; recalc?: boolean; forzarContradice?: boolean } | null;

function cambiarDigito(n: number, r: R): number {
  const s = String(n);
  for (let t = 0; t < 20; t++) {
    const i = entre(r, 0, s.length - 1);
    const d = entre(r, 0, 9);
    if (String(d) === s[i] || (i === 0 && d === 0)) continue;
    const x = Number(s.slice(0, i) + d + s.slice(i + 1));
    if (x > 0 && x !== n) return x;
  }
  return n + 9;
}

function copiarFila(L: Libro, fila: number): Celda[] { return (L.grid[fila] ?? []).map((c) => (c ? ({ ...c } as XLSX.CellObject) : null)); }
/** Movimiento cronológicamente más viejo (la "primera fila" de la cartola). */
function primeraCrono(L: Libro): MovFisico {
  const desc = (L.spec.orden ?? "asc") === "desc";
  return [...L.movs].sort((a, b) => (desc ? b.fila - a.fila : a.fila - b.fila))[0];
}
function filaNueva(L: Libro, base: number, glosa: string, monto: number, tipo: Mov["tipo"], saldo: number | null): { celdas: Celda[]; mov: Mov } {
  const f: Celda[] = Array.from({ length: L.ncols }, () => null);
  const c = L.cols;
  const orig = L.grid[base] ?? [];
  for (const rol of ["fecha", "fecha2", "cuenta_fija", "alias_fijo", "ncartola_fijo", "sucursal"] as Rol[]) if (c[rol] != null) f[c[rol]!] = orig[c[rol]!] ? ({ ...orig[c[rol]!] } as XLSX.CellObject) : null;
  if (c.glosa != null) f[c.glosa] = { t: "s", v: glosa };
  L.escribirMovEn(f, monto, tipo);
  if (saldo != null) L.setSaldoEn(f, saldo);
  const mov = L.movs.find((x) => x.fila === base)?.mov;
  return { celdas: f, mov: { fecha: mov?.fecha ?? "", monto, tipo, glosa } };
}

export const DANOS: { id: string; aplicar: Aplicar }[] = [
  { id: "borrar_mov", aplicar: (L, r) => {
    const x = uno(r, L.movs);
    const desc = (L.spec.orden ?? "asc") === "desc";
    const ultima = [...L.movs].sort((a, b) => (desc ? a.fila - b.fila : b.fila - a.fila))[0] === x;
    L.borrarFila(x.fila);
    // Borrar el ÚLTIMO movimiento (cola truncada) no lo contradice el saldo
    // corrido: solo un saldo final o un total impreso lo verían.
    const t = testigos(L.it, L.spec);
    return { oraculo: "lectura", economico: !ultima || t.resumen || t.totalValor, nota: `borra fila ${x.fila + 1}${ultima ? " (la última)" : ""}` };
  } },
  { id: "duplicar_mov", aplicar: (L, r) => {
    const x = uno(r, L.movs); const copia = copiarFila(L, x.fila);
    L.insertarFila(x.fila + 1, copia); L.movs.push({ fila: x.fila + 1, mov: { ...x.mov } });
    return { oraculo: "lectura", economico: true, nota: `duplica fila ${x.fila + 1}` };
  } },
  { id: "cambiar_digito", aplicar: (L, r) => {
    const x = uno(r, L.movs); const n = cambiarDigito(x.mov.monto, r);
    L.escribirMov(x.fila, n, x.mov.tipo); const antes = x.mov.monto; x.mov.monto = n;
    return { oraculo: "lectura", economico: true, nota: `fila ${x.fila + 1}: ${antes} → ${n}` };
  } },
  { id: "mas_un_peso", aplicar: (L, r) => {
    const x = uno(r, L.movs); L.escribirMov(x.fila, x.mov.monto + 1, x.mov.tipo); x.mov.monto += 1;
    return { oraculo: "lectura", economico: true, nota: `fila ${x.fila + 1}: +$1` };
  } },
  { id: "menos_un_peso", aplicar: (L, r) => {
    const x = uno(r, L.movs.filter((m) => m.mov.monto > 1)); if (!x) return null;
    L.escribirMov(x.fila, x.mov.monto - 1, x.mov.tipo); x.mov.monto -= 1;
    return { oraculo: "lectura", economico: true, nota: `fila ${x.fila + 1}: −$1` };
  } },
  { id: "invertir_direccion", aplicar: (L, r) => {
    if (L.layout() === "monto" || !L.layout()) return null;
    const x = uno(r, L.movs); const t = x.mov.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA";
    L.escribirMov(x.fila, x.mov.monto, t); x.mov.tipo = t;
    return { oraculo: "lectura", economico: true, nota: `fila ${x.fila + 1} → ${t}` };
  } },
  { id: "cruzar_datos_cargo_abono", aplicar: (L) => {
    if (L.layout() !== "two_cols") return null;
    // Sin títulos que digan la dirección, las columnas no significan nada por sí
    // solas: el saldo manda y cruzar los datos no cambia la verdad.
    if (!titulosDicenDireccion(L)) {
      for (const x of L.movs) L.escribirMov(x.fila, x.mov.monto, x.mov.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA");
      return { oraculo: "lectura", economico: false, nota: "datos cruzados en columnas sin títulos de dirección (el saldo manda)" };
    }
    for (const x of L.movs) { const t = x.mov.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA"; L.escribirMov(x.fila, x.mov.monto, t); x.mov.tipo = t; }
    return { oraculo: "lectura", economico: true, nota: "datos de cargo↔abono intercambiados (títulos quedan)" };
  } },
  { id: "cruzar_titulos_cargo_abono", aplicar: (L) => {
    if (L.layout() !== "two_cols" || L.filaTitulos == null || !titulosDicenDireccion(L)) return null;
    const h = L.filaTitulos; const c = L.cols;
    const a = L.cel(h, c.cargo!), b = L.cel(h, c.abono!);
    if (!a || !b) return null;
    L.set(h, c.cargo!, b); L.set(h, c.abono!, a);
    const t = testigos(L.it, L.spec);
    if (t.saldo || t.resumen) return { oraculo: "sin_sello", economico: false, nota: "títulos cruzados; el saldo/resumen dice lo contrario" };
    // Sin saldo ni resumen, lo único que dice la dirección son los títulos.
    for (const x of L.movs) x.mov.tipo = x.mov.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA";
    return { oraculo: "lectura", economico: false, nota: "títulos cruzados (sin saldo ni resumen: mandan los títulos)" };
  } },
  { id: "oculta_un_peso", aplicar: (L, r) => {
    if (L.esCsv() || L.it.ext === "xls" || !L.layout()) return null;
    const x = uno(r, L.movs); const n = filaNueva(L, x.fila, "AJUSTE", 1, L.layout() === "monto" ? "ENTRADA" : uno(r, ["ENTRADA", "SALIDA"] as const), null);
    L.insertarFila(x.fila + 1, n.celdas, true); L.movs.push({ fila: x.fila + 1, mov: n.mov });
    return { oraculo: "sin_sello", economico: true, nota: `fila oculta $1 en ${x.fila + 2}` };
  } },
  { id: "oculta_grande", aplicar: (L, r) => {
    if (L.esCsv() || L.it.ext === "xls" || !L.layout()) return null;
    const x = uno(r, L.movs); const n = filaNueva(L, x.fila, "TRANSFERENCIA", entre(r, 1_000_000, 9_000_000), L.layout() === "monto" ? "ENTRADA" : uno(r, ["ENTRADA", "SALIDA"] as const), null);
    L.insertarFila(x.fila + 1, n.celdas, true); L.movs.push({ fila: x.fila + 1, mov: n.mov });
    return { oraculo: "sin_sello", economico: true, nota: `fila oculta grande en ${x.fila + 2}` };
  } },
  { id: "oculta_par_que_cuadra", aplicar: (L, r) => {
    // Par +X / −X oculto con saldos coherentes: la ecuación del saldo CIERRA.
    if (L.esCsv() || L.it.ext === "xls" || L.cols.saldo == null || !["two_cols", "monto_signo", "flag"].includes(L.layout() ?? "")) return null;
    const desc = (L.spec.orden ?? "asc") === "desc";
    const orden = [...L.movs].sort((a, b) => a.fila - b.fila);
    const cands = orden.slice(0, -1).map((x, i) => [x, orden[i + 1]] as const).filter(([a, b]) => b.fila === a.fila + 1);
    if (!cands.length) return null;
    const [a, b] = uno(r, cands);
    const previa = desc ? b : a; // la más vieja de las dos
    const s = L.saldoDe(previa.fila); if (s == null) return null;
    const X = entre(r, 50_000, 3_000_000);
    const p1 = filaNueva(L, previa.fila, "TRANSF A TERCERO", X, "SALIDA", s - X);
    const p2 = filaNueva(L, previa.fila, "REVERSO TRANSF A TERCERO", X, "ENTRADA", s);
    const fisicas = desc ? [p2, p1] : [p1, p2];
    L.insertarFila(a.fila + 1, fisicas[0].celdas, true); L.movs.push({ fila: a.fila + 1, mov: fisicas[0].mov });
    L.insertarFila(a.fila + 2, fisicas[1].celdas, true); L.movs.push({ fila: a.fila + 2, mov: fisicas[1].mov });
    return { oraculo: "sin_sello", economico: true, nota: `par oculto ±${X} en ${a.fila + 2}-${a.fila + 3}` };
  } },
  { id: "autofiltro", aplicar: (L, r) => {
    if (L.esCsv() || L.it.ext === "xls") return null;
    const orden = [...L.movs].sort((a, b) => a.fila - b.fila);
    const k = Math.min(orden.length - 1, entre(r, 1, 3));
    const ocultas = new Set<number>();
    while (ocultas.size < k) ocultas.add(uno(r, orden).fila);
    for (const f of ocultas) L.props[f] = { hidden: true };
    const h = L.filaTitulos ?? orden[0].fila - 1;
    L.autofilter = { ref: XLSX.utils.encode_range({ s: { r: Math.max(0, h), c: 0 }, e: { r: orden[orden.length - 1].fila, c: L.ncols - 1 } }) };
    return { oraculo: "sin_sello", economico: false, nota: `AutoFiltro oculta ${k} movimiento(s)` };
  } },
  { id: "primera_fila", aplicar: (L, r) => {
    const x = primeraCrono(L); const n = cambiarDigito(x.mov.monto, r);
    L.escribirMov(x.fila, n, x.mov.tipo); x.mov.monto = n;
    return { oraculo: "lectura", economico: true, nota: `primera fila (crono) → ${n}` };
  } },
  { id: "subtotal_con_glosa", aplicar: (L, r) => subtotal(L, r, "Total del día") },
  { id: "subtotal_mudo", aplicar: (L, r) => subtotal(L, r, uno(r, ["PAGO PROVEEDOR DELTA SPA", "TRANSF DE COMERCIAL OMEGA LTDA", "DEPOSITO EFECTIVO SUC CENTRO"])) },
  { id: "rango_sum_corto", aplicar: (L) => {
    const fs = L.formulas(); if (!fs.length) return null;
    for (const f of fs) { const c = L.cel(f.r, f.c)!; c.f = c.f!.replace(/(\d+)\)\s*$/, (_, n: string) => `${Number(n) - 1})`); }
    return { oraculo: "lectura", economico: false, nota: "=SUM sin la última fila (recalculada)" };
  } },
  { id: "rango_sum_corrido", aplicar: (L) => {
    const fs = L.formulas(); if (!fs.length) return null;
    for (const f of fs) { const c = L.cel(f.r, f.c)!; c.f = c.f!.replace(/^(\s*SUMA?\([A-Z]+)(\d+):([A-Z]+)(\d+)\)/i, (_, a: string, r1: string, b: string, r2: string) => `${a}${Number(r1) + 1}:${b}${Number(r2) + 1})`); }
    return { oraculo: "lectura", economico: false, nota: "=SUM corrida una fila hacia abajo (recalculada)" };
  } },
  { id: "solo_v_cacheado", aplicar: (L, r) => {
    const fs = L.formulas(); if (!fs.length) return null;
    L.recalc(); L.recalcular = false;
    const f = uno(r, fs); const c = L.cel(f.r, f.c)!; const d = uno(r, [1, -1, entre(r, 2, 50_000), -entre(r, 2, 50_000)]);
    c.v = (c.v as number) + d;
    return { oraculo: "lectura", economico: false, nota: `<v> de la =SUM ${d > 0 ? "+" : ""}${d} (fórmula igual)` };
  } },
  { id: "solo_f", aplicar: (L) => {
    const fs = L.formulas(); if (!fs.length) return null;
    L.recalc(); L.recalcular = false;
    for (const f of fs) { const c = L.cel(f.r, f.c)!; c.f = c.f!.replace(/(\d+)\)\s*$/, (_, n: string) => `${Number(n) - 1})`); }
    return { oraculo: "lectura", economico: false, nota: "<f> de la =SUM acortada; <v> queda el viejo" };
  } },
  { id: "monto_sin_recalcular", aplicar: (L, r) => {
    const fs = L.formulas(); if (!fs.length) return null;
    L.recalc(); L.recalcular = false;
    const x = uno(r, L.movs); const n = cambiarDigito(x.mov.monto, r);
    L.escribirMov(x.fila, n, x.mov.tipo); x.mov.monto = n;
    return { oraculo: "lectura", economico: true, nota: `fila ${x.fila + 1} → ${n}; =SUM con <v> viejo`, forzarContradice: true };
  } },
  { id: "segunda_hoja", aplicar: (L, r) => {
    if (L.esCsv()) return null;
    const filas: (string | number)[][] = [["Fecha", "Descripción", "Monto"]];
    for (let i = 0; i < 6; i++) filas.push([`${String(entre(r, 1, 28)).padStart(2, "0")}/09/2026`, "MOVIMIENTO OTRA CUENTA", entre(r, 5_000, 900_000)]);
    L.extraHojas.push({ nombre: "Movimientos 2", filas });
    return { oraculo: "sin_sello", economico: false, nota: "otra hoja con 6 movimientos" };
  } },
  { id: "fuera_de_rango", aplicar: (L, r) => {
    if (!L.pie.length && !(L.spec.abajo ?? []).length) return null;
    if (!L.layout()) return null;
    const ultima = Math.max(...L.pie, ...L.movs.map((x) => x.fila));
    const base = [...L.movs].sort((a, b) => b.fila - a.fila)[0].fila;
    const n = filaNueva(L, base, "PAGO FUERA DEL BLOQUE", entre(r, 10_000, 900_000), L.layout() === "monto" ? "ENTRADA" : uno(r, ["ENTRADA", "SALIDA"] as const), null);
    const at = Math.min(L.grid.length, ultima + 2);
    L.insertarFila(at, n.celdas); L.movs.push({ fila: at, mov: n.mov });
    return { oraculo: "sin_sello", economico: true, nota: `movimiento bajo el total (fila ${at + 1})` };
  } },
  { id: "plata_como_texto", aplicar: (L, r) => {
    if (L.esCsv()) return null;
    const x = uno(r, L.movs); const col = montoCol(L, x);
    const c = col == null ? null : L.cel(x.fila, col);
    if (!c || c.t !== "n") return null;
    L.set(x.fila, col!, { t: "s", v: fmtMonto(c.v as number, "cl") });
    return { oraculo: "lectura", economico: false, nota: `monto de fila ${x.fila + 1} como texto (SUM lo ignora)` };
  } },
  { id: "combinada_desplaza", aplicar: (L, r) => {
    if (L.esCsv()) return null;
    const x = uno(r, L.movs); const col = montoCol(L, x);
    if (col == null || col < 1) return null;
    const v = L.cel(x.fila, col);
    // La celda de la izquierda se combina con la de plata y el monto se corre a la derecha.
    L.set(x.fila, col + 1, v); L.set(x.fila, col, null);
    L.merges.push({ s: { r: x.fila, c: col - 1 }, e: { r: x.fila, c: col } });
    L.movs = L.movs.filter((m) => m !== x);
    return { oraculo: "sin_sello", economico: true, nota: `celda combinada corre el monto de fila ${x.fila + 1} a la columna ${col + 2}` };
  } },
  { id: "fecha_corrida", aplicar: (L, r) => {
    const colF = L.cols.fecha; if (colF == null) return null;
    const x = uno(r, L.movs); const c = L.cel(x.fila, colF); if (!c) return null;
    const [y, m, d] = x.mov.fecha.split("-").map(Number);
    const d2 = d < 28 ? d + 1 : d - 1;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
    if (c.t === "n") c.v = (c.v as number) + (d2 - d);
    else {
      const s = String(c.v);
      const cs = L.colSpec("fecha");
      if (cs?.fmt === "mm/dd/yyyy" || L.spec.extras?.fecha_mm_dd) return null;
      let t: string | null = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) t = s.replace(/^(\d{4}-\d{2}-)\d{2}/, `$1${String(d2).padStart(2, "0")}`);
      else if (/^20\d{6}$/.test(s)) t = s.slice(0, 6) + String(d2).padStart(2, "0");
      else if (/^\d{1,2}[/.\-]/.test(s)) t = s.replace(/^(\d{1,2})/, (q) => (q.length === 2 ? String(d2).padStart(2, "0") : String(d2)));
      if (!t) return null;
      c.v = t;
    }
    x.mov.fecha = iso;
    // El saldo y los totales no ven las fechas: ningún testigo la contradice.
    return { oraculo: "lectura", economico: false, nota: `fecha de fila ${x.fila + 1} → ${iso}` };
  } },
];

const RE_SAL = /cargo|egreso|debe\b|d[eé]bito|debit|giro|salida|cheque|withdraw|\(\s*-\s*\)/i;
const RE_ENT = /abono|ingreso|haber|cr[eé]dito|credit|dep[oó]sito|deposit|entrada|\(\s*\+\s*\)/i;
/** ¿Los títulos de cargo y abono dicen su dirección (en castellano o inglés)? */
function titulosDicenDireccion(L: Libro): boolean {
  const h = L.filaTitulos;
  if (h == null) return false;
  const tc = String(L.cel(h, L.cols.cargo!)?.v ?? ""), ta = String(L.cel(h, L.cols.abono!)?.v ?? "");
  return RE_SAL.test(tc) && !RE_ENT.test(tc) && RE_ENT.test(ta) && !RE_SAL.test(ta);
}

function montoCol(L: Libro, x: MovFisico): number | undefined {
  const c = L.cols;
  switch (L.layout()) {
    case "two_cols": return x.mov.tipo === "SALIDA" ? c.cargo : c.abono;
    case "monto_signo": return c.monto_signo;
    default: return c.monto;
  }
}

function subtotal(L: Libro, r: R, glosa: string): ReturnType<Aplicar> {
  if (L.layout() !== "two_cols" && L.layout() !== "monto") return null;
  if (L.cols.glosa == null) return null;
  const porDia = new Map<string, MovFisico[]>();
  for (const x of L.movs) porDia.set(x.mov.fecha, [...(porDia.get(x.mov.fecha) ?? []), x]);
  const dias = [...porDia.values()].filter((xs) => xs.length >= 2);
  if (!dias.length) return null;
  const xs = uno(r, dias).sort((a, b) => a.fila - b.fila);
  const ultima = xs[xs.length - 1];
  if (xs.some((x, i) => i > 0 && x.fila !== xs[i - 1].fila + 1)) return null;
  const f: Celda[] = Array.from({ length: L.ncols }, () => null);
  const orig = L.grid[ultima.fila] ?? [];
  if (L.cols.fecha != null) f[L.cols.fecha] = orig[L.cols.fecha] ? ({ ...orig[L.cols.fecha] } as XLSX.CellObject) : null;
  f[L.cols.glosa] = { t: "s", v: glosa };
  const e = xs.filter((x) => x.mov.tipo === "ENTRADA").reduce((s, x) => s + x.mov.monto, 0);
  const s = xs.filter((x) => x.mov.tipo === "SALIDA").reduce((q, x) => q + x.mov.monto, 0);
  if (L.layout() === "two_cols") {
    f[L.cols.cargo!] = s ? L.celdaMonto("cargo", s) : L.celdaVacia("cargo");
    f[L.cols.abono!] = e ? L.celdaMonto("abono", e) : L.celdaVacia("abono");
  } else f[L.cols.monto!] = L.celdaMonto("monto", e + s);
  // El saldo del día (el del último movimiento del orden cronológico) queda quieto.
  const desc = (L.spec.orden ?? "asc") === "desc";
  const cierre = desc ? xs[0] : ultima;
  const sd = L.saldoDe(cierre.fila);
  if (sd != null) L.setSaldoEn(f, sd);
  // Asc: debajo del último del día. Desc: arriba del más nuevo (primera fila física del día).
  L.insertarFila(desc ? xs[0].fila : ultima.fila + 1, f);
  const t = testigos(L.it, L.spec);
  const mudoSinSaldo = !/^total/i.test(glosa) && !t.saldo;
  return { oraculo: mudoSinSaldo ? "sin_sello" : "lectura", economico: false, nota: `subtotal "${glosa}" del ${xs[0].mov.fecha}` };
}

/** Aplica el daño `tipo` (semilla) a la cartola. null = no aplica a este formato. */
export function danar(it: ItemCorpus, tipo: string, r: R): Dano | null {
  if (!it.fisico || !it.spec || it.fisico.filaMov.some((f) => f < 0) || !it.verdad.length) return null;
  const d = DANOS.find((x) => x.id === tipo);
  if (!d) throw new Error(`daño desconocido ${tipo}`);
  let L: Libro;
  try { L = new Libro(it, it.spec); } catch { return null; }
  const res = d.aplicar(L, r);
  if (!res) return null;
  const t = testigos(it, it.spec);
  // Con =SUM recalculada (Excel al guardar), la fórmula nunca contradice un daño.
  const contradice = res.forzarContradice === true || (res.economico && (t.saldo || t.resumen || t.totalValor));
  return { tipo, buf: L.escribir(), verdad: L.verdad(), oraculo: res.oraculo, contradice, nota: res.nota };
}

export { Libro };
