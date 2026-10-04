import { leerLibroCartola } from "./libro";
import { hojaExcedeCeldas } from "./excel-guard";
import { firmaDeLineas, juzgarMapaEnLibro } from "./orchestrator";
import { filtradaPermitida } from "../cartola/verificacion";
import type { AdapterConfig, Row } from "./types";

/**
 * RESUMEN EN VIVO del popup "Revisa las columnas" (2026-09-30). Con el mapa que
 * el cliente está eligiendo, lee el archivo COMPLETO con el mismo juez del
 * orquestador y responde, en datos simples, lo que el popup dice en una frase:
 * "Con estas columnas quedan N entradas por $X y M salidas por $Y, del dd/mm
 * al dd/mm", si la cartola queda comprobada y si el BANCO contradice el mapa
 * (entonces no se puede guardar como bueno; el server lo vuelve a validar).
 * Puro y solo lectura: no toca la base.
 */
export interface ResumenMapa {
  /** Con este mapa se pudo leer la cartola (pasó el validador). */
  valido: boolean;
  /** Por qué no se pudo leer (solo si !valido). */
  error?: string;
  hoja?: string;
  entradas: { n: number; monto: number };
  salidas: { n: number; monto: number };
  /** Fechas ISO (yyyy-mm-dd) del primer y último movimiento. */
  desde: string | null;
  hasta: string | null;
  /** comprobada = el saldo o los totales del banco calzan al peso. */
  estado: "comprobada" | "sin_comprobar" | "alerta";
  motivo: string | null;
  /** El saldo o el total impreso del banco contradice este mapa. */
  contradice: boolean;
  /** Trae solo abonos y el saldo lo explica (export filtrado): se puede confirmar así. */
  soloAbonos: boolean;
  /** Filas con plata que este mapa no alcanza a leer. */
  noLeidas: number;
  /** Se puede guardar con "Listo" (no hay contradicción del banco). */
  guardable: boolean;
  /** Firma de la lectura (conteo + sumas): el reproceso la compara. */
  firma: string;
  /**
   * PDF sin marca propia de banco (vuelta 6): nunca "comprobada" (podría ser el
   * estado de cuenta de un proveedor que cuadra); el popup pregunta "¿Este PDF
   * es de tu banco?" y el "Listo" exige la respuesta.
   */
  sinMarcaBanco?: boolean;
}

const VACIO: Omit<ResumenMapa, "valido" | "error"> = {
  entradas: { n: 0, monto: 0 }, salidas: { n: 0, monto: 0 }, desde: null, hasta: null,
  estado: "alerta", motivo: null, contradice: false, soloAbonos: false, noLeidas: 0, guardable: false, firma: "",
};

export function resumenDeMapa(buffer: ArrayBuffer, cfg: AdapterConfig, opts: { pdfSinMarcaBanco?: boolean } = {}): ResumenMapa {
  return juzgarArchivo(buffer, cfg, opts).resumen;
}

/**
 * Lee el archivo y lo juzga con el mapa. Además del resumen devuelve las filas
 * de la hoja leída (null si no se pudo), para la huella y los títulos al guardar.
 */
export function juzgarArchivo(buffer: ArrayBuffer, cfg: AdapterConfig, opts: { pdfSinMarcaBanco?: boolean } = {}): { resumen: ResumenMapa; rows: Row[] | null } {
  let juicio: ReturnType<typeof juzgarMapaEnLibro>;
  try {
    // Mismas opciones que el orquestador (cellStyles: filas ocultas).
    const workbook = leerLibroCartola(buffer, { cellStyles: true });
    if (workbook.SheetNames.some((n) => hojaExcedeCeldas(workbook.Sheets[n]))) {
      return { resumen: { ...VACIO, valido: false, error: "El archivo es demasiado grande para revisarlo acá" }, rows: null };
    }
    juicio = juzgarMapaEnLibro(workbook, cfg, { pdfSinMarcaBanco: opts.pdfSinMarcaBanco });
  } catch {
    return { resumen: { ...VACIO, valido: false, error: "No pudimos abrir el archivo" }, rows: null };
  }
  if (!juicio.ok) return { resumen: { ...VACIO, valido: false, error: juicio.error }, rows: null };

  const { lines, descartes, verificacion: v } = juicio;
  const entradas = lines.filter((l) => l.tipo === "ENTRADA");
  const salidas = lines.filter((l) => l.tipo === "SALIDA");
  const suma = (xs: typeof lines) => Math.round(xs.reduce((s, l) => s + l.monto, 0));
  const fechas = lines.map((l) => l.fecha).filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f)).sort();
  const noLeidas = descartes.filter((d) => !d.legitimo).length;
  const comprobada = v.tipo === "saldo" || v.tipo === "total_banco";
  const contradice = !!v.contradice;
  const soloAbonos = filtradaPermitida({
    verificacion: v,
    perdidas: descartes.filter((d) => !d.legitimo).map(() => ({})),
    otras_hojas_con_datos: juicio.otrasHojas,
  } as Parameters<typeof filtradaPermitida>[0]);

  const resumen: ResumenMapa = {
    valido: true,
    hoja: juicio.hoja,
    entradas: { n: entradas.length, monto: suma(entradas) },
    salidas: { n: salidas.length, monto: suma(salidas) },
    desde: fechas[0]?.slice(0, 10) ?? null,
    hasta: fechas[fechas.length - 1]?.slice(0, 10) ?? null,
    estado: comprobada ? "comprobada" : v.alerta || v.revisar ? "alerta" : "sin_comprobar",
    motivo: comprobada ? null : v.detalle || null,
    contradice,
    soloAbonos,
    noLeidas,
    guardable: !contradice,
    firma: firmaDeLineas(lines),
    ...(opts.pdfSinMarcaBanco ? { sinMarcaBanco: true } : {}),
  };
  return { resumen, rows: juicio.rows };
}
