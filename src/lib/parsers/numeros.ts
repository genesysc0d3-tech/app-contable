/**
 * LECTURA DE MONTOS — formato decidido POR COLUMNA, nunca por celda suelta.
 *
 * Idea copiada de GnuCash (qif-imp/qif-file.scm:982-1047, `all-formats-equivalent?`
 * :1088): cada celda dice qué formatos la aceptan; la columna se queda con la
 * INTERSECCIÓN. Si quedan dos formatos, solo es ambigua si las lecturas dan
 * valores DISTINTOS ("5000" vale lo mismo en cualquiera). Si no queda ninguno, la
 * columna es inconsistente y NO se adivina: la celda dudosa va al censo como
 * `monto_ambiguo` (docs/investigacion-lectores-multibanco-2026-09-30.md §2.4).
 *
 * Formatos (montos CLP, enteros; la fracción se TRUNCA como siempre):
 *   chilean  "1.234.567" · "1.234,56" · "1234,5"   (punto de miles, coma decimal)
 *   generic  "1,234,567" · "1,234.56" · "1234.5"   (coma de miles, punto decimal)
 * Un decimal de moneda tiene 1-2 dígitos: por eso "250,000" NO es chileno (serían
 * 3 decimales) y "250.000" NO es inglés. Así casi toda celda con separador tiene
 * UNA sola lectura; la duda real aparece cuando una columna mezcla las dos formas.
 *
 * Signo: "-1.500", "$ -418.370", "-$ 418.370", "418.370-", "(418.370)" y el "−"
 * tipográfico son negativos (antes el signo después del "$" se perdía).
 */

export type FormatoNumero = "chilean" | "generic";

export interface LecturaCelda {
  /** Valor si el formato es chileno (null = la celda no calza con ese formato). */
  chilean: number | null;
  /** Valor si el formato es inglés/genérico. */
  generic: number | null;
}

const RE_CHILE = [/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/, /^\d+(,\d{1,2})?$/];
const RE_GENERIC = [/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/, /^\d+(\.\d{1,2})?$/];

function parteEntera(body: string, decimal: "," | "."): number {
  const ent = body.split(decimal)[0].replace(/[^\d]/g, "");
  return ent ? parseInt(ent, 10) : NaN;
}

/**
 * Lee una celda de monto SIN decidir el formato. null = no es un monto limpio
 * (texto, RUT, hora, fecha, "N° 123"…). Los números tipados de Excel valen lo
 * mismo en cualquier formato.
 */
export function leerCeldaMonto(v: unknown): LecturaCelda | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const n = Math.round(v);
    return { chilean: n, generic: n };
  }
  let s = String(v).trim().replace(/[ \s]+/g, "").replace(/−/g, "-");
  if (!s) return null;
  s = s.replace(/^(clp|\$)+/i, "").replace(/(clp|\$)+$/i, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(clp|\$)+/i, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  s = s.replace(/^(clp|\$)+/i, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (!s || !/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const firmar = (n: number) => (Number.isFinite(n) ? (neg && n !== 0 ? -n : n) : null);
  const chilean = RE_CHILE.some((re) => re.test(s)) ? firmar(parteEntera(s, ",")) : null;
  const generic = RE_GENERIC.some((re) => re.test(s)) ? firmar(parteEntera(s, ".")) : null;
  if (chilean == null && generic == null) return null;
  return { chilean, generic };
}

/** ¿La celda vale lo mismo en los dos formatos? (números tipados, "5000", "12"). */
export function celdaNeutral(l: LecturaCelda): boolean {
  return l.chilean != null && l.generic != null && l.chilean === l.generic;
}

/**
 * Lectura de UNA celda sin contexto de columna (compatibilidad con
 * parseChileanNumber): si tiene una sola lectura posible, esa; si tiene dos
 * distintas (no pasa con los formatos de arriba), gana la chilena.
 */
export function valorCeldaSuelta(l: LecturaCelda): number {
  return (l.chilean ?? l.generic)!;
}

export type DecisionColumna =
  | { formato: FormatoNumero | "neutral" }
  | { formato: "ambiguo"; soloChile: number; soloGeneric: number };

/**
 * Formato de una columna mirando TODAS sus celdas (intersección GnuCash).
 * "neutral" = ninguna celda distingue (da igual el formato).
 */
export function decidirFormatoColumna(celdas: unknown[]): DecisionColumna {
  let soloChile = 0;
  let soloGeneric = 0;
  for (const v of celdas) {
    const l = leerCeldaMonto(v);
    if (!l || celdaNeutral(l)) continue;
    if (l.chilean != null && l.generic == null) soloChile++;
    else if (l.generic != null && l.chilean == null) soloGeneric++;
    // Dos lecturas distintas en la MISMA celda no existe con estos formatos; si
    // apareciera, cuenta como duda en ambos lados.
    else { soloChile++; soloGeneric++; }
  }
  if (soloChile > 0 && soloGeneric > 0) return { formato: "ambiguo", soloChile, soloGeneric };
  if (soloChile > 0) return { formato: "chilean" };
  if (soloGeneric > 0) return { formato: "generic" };
  return { formato: "neutral" };
}

export interface MontoLeido {
  valor: number;
  /** La celda trae plata pero su columna no permite saber cuánto: no se adivina. */
  ambiguo: boolean;
  /** Solo si ambiguo: una lectura posible, SOLO para mostrarla en el censo. */
  referencia?: number;
}

/**
 * Lector de montos de una hoja: decide el formato de cada columna UNA vez (con
 * todas las filas de la región de datos) y después lee celda por celda.
 */
export class LectorMontos {
  private formatos = new Map<number, DecisionColumna>();

  constructor(
    private rows: unknown[][],
    private desde: number,
    /** Formato declarado en el AdapterConfig: solo desempata columnas neutrales. */
    private declarado: FormatoNumero = "chilean",
  ) {}

  formatoDe(col: number): DecisionColumna {
    let d = this.formatos.get(col);
    if (!d) {
      const celdas: unknown[] = [];
      for (let i = this.desde; i < this.rows.length; i++) celdas.push(this.rows[i]?.[col]);
      d = decidirFormatoColumna(celdas);
      this.formatos.set(col, d);
    }
    return d;
  }

  leer(row: unknown[] | undefined, col: number | undefined): MontoLeido {
    if (col == null || col < 0 || !row) return { valor: 0, ambiguo: false };
    const v = row[col];
    const l = leerCeldaMonto(v);
    if (!l) {
      // Texto que no es un monto limpio: misma lectura laxa de siempre (dígitos
      // de la parte entera). No cambia nada para las celdas que sí son montos.
      return { valor: lecturaLaxa(v), ambiguo: false };
    }
    if (celdaNeutral(l)) return { valor: l.chilean!, ambiguo: false };
    const d = this.formatoDe(col);
    if (d.formato === "ambiguo") return { valor: 0, ambiguo: true, referencia: Math.abs(valorCeldaSuelta(l)) };
    const f: FormatoNumero = d.formato === "neutral" ? this.declarado : d.formato;
    const val = l[f] ?? (f === "chilean" ? l.generic : l.chilean);
    return { valor: val ?? 0, ambiguo: false };
  }
}

/** Lectura laxa histórica para texto que no es un monto limpio. */
export function lecturaLaxa(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (v instanceof Date) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const neg = s.startsWith("-");
  const digits = s.split(",")[0].replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/**
 * number_format de un mapa, DERIVADO de sus columnas de plata: "generic" si
 * alguna columna de plata es inequívocamente inglesa y ninguna chilena.
 */
export function derivarNumberFormat(rows: unknown[][], desde: number, cols: number[]): FormatoNumero {
  let chile = 0;
  let gen = 0;
  for (const col of cols) {
    if (col == null || col < 0) continue;
    const celdas: unknown[] = [];
    for (let i = desde; i < rows.length; i++) celdas.push(rows[i]?.[col]);
    const d = decidirFormatoColumna(celdas);
    if (d.formato === "chilean") chile++;
    else if (d.formato === "generic") gen++;
  }
  return gen > 0 && chile === 0 ? "generic" : "chilean";
}
