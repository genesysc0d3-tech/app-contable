import type { AdapterConfig, Row } from "./types";
import { normalizarTitulo } from "./encabezados";
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
 * en local (2026-10-02); fixtures sintéticos en testing/cartola-pdf-sintetica.ts.
 */

type Rol = "fecha" | "descripcion" | "n_documento" | "cargo" | "abono" | "saldo" | "ignorar";

export interface FormatoConocido {
  id: string;
  nombre: string;
  /** Títulos normalizados de la fila de encabezado, en orden, con su rol. */
  titulos: [string, Rol][];
  /** Cada una debe calzar con ALGUNA celda (normalizada) de las filas sobre los títulos. */
  marcas: RegExp[];
  date_format: AdapterConfig["date_format"];
}

export const FORMATOS_CONOCIDOS: FormatoConocido[] = [
  {
    id: "itau-cartola-historica-pdf",
    nombre: "Itaú · Cartola Histórica cuenta corriente (PDF)",
    titulos: [
      ["fecha", "fecha"], ["nº operacion", "n_documento"], ["sucursal", "ignorar"], ["descripcion", "descripcion"],
      ["depositos o abonos", "abono"], ["giros o cargos", "cargo"], ["saldo diario", "saldo"],
    ],
    marcas: [/^cartola historica$/, /^estado de cuenta corriente$/, /^saldo anterior cuenta corriente$/],
    date_format: "dd/mm/yyyy",
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
  },
];

const MAX_FILAS_ENCABEZADO = 40;

/** El formato conocido con el que calza la hoja (y su mapa fijo), o null. */
export function detectarFormatoConocido(rows: Row[]): { formato: FormatoConocido; cfg: AdapterConfig } | null {
  for (let i = 0; i < Math.min(rows.length, MAX_FILAS_ENCABEZADO); i++) {
    const fila = (rows[i] ?? []).map(normalizarTitulo);
    while (fila.length && !fila[fila.length - 1]) fila.pop();
    if (!fila.length || fila[0] !== "fecha") continue;
    for (const f of FORMATOS_CONOCIDOS) {
      if (fila.length !== f.titulos.length || f.titulos.some(([t], k) => fila[k] !== t)) continue;
      const arriba = rows.slice(0, i).flatMap((r) => (r ?? []).map(normalizarTitulo)).filter(Boolean);
      if (!f.marcas.every((re) => arriba.some((c) => re.test(c)))) continue;
      const col = (rol: Rol) => f.titulos.findIndex(([, r]) => r === rol);
      const cfg: AdapterConfig = {
        header_row: i,
        skip_rows_before_data: i + 1,
        date_format: f.date_format,
        number_format: "chilean",
        layout: "two_cols",
        columns: {
          fecha: col("fecha"), descripcion: col("descripcion"), n_documento: col("n_documento"),
          cargo: col("cargo"), abono: col("abono"), saldo: col("saldo"),
        },
        titulos: fila,
      };
      // Regla de año: el período tiene que venir EXPLÍCITO en el encabezado
      // ("Período: dd/mm/aaaa - dd/mm/aaaa" o Desde/Hasta). Sin él no es este
      // formato (las fechas "dd/mm" quedarían con el año adivinado).
      if (!inferirRangoFechas(rows, cfg)?.explicito) continue;
      return { formato: f, cfg };
    }
  }
  return null;
}
