import type { AdapterConfig, Row } from "./types";
import { normalizarTitulo, RE_ENTRADA, RE_SALIDA } from "./encabezados";
import { derivarNumberFormat } from "./numeros";
import { formatoFechaDeColumna } from "./heuristic";
import { FORMATOS_DE_SPECS } from "./formatos-conocidos.specs";
import { inferirRangoFechas } from "./apply";

/**
 * FORMATOS CONOCIDOS (paso 1 del lector, 2026-10-02): cartolas de banco cuyo
 * formato vimos en archivos REALES y quedan registradas en el código con su
 * huella y su mapa de columnas FIJO. No se adivinan: si la hoja calza con la
 * huella completa (títulos exactos + la forma del encabezado del banco), el
 * mapa es el registrado. El sello NO viene de acá: la lectura pasa igual por el
 * juez (saldo corrido / totales del banco) y sin prueba no se sella.
 *
 * Huella = (1) la fila de títulos EXACTA (normalizada, mismo orden, sin
 * columnas de más) y (2) marcas del encabezado del banco arriba de los títulos
 * y (3) el período explícito, del que sale el año de las fechas sin año. Basta
 * que falte una para que el formato NO se reconozca y la hoja siga por la
 * heurística (que la puede leer igual, pero como formato nuevo).
 *
 * Origen (sin datos de clientes, solo estructura): 8 cartolas PDF reales leídas
 * en local (2026-10-02; fixtures en testing/cartola-pdf-sintetica.ts) y las
 * specs de formatos reales que ya pasaron por prod (scripts/corpus-cartolas/
 * specs → formatos-conocidos.specs.ts, generado por derivar-conocidos.ts).
 */

type Rol = "fecha" | "descripcion" | "n_documento" | "cargo" | "abono" | "saldo" | "monto" | "flag" | "ignorar";

export interface FormatoConocido {
  id: string;
  nombre: string;
  /** Títulos normalizados de la fila de encabezado, en orden y en su POSICIÓN ("" = celda vacía), con su rol. */
  titulos: [string, Rol][];
  /** Cada una debe calzar con ALGUNA celda (normalizada) de las filas sobre los títulos. */
  marcas: RegExp[];
  date_format: AdapterConfig["date_format"];
  /** Fechas sin año: exigir el período explícito en el encabezado (de ahí sale el año). */
  requierePeriodo?: boolean;
  /**
   * Hoja del MISMO export con el encabezado del período y el resumen del banco
   * (BancoEstado chequera: hoja "Resumen" con Fecha Inicio/Final, Saldo
   * Inicial/Final, totales). De ahí sale el año y el resumen que juzga.
   */
  resumenEnHoja?: RegExp;
}

/** Forma en que llegan los formatos derivados de las specs (formatos-conocidos.specs.ts, generado). */
export interface FormatoDeSpec {
  id: string;
  banco: string;
  familia: string;
  titulos: string[];
  roles: string[];
  marcas: string[];
  fecha_sin_anio: boolean;
  flag: { entrada: string; salida: string } | null;
  resumen_en_hoja?: string | null;
}

const escapar = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function deSpec(f: FormatoDeSpec): FormatoConocido {
  return {
    id: f.id,
    nombre: `${f.banco} · ${f.familia}`,
    titulos: f.titulos.map((t, i) => [t, (f.roles[i] ?? "ignorar") as Rol]),
    marcas: f.marcas.map((m) => new RegExp(`^${escapar(m)}$`)),
    date_format: "dd/mm/yyyy",
    // Fechas sin año (BancoEstado "02/09"): sin período explícito no es este formato.
    requierePeriodo: f.fecha_sin_anio,
    ...(f.resumen_en_hoja ? { resumenEnHoja: new RegExp(`^${escapar(normalizarTitulo(f.resumen_en_hoja))}$`) } : {}),
  };
}

const FORMATOS_PDF: FormatoConocido[] = [
  {
    id: "itau-cartola-historica-pdf",
    nombre: "Itaú · Cartola Histórica cuenta corriente (PDF)",
    titulos: [
      ["fecha", "fecha"], ["nº operacion", "n_documento"], ["sucursal", "ignorar"], ["descripcion", "descripcion"],
      ["depositos o abonos", "abono"], ["giros o cargos", "cargo"], ["saldo diario", "saldo"],
    ],
    marcas: [/^cartola historica$/, /^estado de cuenta corriente$/, /^saldo anterior cuenta corriente$/],
    date_format: "dd/mm/yyyy",
    requierePeriodo: true,
  },
  {
    id: "estado-de-cuenta-desde-hasta-pdf",
    nombre: "Estado de cuenta N° (Desde/Hasta, Saldo Anterior/Actual) (PDF)",
    titulos: [
      ["fecha", "fecha"], ["descripcion", "descripcion"], ["n° doc.", "n_documento"],
      ["cargos", "cargo"], ["abonos", "abono"], ["saldo", "saldo"],
    ],
    marcas: [/^estado de cuenta n° ?\d+$/, /^desde$/, /^hasta$/, /^saldo anterior$/, /^saldo actual$/],
    date_format: "dd-mm-yyyy",
    requierePeriodo: true,
  },
];

export const FORMATOS_CONOCIDOS: FormatoConocido[] = [...FORMATOS_PDF, ...FORMATOS_DE_SPECS.map(deSpec)];

const MAX_FILAS_ENCABEZADO = 40;

function mapaDe(f: FormatoConocido, rows: Row[], i: number, fila: string[]): AdapterConfig | null {
  const col = (rol: Rol) => f.titulos.findIndex(([, r]) => r === rol);
  const [fecha, descripcion, n_documento, cargo, abono, saldo, monto, flag] =
    (["fecha", "descripcion", "n_documento", "cargo", "abono", "saldo", "monto", "flag"] as Rol[]).map(col);
  if (fecha < 0 || descripcion < 0) return null;
  const plata = [cargo, abono, saldo, monto].filter((x) => x >= 0);
  // Fechas: el formato lo prueba la COLUMNA, igual que en la heurística. Si la
  // columna prueba mes/día (09/13/2026), el archivo no es el formato chileno
  // registrado → no es conocido (no se fuerza el día primero).
  const df = formatoFechaDeColumna(rows, i + 1, fecha);
  if (df === "mm/dd/yyyy") return null;
  const base = {
    header_row: i,
    skip_rows_before_data: i + 1,
    date_format: df === "unknown" ? f.date_format : df,
    number_format: derivarNumberFormat(rows as unknown[][], i + 1, plata),
    titulos: fila,
  };
  if (monto >= 0 && flag >= 0) {
    return { ...base, layout: "single_col", columns: { fecha, descripcion, n_documento, monto, cargo: monto, abono: monto, saldo, tipo_flujo_col: flag } };
  }
  if (monto >= 0) {
    // UNA columna de monto: la dirección la dice su título ("Depósitos / Abonos",
    // "Ingreso (+)"); si no la dice, no es un formato conocido.
    const t = f.titulos[monto][0];
    const dir = RE_ENTRADA.test(t) && !RE_SALIDA.test(t) ? "entrada" : RE_SALIDA.test(t) && !RE_ENTRADA.test(t) ? "salida" : null;
    if (!dir) return null;
    return { ...base, layout: "transactions_log", default_tipo_flujo: dir, columns: { fecha, descripcion, n_documento, monto, cargo: monto, abono: monto, saldo } };
  }
  if (cargo < 0 || abono < 0) return null;
  return { ...base, layout: "two_cols", columns: { fecha, descripcion, n_documento, cargo, abono, saldo } };
}

/**
 * El formato conocido con el que calza la hoja (y su mapa fijo), o null. Si la
 * hoja calza con DOS formatos a la vez, ninguno: ambiguo = no se sabe.
 */
export function detectarFormatoConocido(
  rows: Row[],
  /** Las OTRAS hojas del libro (para formatos con resumen en otra hoja). */
  hojas: { nombre: string; rows: Row[] }[] = [],
): { formato: FormatoConocido; cfg: AdapterConfig; filasPeriodo: Row[] } | null {
  const hallados: { formato: FormatoConocido; cfg: AdapterConfig; filasPeriodo: Row[] }[] = [];
  for (let i = 0; i < Math.min(rows.length, MAX_FILAS_ENCABEZADO); i++) {
    const fila = (rows[i] ?? []).map(normalizarTitulo);
    while (fila.length && !fila[fila.length - 1]) fila.pop();
    if (fila.filter(Boolean).length < 2) continue;
    for (const f of FORMATOS_CONOCIDOS) {
      if (fila.length !== f.titulos.length || f.titulos.some(([t], k) => fila[k] !== t)) continue;
      const arriba = rows.slice(0, i).flatMap((r) => (r ?? []).map(normalizarTitulo)).filter(Boolean);
      if (!f.marcas.every((re) => arriba.some((c) => re.test(c)))) continue;
      const cfg = mapaDe(f, rows, i, fila);
      if (!cfg) continue;
      // Regla de año: fechas sin año exigen el período EXPLÍCITO en el encabezado
      // ("Período: dd/mm/aaaa - dd/mm/aaaa" o Desde/Hasta).
      const filasPeriodo = f.resumenEnHoja ? hojas.filter((h) => f.resumenEnHoja!.test(normalizarTitulo(h.nombre))).flatMap((h) => h.rows.slice(0, 60)) : [];
      if (f.requierePeriodo && !inferirRangoFechas(rows, cfg, filasPeriodo)?.explicito) continue;
      hallados.push({ formato: f, cfg, filasPeriodo });
    }
    if (hallados.length) break;
  }
  return hallados.length === 1 ? hallados[0] : null;
}
