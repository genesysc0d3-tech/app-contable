import type { AdapterConfig, DescarteFila, ParsedLine, Row, VerificacionCartola } from "./types";
import { applyAdapter } from "./apply";
import { validate } from "./validator";
import { cellEsFecha, esColumnaCorrelativa, esColumnaDeCodigos } from "./celdas";
import { leerCeldaMonto } from "./numeros";
import { cuadreSaldo } from "./saldo-cuadre";
import { sellarCartola, type FormulaSuma, type ResumenImpreso } from "./juez-banco";

/**
 * UNICIDAD DEL SELLO (batería de sellos falsos, 2026-09-30; "numberOfSolutions
 * === 1"). Un sello dice "esta lectura está PROBADA". Si OTRA asignación de
 * columnas (cargo/abono/monto/saldo/fecha), otra orientación o otra fila de
 * inicio TAMBIÉN pasa todas las pruebas y da movimientos distintos, la prueba
 * no eligió: hay dos lecturas "probadas" y el sello mentiría en una de ellas.
 *
 * Búsqueda exhaustiva pero barata: las columnas candidatas son las que traen
 * plata (o fechas) en la región de datos; cada asignación se filtra primero con
 * la ecuación del saldo sobre las celdas crudas (O(filas)) y solo las que
 * cierran se leen y se sellan de verdad con el mismo juez.
 *
 * Fecha: el saldo y los totales no prueban fechas. Una columna de fecha
 * alternativa solo cuenta como otra solución si cambia el MES de algún
 * movimiento (el período tributario); "Fecha" vs "Fecha valor" a un día no.
 */

export interface SegundaSolucion {
  cfg: AdapterConfig;
  sello: VerificacionCartola["tipo"];
  /** Qué cambia respecto de la lectura sellada ("columnas cargo/abono", "fila de inicio", "fecha"…). */
  diferencia: string;
}

const firma = (ls: ParsedLine[]) => ls.map((l) => `${l.fecha}|${l.monto}|${l.tipo}`).sort().join(",");
const firmaMes = (ls: ParsedLine[]) => ls.map((l) => `${l.fecha.slice(0, 7)}|${l.monto}|${l.tipo}`).sort().join(",");

function conPlata(v: unknown): boolean {
  if (v == null || v === "" || v instanceof Date) return false;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  const l = leerCeldaMonto(v);
  return !!l && (l.chilean ?? l.generic ?? 0) !== 0;
}

/** Columnas de la región de datos que traen plata en al menos 2 filas (una columna de cargos puede ser rala). */
function columnasDePlata(rows: Row[], filas: number[], excluir: Set<number>): number[] {
  const ncols = filas.reduce((m, i) => Math.max(m, rows[i]?.length ?? 0), 0);
  const out: number[] = [];
  for (let c = 0; c < ncols; c++) {
    if (excluir.has(c)) continue;
    const celdas = filas.map((i) => rows[i]?.[c]);
    if (esColumnaDeCodigos(celdas) || esColumnaCorrelativa(celdas)) continue;
    if (celdas.filter((v) => !cellEsFecha(v as never) && conPlata(v)).length >= 2) out.push(c);
  }
  return out;
}

function columnasDeFecha(rows: Row[], filas: number[], actual: number): number[] {
  const ncols = filas.reduce((m, i) => Math.max(m, rows[i]?.length ?? 0), 0);
  const out: number[] = [];
  for (let c = 0; c < ncols; c++) {
    if (c === actual) continue;
    if (filas.filter((i) => cellEsFecha(rows[i]?.[c] as never)).length >= filas.length * 0.9) out.push(c);
  }
  return out;
}

export function buscarSegundaSolucion(args: {
  rows: Row[];
  cfg: AdapterConfig;
  lines: ParsedLine[];
  resumen: ResumenImpreso | null;
  formulas: FormulaSuma[];
  /** Tope de asignaciones que se leen y sellan completas (las demás las bota el filtro barato). */
  maxLecturas?: number;
}): SegundaSolucion | null {
  const { rows, cfg, lines, resumen, formulas } = args;
  if (!lines.length) return null;
  const layout = cfg.layout ?? "two_cols";
  if (layout === "transactions_log") return null;
  const c = cfg.columns;
  const base = firma(lines);
  const baseMes = firmaMes(lines);
  const filas = lines.map((l) => (l.excel_row ?? 0) - 1);
  const filasTodas = Array.from({ length: Math.max(0, rows.length - cfg.skip_rows_before_data) }, (_, k) => cfg.skip_rows_before_data + k);
  const filasFormula = new Set(formulas.map((f) => f.fila));
  let presupuesto = args.maxLecturas ?? 40;

  const probar = (alt: AdapterConfig, diferencia: string, soloMes = false): SegundaSolucion | null => {
    if (presupuesto-- <= 0) return null;
    let ls: ParsedLine[];
    const descartes: DescarteFila[] = [];
    try { ls = applyAdapter(rows, alt, descartes, undefined, { filasFormula }); } catch { return null; }
    if (!ls.length) return null;
    if (soloMes ? firmaMes(ls) === baseMes : firma(ls) === base) return null;
    if (!validate(ls, rows, alt, descartes).ok) return null;
    const v = sellarCartola({ rows, cfg: alt, lines: ls, descartes, resumen, formulas });
    if (v.tipo === "saldo" || v.tipo === "total_banco") return { cfg: alt, sello: v.tipo, diferencia };
    return null;
  };

  // 1) Otras columnas de plata (misma forma de mapa). Filtro barato: la ecuación
  //    del saldo al peso sobre las celdas crudas.
  const excluir = new Set([c.fecha, c.descripcion].filter((x) => x != null && x >= 0));
  const plata = columnasDePlata(rows, filasTodas.length ? filasTodas : filas, excluir);
  const saldos = [...new Set([c.saldo, ...plata])].filter((x) => x >= 0);
  if (layout === "two_cols") {
    for (const s of saldos) for (const ca of plata) for (const ab of plata) {
      if (ca === ab || ca === s || ab === s) continue;
      if (ca === c.cargo && ab === c.abono && s === c.saldo) continue;
      const q = cuadreSaldo(rows.slice(cfg.skip_rows_before_data), ca, ab, s, "estricta");
      if (q.revisadas < 10 || q.fallidas > 0) continue;
      const r = probar({ ...cfg, columns: { ...c, cargo: ca, abono: ab, saldo: s } }, "otras columnas de cargo/abono/saldo");
      if (r) return r;
    }
  } else if (c.monto != null && c.monto >= 0) {
    for (const s of saldos) for (const m of plata) {
      if (m === s || (m === c.monto && s === c.saldo)) continue;
      const r = probar({ ...cfg, columns: { ...c, monto: m, cargo: m, abono: m, saldo: s } }, "otra columna de monto/saldo");
      if (r) return r;
    }
  }
  // Sin saldo: otra columna que calce con los totales del banco (resumen o =SUM).
  if (c.saldo < 0 && layout === "two_cols" && (resumen || formulas.length)) {
    for (const ca of plata) for (const ab of plata) {
      if (ca === ab || (ca === c.cargo && ab === c.abono)) continue;
      const r = probar({ ...cfg, columns: { ...c, cargo: ca, abono: ab } }, "otras columnas de cargo/abono");
      if (r) return r;
    }
  }
  // 2) Otra fila de inicio (±1, ±2): la primera fila como movimiento o como saldo inicial.
  for (const d of [-2, -1, 1, 2]) {
    const skip = cfg.skip_rows_before_data + d;
    if (skip < 1 || skip >= rows.length) continue;
    const r = probar({ ...cfg, skip_rows_before_data: skip, header_row: Math.min(cfg.header_row, skip - 1) }, "otra fila de inicio");
    if (r) return r;
  }
  // 3) Otra columna de fecha que cambie el MES de algún movimiento.
  for (const f of columnasDeFecha(rows, filas, c.fecha)) {
    const r = probar({ ...cfg, columns: { ...c, fecha: f } }, "otra columna de fecha (cambia el mes)", true);
    if (r) return r;
  }
  return null;
}
