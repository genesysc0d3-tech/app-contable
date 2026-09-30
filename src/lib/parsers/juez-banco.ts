import { createHash } from "crypto";
import type * as XLSX from "xlsx";
import type { AdapterConfig, DescarteFila, ParsedLine, Row, VerificacionCartola } from "./types";
import { leerCeldaMonto, valorCeldaSuelta } from "./numeros";
import { normalizarTitulo, RE_ENTRADA, RE_SALIDA } from "./encabezados";
import { cuadreDeLectura, TOLERANCIA_SELLO_PESOS, toleranciaDelSello } from "./saldo-cuadre";
import { cellEsFecha } from "./celdas";

/**
 * JUEZ EXTERNO: lo que el propio banco imprime (puntos 5 y 6, 2026-09-30).
 *
 * "Un validador nunca es un LLM" y "aceptar solo con PRUEBA A FAVOR". Las pruebas
 * que valen, en orden:
 *   1. saldo       — el saldo corrido cierra la ecuación fila a fila (validator).
 *   2. total_banco — el resumen impreso (saldo anterior / total cargos / total
 *                    abonos / saldo final), la fila de totales o la fórmula
 *                    =SUM(rango) del banco calzan AL PESO con lo leído, y algo
 *                    dice la DIRECCIÓN (la etiqueta "Total cargos", o los títulos
 *                    de las columnas). Un total que calza pero no dice qué es
 *                    cargo y qué es abono prueba que no faltan filas, no que la
 *                    dirección esté bien → no alcanza solo.
 *   3. cliente     — lo pone la UI (el cliente revisó o tecleó su saldo final).
 * Si nada prueba, o algo CONTRADICE (el banco dice otra cosa), el sello es
 * `sin_comprobar` con el detalle. Nunca un OK implícito.
 *
 * Verificado en una cartola real (docs/investigacion-lectores-multibanco-2026-09-30.md
 * §1): "Resumen del Periodo" arriba de los movimientos, cuadra al peso.
 */

export interface ResumenImpreso {
  saldoInicial?: number;
  totalCargos?: number;
  totalAbonos?: number;
  saldoFinal?: number;
}

// La etiqueta EMPIEZA con "saldo"/"total": una glosa "PAGO TOTAL TARJETA
// CREDITO" no es el total de abonos del banco.
const ETIQUETAS: { campo: keyof ResumenImpreso; re: RegExp }[] = [
  { campo: "saldoInicial", re: /^saldo\s+(inicial|anterior)\b/ },
  { campo: "saldoFinal", re: /^saldo\b.*\bfinal\b|^saldo\s+contable\s+al\b/ },
  { campo: "totalCargos", re: /^total(es)?\b.*\b(cargos?|debitos?|egresos?|giros?|cheques?)\b/ },
  { campo: "totalAbonos", re: /^total(es)?\b.*\b(abonos?|creditos?|depositos?|ingresos?)\b/ },
];

function montoDeCelda(v: unknown): number | null {
  const l = leerCeldaMonto(v);
  return l ? valorCeldaSuelta(l) : null;
}

/**
 * Busca el bloque de resumen impreso en TODA la hoja (arriba o abajo de los
 * movimientos). Valor: en la misma celda ("Saldo anterior: $ 1.000"), en una de
 * las 3 celdas de la derecha, o en la celda de abajo (títulos en una fila y
 * montos en la siguiente, como la Cartola N°02 real).
 */
export function detectarResumenImpreso(rows: Row[]): ResumenImpreso | null {
  const out: ResumenImpreso = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    // Una fila con fecha es un MOVIMIENTO, no el resumen del banco.
    if (r.some((v) => cellEsFecha(v as never) && !(typeof v === "number"))) continue;
    for (let j = 0; j < r.length; j++) {
      const v = r[j];
      if (typeof v !== "string") continue;
      const t = normalizarTitulo(v);
      if (!t || t.length > 60) continue;
      // Una etiqueta que calza dos campos ("total cargos y abonos") no sirve.
      const campos = ETIQUETAS.filter((e) => e.re.test(t));
      if (campos.length !== 1) continue;
      const campo = campos[0].campo;
      if (out[campo] != null) continue;
      let valor: number | null = null;
      const enCelda = v.split(/:/).slice(1).join(":");
      if (enCelda) valor = montoDeCelda(enCelda.trim());
      for (let k = j + 1; valor == null && k < Math.min(r.length, j + 4); k++) {
        if (typeof r[k] === "string" && /[a-z]/i.test(String(r[k]).replace(/\$|clp/gi, ""))) break;
        valor = montoDeCelda(r[k]);
      }
      if (valor == null) valor = montoDeCelda(rows[i + 1]?.[j]);
      if (valor != null) out[campo] = valor;
    }
  }
  return Object.keys(out).length ? out : null;
}

export interface FormulaSuma {
  /** Índice 0-based en `rows` (sheet_to_json header:1) de la fila con la fórmula. */
  fila: number;
  col: number;
  /** Rango sumado, en índices 0-based de `rows`. */
  desde: number;
  hasta: number;
  valor: number | null;
  /**
   * Lo que da la fórmula RECALCULADA desde sus celdas fuente (como Excel: solo
   * números; el texto y lo vacío no suman). null si el rango trae un error.
   */
  recalculado: number | null;
  /**
   * El valor cacheado (<v>) no es el de sus celdas: el archivo se editó después
   * de exportarlo (o la <f> se cambió y el <v> quedó viejo). Una fórmula así NO
   * es testigo de nada (batería de sellos falsos, 2026-09-30).
   */
  editada: boolean;
}

function colALetraIdx(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Fórmulas =SUM(A13:A250) / =SUMA(...) de UNA columna. SheetJS las deja en
 * cell.f (lectura por defecto); sheet_to_json las bota. El rango es un censo
 * escrito por el banco y el valor, un total impreso.
 */
export function formulasSuma(sheet: XLSX.WorkSheet | undefined, decodeRange: (r: string) => XLSX.Range, decodeCell: (c: string) => XLSX.CellAddress): FormulaSuma[] {
  if (!sheet || !sheet["!ref"]) return [];
  const origen = decodeRange(sheet["!ref"]).s;
  const out: FormulaSuma[] = [];
  for (const ref of Object.keys(sheet)) {
    if (ref.startsWith("!")) continue;
    const cell = sheet[ref] as XLSX.CellObject | undefined;
    const f = cell?.f;
    if (!f) continue;
    const m = f.replace(/\$/g, "").match(/^\s*=?\s*SUMA?\s*\(\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*\)\s*$/i);
    if (!m || m[1].toUpperCase() !== m[3].toUpperCase()) continue;
    const addr = decodeCell(ref);
    const col = colALetraIdx(m[1]);
    if (col !== addr.c) continue; // solo la suma de SU columna
    const valor = typeof cell?.v === "number" ? cell.v : null;
    // Recalculada desde las celdas fuente, con las reglas de SUMA de Excel.
    let recalculado: number | null = 0;
    for (let r = parseInt(m[2], 10) - 1; r <= parseInt(m[4], 10) - 1 && recalculado != null; r++) {
      const c = sheet[`${m[1].toUpperCase()}${r + 1}`] as XLSX.CellObject | undefined;
      if (!c) continue;
      if (c.t === "e") recalculado = null;
      else if (c.t === "n" && typeof c.v === "number" && Number.isFinite(c.v)) recalculado += c.v;
    }
    out.push({
      fila: addr.r - origen.r,
      col: col - origen.c,
      desde: parseInt(m[2], 10) - 1 - origen.r,
      hasta: parseInt(m[4], 10) - 1 - origen.r,
      valor,
      recalculado,
      editada: valor != null && (recalculado == null || Math.abs(valor - recalculado) > 0.005),
    });
  }
  return out;
}

export interface CuentaCartola {
  /** sha256 de los dígitos de la cuenta (16 hex): encadena cartolas sin guardar el número. */
  huella: string;
  /** Últimos 4 dígitos, para mostrar ("cuenta …7890"). */
  sufijo: string;
}

/** N° de cuenta del encabezado ("Cuenta Corriente: 00-123-45678-90"). */
export function detectarCuenta(rows: Row[], hasta: number): CuentaCartola | null {
  for (let i = 0; i < Math.min(rows.length, Math.max(hasta, 0), 40); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const v = r[j];
      if (typeof v !== "string" || !/\bcuenta\b|\bcta\b/i.test(v)) continue;
      const texto = `${v} ${typeof r[j + 1] === "string" || typeof r[j + 1] === "number" ? r[j + 1] : ""}`;
      const m = texto.match(/(\d[\d\-. ]{5,}\d)/);
      if (!m) continue;
      const digitos = m[1].replace(/\D/g, "");
      if (digitos.length < 6 || digitos.length > 20) continue;
      return { huella: createHash("sha256").update(`cta:${digitos}`).digest("hex").slice(0, 16), sufijo: digitos.slice(-4) };
    }
  }
  return null;
}

/** Saldo inicial y final de la cartola, si se pueden saber. */
export function saldosDeLaCartola(lines: ParsedLine[], resumen: ResumenImpreso | null): { inicial: number | null; final: number | null } {
  const conSaldo = lines.filter((l) => typeof l.saldo === "number" && Number.isFinite(l.saldo));
  if (conSaldo.length >= 2) {
    // Orden cronológico: por FECHA si la primera y la última difieren; si no (un
    // solo día), por la ECUACIÓN del saldo (adversarial-2 M5: una cartola de un
    // día en orden descendente daba mal el saldo inicial).
    const efectoDe = (l: ParsedLine) => (l.tipo === "ENTRADA" ? l.monto : -l.monto);
    const cierra = (xs: ParsedLine[]) => xs.slice(1).filter((l, i) => Math.abs((l.saldo as number) - ((xs[i].saldo as number) + efectoDe(l))) <= 1).length;
    const f0 = conSaldo[0].fecha; const f1 = conSaldo[conSaldo.length - 1].fecha;
    const desc = f0 !== f1 ? f0 > f1 : cierra([...conSaldo].reverse()) > cierra(conSaldo);
    const crono = desc ? [...conSaldo].reverse() : conSaldo;
    const primero = crono[0];
    const efecto = primero.tipo === "ENTRADA" ? primero.monto : -primero.monto;
    return { inicial: (primero.saldo as number) - efecto, final: crono[crono.length - 1].saldo as number };
  }
  return { inicial: resumen?.saldoInicial ?? null, final: resumen?.saldoFinal ?? null };
}

export interface JuicioBanco {
  prueba: boolean;
  contradice: string | null;
  detalle: string;
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/** ¿Los títulos de las columnas de plata dicen la DIRECCIÓN del mapa? */
function direccionPorTitulos(rows: Row[], cfg: AdapterConfig): boolean {
  if ((cfg.layout ?? "two_cols") !== "two_cols") return false;
  const fila = rows[cfg.skip_rows_before_data - 1];
  if (!fila) return false;
  const tc = normalizarTitulo(fila[cfg.columns.cargo]);
  const ta = normalizarTitulo(fila[cfg.columns.abono]);
  return RE_SALIDA.test(tc) && !RE_ENTRADA.test(tc) && RE_ENTRADA.test(ta) && !RE_SALIDA.test(ta);
}

/**
 * ¿Los títulos de la hoja CONTRADICEN la dirección del mapa? (la columna que el
 * mapa lee como cargo se titula "Abonos" y la de abono "Cargos"). Vuelta 2, N1:
 * un global invertido se aplicaba en silencio aunque la hoja dijera lo contrario.
 */
// Para CONTRADECIR basta que los títulos lo digan en inglés ("Credit"/"Debit").
const ENTRADA_X = new RegExp(`${RE_ENTRADA.source}|\\bcredits?\\b|\\bdeposits?\\b`);
const SALIDA_X = new RegExp(`${RE_SALIDA.source}|\\bdebits?\\b|\\bwithdrawals?\\b`);

export function titulosContradicenMapa(rows: Row[], cfg: AdapterConfig): boolean {
  if ((cfg.layout ?? "two_cols") !== "two_cols") return false;
  // También unas filas más arriba: la heurística puede tomar como "títulos" una
  // fila "SALDO INICIAL" pegada a los datos y dejar los títulos reales encima.
  const arriba = Array.from({ length: 4 }, (_, k) => cfg.skip_rows_before_data - 2 - k).filter((i) => i >= 0);
  for (const idx of new Set([cfg.skip_rows_before_data - 1, cfg.header_row, ...arriba])) {
    const fila = rows[idx];
    if (!fila) continue;
    const tc = normalizarTitulo(fila[cfg.columns.cargo]);
    const ta = normalizarTitulo(fila[cfg.columns.abono]);
    if (ENTRADA_X.test(tc) && !SALIDA_X.test(tc) && SALIDA_X.test(ta) && !ENTRADA_X.test(ta)) return true;
  }
  return false;
}

/** ¿El título de la columna (fila de encabezado del mapa) dice la dirección? */
function tituloDiceDireccion(rows: Row[], cfg: AdapterConfig, col: number): boolean {
  if (col < 0) return false;
  for (const idx of new Set([cfg.skip_rows_before_data - 1, cfg.header_row])) {
    const t = normalizarTitulo(rows[idx]?.[col]);
    if (t && (RE_ENTRADA.test(t) || RE_SALIDA.test(t) || /\(\s*[+-]\s*\/\s*[+-]\s*\)|[+-]\s*\/\s*[+-]/.test(t))) return true;
  }
  return false;
}

/**
 * ¿Las banderas de dirección (single_col) son ambiguas? Solo letras C/D (C puede
 * ser Cargo o Crédito), o dos valores distintos que se leen como la MISMA
 * dirección sin ningún valor de la otra (vuelta 3, V3-2).
 */
function banderasAmbiguas(rows: Row[], cfg: AdapterConfig, lines: ParsedLine[]): boolean {
  if ((cfg.layout ?? "two_cols") !== "single_col") return false;
  const col = cfg.columns.tipo_flujo_col ?? -1;
  if (col < 0) return false;
  const valores = new Map<string, ParsedLine["tipo"]>();
  for (const l of lines) {
    const v = String(rows[(l.excel_row ?? 0) - 1]?.[col] ?? "").trim().toLowerCase();
    if (v) valores.set(v, l.tipo);
  }
  const claves = [...valores.keys()];
  if (claves.length >= 2 && claves.every((k) => k === "c" || k === "d")) return true;
  const direcciones = new Set(valores.values());
  return claves.length >= 2 && direcciones.size === 1;
}

/**
 * Compara lo leído con lo que imprime el banco. `filasTotales` = filas de
 * totales/resumen ya marcadas por el lector (índices 0-based).
 */
export function juzgarContraBanco(args: {
  rows: Row[];
  cfg: AdapterConfig;
  lines: ParsedLine[];
  resumen: ResumenImpreso | null;
  formulas: FormulaSuma[];
  filasTotales: number[];
  /** ±$ del calce: 0 con montos enteros, $1 solo con centavos (toleranciaDelSello). */
  tolerancia?: number;
}): JuicioBanco {
  const { rows, cfg, lines, resumen, formulas } = args;
  const c = cfg.columns;
  const layout = cfg.layout ?? "two_cols";
  const entradas = lines.filter((l) => l.tipo === "ENTRADA").reduce((s, l) => s + l.monto, 0);
  const salidas = lines.filter((l) => l.tipo === "SALIDA").reduce((s, l) => s + l.monto, 0);
  const tol = args.tolerancia ?? TOLERANCIA_SELLO_PESOS;
  const cerca = (a: number, b: number) => Math.abs(a - b) <= tol;
  const pruebas: string[] = [];
  const contra: string[] = [];
  /** Lo que el banco imprime pero NO alcanza como prueba (se dice la verdad en el detalle, vuelta 2 P4). */
  const avisos: string[] = [];

  // 1) Resumen con etiquetas: trae la dirección en la etiqueta misma.
  if (resumen) {
    let direccional = 0;
    if (resumen.totalCargos != null) {
      if (cerca(Math.abs(resumen.totalCargos), salidas)) direccional++;
      else contra.push(`el banco dice total cargos ${pesos(Math.abs(resumen.totalCargos))} y leímos ${pesos(salidas)}`);
    }
    if (resumen.totalAbonos != null) {
      if (cerca(Math.abs(resumen.totalAbonos), entradas)) direccional++;
      else contra.push(`el banco dice total abonos ${pesos(Math.abs(resumen.totalAbonos))} y leímos ${pesos(entradas)}`);
    }
    let ecuacion = false;
    if (resumen.saldoInicial != null && resumen.saldoFinal != null) {
      const esperado = resumen.saldoInicial + entradas - salidas;
      if (cerca(esperado, resumen.saldoFinal)) ecuacion = true;
      else contra.push(`saldo anterior ${pesos(resumen.saldoInicial)} + lo leído da ${pesos(esperado)}, pero el banco dice saldo final ${pesos(resumen.saldoFinal)}`);
    }
    // Prueba: los dos totales por dirección, o la ecuación inicial→final con al
    // menos un total (la ecuación sola no distingue un cargo de un abono si los
    // montos se compensan, pero con un total direccional sí).
    if (direccional === 2 || (ecuacion && direccional >= 1) || (ecuacion && salidas + entradas > 0 && salidas !== entradas)) {
      pruebas.push("el resumen del banco calza al peso");
    }
  }

  // 2) Fórmulas =SUM del banco sobre columnas de plata del mapa.
  const colsPlata: { col: number; suma: (desde: number, hasta: number, soloNumeros?: boolean) => number; nombre: string }[] = [];
  // La fórmula SUMA de Excel ignora los montos escritos como TEXTO (BancoEstado
  // "$100"); una fila de totales impresa por el banco, no.
  const sumaEnRango = (filtro: (l: ParsedLine) => boolean) => (desde: number, hasta: number, soloNumeros = true) =>
    lines.filter((l) => filtro(l) && !(soloNumeros && l.monto_texto) && (l.excel_row ?? 0) - 1 >= desde && (l.excel_row ?? 0) - 1 <= hasta)
      .reduce((s, l) => s + l.monto, 0);
  if (layout === "two_cols") {
    colsPlata.push({ col: c.cargo, suma: sumaEnRango((l) => l.tipo === "SALIDA"), nombre: "cargos" });
    colsPlata.push({ col: c.abono, suma: sumaEnRango((l) => l.tipo === "ENTRADA"), nombre: "abonos" });
  } else if (c.monto != null && c.monto >= 0 && layout !== "monto_con_signo") {
    colsPlata.push({ col: c.monto, suma: sumaEnRango(() => true), nombre: "montos" });
  }
  const colsProbadas = new Set<number>();
  // Filas (0-based) que el mapa leyó EN cada columna de plata: el rango de la
  // fórmula tiene que cubrirlas TODAS (adversarial-2 M1: un =SUM(C2:C4) parcial o
  // un rango vacío que da 0 "probaba" la columna entera).
  const filasDe = (col: number) => lines.filter((l) => {
    if (layout !== "two_cols") return true;
    return col === c.cargo ? l.tipo === "SALIDA" : l.tipo === "ENTRADA";
  }).filter((l) => !l.monto_texto).map((l) => (l.excel_row ?? 0) - 1);
  for (const f of formulas) {
    const cp = colsPlata.find((x) => x.col === f.col);
    if (!cp || f.valor == null) continue;
    if (f.editada) {
      contra.push(`la fórmula SUM en ${cp.nombre} dice ${pesos(Math.abs(f.valor))} pero sus celdas ${f.recalculado == null ? "traen un error" : `suman ${pesos(Math.abs(f.recalculado))}`}: el archivo fue editado después de exportarlo y esa fórmula no sirve de testigo`);
      continue;
    }
    const leido = cp.suma(f.desde, f.hasta);
    const filas = filasDe(f.col);
    const cubre = filas.length > 0 && filas.every((i) => i >= f.desde && i <= f.hasta);
    if (cerca(Math.abs(f.valor), leido)) {
      // UN SOLO ROL POR CELDA (batería de sellos falsos 2026-09-30): la =SUM es
      // función de las MISMAS celdas que se leyeron; calzar prueba que no se leyó
      // mal un número, no que cada celda sea un movimiento ni su dirección (una
      // celda combinada que corre un cargo a Abonos recalcula la SUM igual).
      // Sirve para CONTRADECIR, nunca para sellar.
      avisos.push(cubre && Math.abs(f.valor) > 0
        ? `la fórmula SUM en ${cp.nombre} calza, pero se calcula de las mismas celdas leídas: no es un testigo independiente`
        : `la fórmula SUM del banco en ${cp.nombre} no cubre todas las filas leídas (o suma $0): no prueba la lectura`);
    } else contra.push(`la fórmula SUM del banco da ${pesos(Math.abs(f.valor))} en ${cp.nombre} y leímos ${pesos(leido)}`);
  }

  // 3) Fila de totales sin etiqueta direccional ("Total" | | 123 | 456): se mira
  //    celda por celda en las columnas de plata del mapa.
  //    Si la fila DICE "Total" (no subtotal) y su número no calza con lo leído,
  //    el banco contradice la lectura.
  for (const i of args.filasTotales) {
    const r = rows[i];
    if (!r || formulas.some((f) => f.fila === i)) continue;
    const esTotal = r.some((v) => typeof v === "string" && /^\s*total(es)?\b/i.test(v));
    for (const cp of colsPlata) {
      const v = montoDeCelda(r[cp.col]);
      if (v == null || v === 0) continue;
      const leido = cp.suma(0, rows.length, false);
      if (cerca(Math.abs(v), leido) || cerca(Math.abs(v), cp.suma(0, rows.length, true))) colsProbadas.add(cp.col);
      else if (esTotal) contra.push(`el total impreso del banco en ${cp.nombre} es ${pesos(Math.abs(v))} y leímos ${pesos(leido)}`);
    }
  }

  const todasProbadas = colsPlata.length > 0 && colsPlata.every((cp) => colsProbadas.has(cp.col));
  if (todasProbadas) {
    if (direccionPorTitulos(rows, cfg)) pruebas.push("los totales del banco calzan al peso con cada columna");
  }

  if (contra.length) return { prueba: false, contradice: contra.join("; "), detalle: `El banco no calza: ${contra.join("; ")}` };
  if (pruebas.length) return { prueba: true, contradice: null, detalle: pruebas.join("; ") };
  return {
    prueba: false,
    contradice: null,
    detalle: todasProbadas
      ? "Los totales del banco calzan, pero nada dice qué columna es cargo y cuál abono"
      : avisos.length ? `Sin prueba: ${avisos.join("; ")}` : "",
  };
}

/**
 * SELLO de la cartola: la prueba más fuerte que hay, o `sin_comprobar` con el
 * porqué. Una contradicción del banco o plata que el mapa no leyó ganan a
 * cualquier prueba (algo no calza → no se sella).
 *
 * SELLO ESTRICTO (revisiones adversariales 2026-09-30): "saldo" solo si la
 * ecuación cierra AL PESO (±$1) en el 100% de las filas leídas, la lectura al
 * revés NO cierra y no hay NINGUNA fila perdida no legítima (fecha imposible,
 * cargo y abono, sin fecha, tipo desconocido, sin leer, monto dudoso). Si el
 * saldo cierra solo en parte → sin_comprobar con "N de M filas no cuadran". La
 * tolerancia blanda (1% del saldo) sirve para ELEGIR columnas, nunca para sellar.
 */
const MIN_FILAS_SELLO = 10;

const MOTIVO_TXT: Partial<Record<DescarteFila["motivo"], string>> = {
  sin_leer: "con fecha y plata que el mapa de columnas no leyó",
  monto_ambiguo: "con un monto en un formato que no se puede leer sin adivinar",
  sin_fecha: "con plata y sin fecha",
  fecha_ilegible: "con una fecha que no se entiende",
  fecha_imposible: "con una fecha imposible",
  fecha_fuera_de_rango: "con una fecha fuera de rango",
  tipo_desconocido: "sin saber si es cargo o abono",
  cargo_y_abono: "con cargo y abono a la vez",
  fila_de_saldo: "que parecen de saldo y no se leyeron como movimiento",
};

export function sellarCartola(args: {
  rows: Row[];
  cfg: AdapterConfig;
  lines: ParsedLine[];
  descartes: DescarteFila[];
  resumen: ResumenImpreso | null;
  formulas: FormulaSuma[];
}): VerificacionCartola {
  const { rows, cfg, descartes, lines } = args;
  // Un subtotal del día (reconocido por estructura) no es el total de la cartola.
  const filasTotales = descartes.filter((d) => d.legitimo && d.motivo === "resumen" && !d.subtotal).map((d) => d.excel_row - 1);
  const tolerancia = toleranciaDelSello(rows, cfg, lines);
  const juicio = juzgarContraBanco({ ...args, filasTotales, tolerancia });
  if (juicio.contradice) return { tipo: "sin_comprobar", alerta: true, detalle: `El banco no calza: ${juicio.contradice}` };
  // Los títulos de la hoja dicen lo CONTRARIO del mapa (la columna leída como
  // cargo se titula "Abonos"): aunque el saldo cierre, el archivo se contradice
  // a sí mismo (daño "cruzar cargo↔abono" de la batería). Sin sello.
  if (titulosContradicenMapa(rows, cfg)) {
    return { tipo: "sin_comprobar", alerta: true, detalle: "Los títulos de la hoja dicen lo contrario de cómo la leímos (cargo↔abono): corrige las columnas" };
  }
  const perdidas = descartes.filter((d) => !d.legitimo);
  if (perdidas.length) {
    const porMotivo = new Map<string, number>();
    for (const d of perdidas) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
    const detalle = [...porMotivo].map(([m, n]) => `${n} fila(s) ${MOTIVO_TXT[m as DescarteFila["motivo"]] ?? "con plata que no se leyó"}`).join("; ");
    return { tipo: "sin_comprobar", alerta: true, detalle };
  }
  const layout = cfg.layout ?? "two_cols";
  if (cfg.columns.saldo >= 0 && layout !== "transactions_log" && lines.length > 1) {
    const q = cuadreDeLectura(lines, rows, cfg, args.resumen?.saldoInicial ?? null, tolerancia);
    if (q.fallidas > 0) {
      // Export FILTRADO (vuelta 2, N4): una sola dirección y cada salto se explica
      // por movimientos del otro signo que no vienen → sin sello, pero el cliente
      // puede confirmarla explícitamente ("mi cartola es solo abonos").
      // El primer salto puede ser el ancla del saldo inicial (fila de arriba), no
      // un movimiento faltante: se miran los saltos DENTRO de la cartola.
      const internos = q.saltos.length > 1 ? q.saltos.slice(1) : q.saltos;
      // Vuelta 3 (V3-1): NUNCA "filtrada" si la lectura al revés cuadra, si algún
      // salto es ±2×monto de su fila (cargo↔abono invertido) o si las banderas
      // C/D son ambiguas (C = Cargo o C = Crédito): eso es un mapa al revés.
      // (Que la mayoría de los saltos sea ±2×monto: uno suelto puede ser un
      // cargo faltante que por azar vale el doble — santander.xlsx real.)
      const dobles = q.saltos.filter((x, i) => Math.abs(Math.abs(x) - 2 * (q.montosSalto[i] ?? 0)) <= Math.max(tolerancia, TOLERANCIA_SELLO_PESOS)).length;
      const alReves = q.invertidaCuadra
        || (q.saltos.length > 0 && dobles / q.saltos.length >= 0.8)
        || banderasAmbiguas(rows, cfg, lines);
      const soloAbonos = !alReves && lines.every((l) => l.tipo === "ENTRADA") && internos.every((x) => x < 0);
      return {
        tipo: "sin_comprobar",
        alerta: true,
        ...(soloAbonos ? { filtrada: "abonos" as const } : {}),
        detalle: alReves
          ? `El saldo corrido no cierra (${q.fallidas} de ${q.revisadas} filas) y todo indica columnas o banderas al revés (cargo↔abono): corrige las columnas`
          : `El saldo corrido no cierra: ${q.fallidas} de ${q.revisadas} filas no cuadran (¿cartola filtrada o incompleta?)`,
      };
    }
    const cadena = q.sinSaldo === 0 && q.revisadas >= MIN_FILAS_SELLO && !q.invertidaCuadra;
    // PRIMERA fila (vuelta 2, P1): con saldo inicial (fila de arriba o resumen
    // impreso) se comprueba y el sello dice "todas"; sin él, el sello lo dice.
    // Vuelta 3 (V3-3): con UNA columna de monto con signo, el saldo prueba que no
    // faltan filas, NO la convención del signo (en una tarjeta de crédito la
    // deuda sube con la compra y la ecuación cierra igual). Sin un título que
    // diga la dirección → sin sello pleno y se pide mirar.
    if (cadena && layout === "monto_con_signo" && !tituloDiceDireccion(rows, cfg, cfg.columns.monto ?? -1)) {
      return {
        tipo: "sin_comprobar",
        revisar: true,
        detalle: "El saldo cuadra, pero nada en la cartola dice si el signo negativo es un cargo o un abono (¿tarjeta de crédito?): revisa cómo la leímos",
      };
    }
    if (cadena && q.primeraComprobada && q.revisadas === q.leidas) {
      return { tipo: "saldo", detalle: "El saldo corrido cuadra al peso en todas las filas, desde el saldo inicial" };
    }
    if (cadena && q.revisadas === q.leidas - 1) {
      if (q.primeraDesdeCero) {
        return {
          tipo: "sin_comprobar",
          alerta: true,
          detalle: "La primera fila deja el saldo inicial en $0 (su monto es su propio saldo): ¿es el saldo anterior y no un movimiento?",
        };
      }
      // Vuelta 3: la primera sin comprobar → nunca sello pleno; "así la leímos".
      return {
        tipo: "sin_comprobar",
        revisar: true,
        detalle: `El saldo corrido cuadra al peso en ${q.revisadas} de ${q.leidas} filas; la primera no se puede comprobar (la cartola no trae saldo inicial): revisa cómo la leímos`,
      };
    }
  }
  if (juicio.prueba) {
    // UN ROL POR CELDA: un total del banco prueba que la plata calza, no que
    // cada fila leída sea un MOVIMIENTO. Una fila cuyo monto es la suma de las
    // anteriores del día puede ser un subtotal (sin saldo que lo desempate): rol
    // sin resolver → sin sello.
    const dudosas = posiblesSubtotales(lines);
    if (dudosas.length) return { tipo: "sin_comprobar", alerta: true, detalle: detalleSubtotales(dudosas) };
    return { tipo: "total_banco", detalle: juicio.detalle };
  }
  return {
    tipo: "sin_comprobar",
    detalle: juicio.detalle || "La cartola no trae saldo ni totales del banco con qué comprobar la lectura",
  };
}

/**
 * UN SOLO ROL POR CELDA (batería de sellos falsos, 2026-09-30). Filas LEÍDAS como
 * movimiento cuyo monto es exactamente la suma de ≥2 movimientos contiguos del
 * MISMO día justo antes (o justo después, si la hoja va de lo nuevo a lo viejo):
 * esa celda puede ser un movimiento O un subtotal ("Total del día" sin la
 * palabra). Sin un saldo que se mueva en esa fila, nada desempata → el sello no
 * puede afirmar que es un movimiento. Devuelve las filas (excel_row) dudosas.
 */
export function posiblesSubtotales(lines: ParsedLine[]): number[] {
  const out: number[] = [];
  const orden = [...lines].sort((a, b) => (a.excel_row ?? 0) - (b.excel_row ?? 0));
  // La glosa dice "Total…"/"Subtotal…" y se leyó como movimiento: rol sin resolver.
  for (const l of orden) if (/^\s*(sub\s*)?total(es)?\b/i.test(l.descripcion ?? "")) out.push(l.excel_row ?? 0);
  const suma = (xs: ParsedLine[], tipo?: ParsedLine["tipo"]) => xs.filter((x) => !tipo || x.tipo === tipo).reduce((s, x) => s + x.monto, 0);
  for (let i = 0; i < orden.length; i++) {
    const l = orden[i];
    // Vecinos contiguos (fila física consecutiva) del mismo día, hacia arriba y hacia abajo.
    const tramo = (paso: 1 | -1) => {
      const xs: ParsedLine[] = [];
      for (let k = i + paso; k >= 0 && k < orden.length; k += paso) {
        const x = orden[k];
        const prev = orden[k - paso];
        if (x.fecha !== l.fecha || Math.abs((x.excel_row ?? 0) - (prev.excel_row ?? 0)) !== 1) break;
        xs.push(x);
      }
      return xs;
    };
    for (const xs of [tramo(-1), tramo(1)]) {
      let hit = false;
      for (let n = 2; n <= xs.length && !hit; n++) {
        const pref = xs.slice(0, n);
        if (l.monto === suma(pref) || (l.monto === suma(pref, l.tipo) && pref.filter((x) => x.tipo === l.tipo).length >= 2)) hit = true;
      }
      if (hit) { out.push(l.excel_row ?? 0); break; }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * ¿Hay movimientos leídos a los DOS lados de una fila de totales (una =SUM o una
 * fila de resumen sin fecha, no un subtotal del día)? Un movimiento debajo del
 * total del banco quedó fuera del bloque que el banco declaró: rol sin resolver.
 */
export function movimientosFueraDelBloque(lines: ParsedLine[], descartes: DescarteFila[], formulas: FormulaSuma[]): number[] {
  const totales = [
    ...formulas.map((f) => f.fila + 1),
    ...descartes.filter((d) => d.legitimo && d.motivo === "resumen" && !d.subtotal && !d.fecha).map((d) => d.excel_row),
  ];
  const filas = lines.map((l) => l.excel_row ?? 0);
  if (!filas.length) return [];
  for (const t of totales.sort((a, b) => a - b)) {
    const arriba = filas.filter((f) => f < t).length;
    if (arriba > 0 && arriba < filas.length) return filas.filter((f) => f > t);
  }
  return [];
}

export function detalleSubtotales(filas: number[]): string {
  const lista = filas.slice(0, 6).join(", ") + (filas.length > 6 ? "…" : "");
  return `${filas.length} fila(s) leída(s) como movimiento podrían ser subtotales (dicen "total" o su monto es la suma de las anteriores del mismo día; filas ${lista}): revisa cómo la leímos`;
}
