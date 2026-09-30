import { createHash } from "crypto";
import type * as XLSX from "xlsx";
import type { AdapterConfig, DescarteFila, ParsedLine, Row, VerificacionCartola } from "./types";
import { leerCeldaMonto, valorCeldaSuelta } from "./numeros";
import { normalizarTitulo, RE_ENTRADA, RE_SALIDA } from "./encabezados";
import { formatoVerificadoPorSaldo } from "./validator";

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

const ETIQUETAS: { campo: keyof ResumenImpreso; re: RegExp }[] = [
  { campo: "saldoInicial", re: /\bsaldo\s+(inicial|anterior)\b/ },
  { campo: "saldoFinal", re: /\bsaldo\b.*\bfinal\b|\bsaldo\s+contable\s+al\b/ },
  { campo: "totalCargos", re: /\btotal(es)?\b.*\b(cargos?|debitos?|egresos?|giros?|cheques?)\b/ },
  { campo: "totalAbonos", re: /\btotal(es)?\b.*\b(abonos?|creditos?|depositos?|ingresos?)\b/ },
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
    out.push({
      fila: addr.r - origen.r,
      col: col - origen.c,
      desde: parseInt(m[2], 10) - 1 - origen.r,
      hasta: parseInt(m[4], 10) - 1 - origen.r,
      valor: typeof cell?.v === "number" ? cell.v : null,
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
    // Orden cronológico: si la primera fila es más nueva que la última, está al revés.
    const desc = conSaldo[0].fecha > conSaldo[conSaldo.length - 1].fecha;
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
}): JuicioBanco {
  const { rows, cfg, lines, resumen, formulas } = args;
  const c = cfg.columns;
  const layout = cfg.layout ?? "two_cols";
  const entradas = lines.filter((l) => l.tipo === "ENTRADA").reduce((s, l) => s + l.monto, 0);
  const salidas = lines.filter((l) => l.tipo === "SALIDA").reduce((s, l) => s + l.monto, 0);
  const cerca = (a: number, b: number) => Math.abs(a - b) <= 1;
  const pruebas: string[] = [];
  const contra: string[] = [];

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
  } else if (c.monto != null && c.monto >= 0) {
    colsPlata.push({ col: c.monto, suma: sumaEnRango(() => true), nombre: "montos" });
  }
  const colsProbadas = new Set<number>();
  for (const f of formulas) {
    const cp = colsPlata.find((x) => x.col === f.col);
    if (!cp || f.valor == null) continue;
    const leido = cp.suma(f.desde, f.hasta);
    if (cerca(Math.abs(f.valor), leido)) colsProbadas.add(f.col);
    else contra.push(`la fórmula SUM del banco da ${pesos(Math.abs(f.valor))} en ${cp.nombre} y leímos ${pesos(leido)}`);
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
      : "",
  };
}

/**
 * SELLO de la cartola: la prueba más fuerte que hay, o `sin_comprobar` con el
 * porqué. Una contradicción del banco o plata que el mapa no leyó ganan a
 * cualquier prueba (algo no calza → no se sella).
 */
export function sellarCartola(args: {
  rows: Row[];
  cfg: AdapterConfig;
  lines: ParsedLine[];
  descartes: DescarteFila[];
  resumen: ResumenImpreso | null;
  formulas: FormulaSuma[];
}): VerificacionCartola {
  const { rows, cfg, descartes } = args;
  const filasTotales = descartes.filter((d) => d.legitimo && d.motivo === "resumen").map((d) => d.excel_row - 1);
  const juicio = juzgarContraBanco({ ...args, filasTotales });
  const sinLeer = descartes.filter((d) => d.motivo === "sin_leer").length;
  const ambiguos = descartes.filter((d) => d.motivo === "monto_ambiguo").length;
  if (juicio.contradice) return { tipo: "sin_comprobar", alerta: true, detalle: `El banco no calza: ${juicio.contradice}` };
  if (sinLeer) return { tipo: "sin_comprobar", alerta: true, detalle: `${sinLeer} fila(s) con fecha y plata que el mapa de columnas no leyó` };
  if (ambiguos) return { tipo: "sin_comprobar", alerta: true, detalle: `${ambiguos} monto(s) en un formato que no se puede leer sin adivinar` };
  if (formatoVerificadoPorSaldo(rows, cfg)) return { tipo: "saldo", detalle: "El saldo corrido cuadra fila a fila" };
  if (juicio.prueba) return { tipo: "total_banco", detalle: juicio.detalle };
  return {
    tipo: "sin_comprobar",
    detalle: juicio.detalle || "La cartola no trae saldo ni totales del banco con qué comprobar la lectura",
  };
}
