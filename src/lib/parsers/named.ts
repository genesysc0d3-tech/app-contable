import type { AdapterConfig, Row } from "./types";
import { derivarNumberFormat } from "./numeros";
import { encabezadoBancario, normalizarTitulo, RE_ENTRADA, RE_SALDO, RE_SALIDA } from "./encabezados";

/**
 * Legacy named-header detector: inspects the first ~50 rows looking for a
 * header row with specific Spanish bank-statement column names (Banco de
 * Chile style). Also detects the simplified "plantilla boletas" format
 * with Fecha, Glosa, Monto columns.
 */
/**
 * Detección DIRECTA de la plantilla massDTE (headers exactos Fecha|Glosa|Monto
 * + opcionales). Corre ANTES de la heurística en el orchestrator: es NUESTRA
 * firma (la emite /api/generar-template) y la heurística podía ganarle con las
 * columnas opcionales presentes (cazado por e2e 2026-09-02: el flag plantilla
 * nunca llegaba y las filas del cliente se iban a la IA).
 */
export function detectPlantillaBoletas(rows: Row[]): AdapterConfig | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (!r) continue;
    const norm = r.map((c) => String(c ?? "").toLowerCase().trim());
    const fechaIdx = norm.findIndex((c) => c === "fecha" || c.startsWith("fecha "));
    const glosaIdx = norm.findIndex((c) => c === "glosa");
    const montoIdx = norm.findIndex((c) => c === "monto");
    if (fechaIdx < 0 || glosaIdx < 0 || montoIdx < 0) continue;
    // Un banco que exporta Fecha|Glosa|Monto|Saldo (o con Cargo/Abono) NO es
    // nuestra plantilla: la plantilla marca TODAS las filas como entrada, y en
    // una cartola eso convierte los egresos en boletas (revisión 2026-09-26).
    if (encabezadoBancario(r)) continue;
    const tipoIdx = norm.findIndex((c) => c.startsWith("tipo"));
    const rutRecIdx = norm.findIndex((c) => c.startsWith("rut receptor"));
    const nomRecIdx = norm.findIndex((c) => c.startsWith("nombre receptor"));
    const medioIdx = norm.findIndex((c) => c.startsWith("medio de pago"));
    return {
      header_row: i,
      skip_rows_before_data: i + 1,
      date_format: "dd/mm/yyyy",
      number_format: "chilean",
      layout: "transactions_log",
      plantilla: true,
      plantilla_cols: { tipo: tipoIdx, receptor_rut: rutRecIdx, receptor_nombre: nomRecIdx, medio_pago: medioIdx },
      default_tipo_flujo: "entrada",
      columns: {
        fecha: fechaIdx,
        descripcion: glosaIdx,
        monto: montoIdx,
        cargo: montoIdx,
        abono: montoIdx,
        n_documento: -1,
        saldo: -1,
      },
    };
  }
  return null;
}

export function detectByNames(rows: Row[]): AdapterConfig | null {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i];
    if (!r) continue;
    const norm = r.map((c) => String(c ?? "").toLowerCase().trim());

    // "fecha" exacto o compuesto ("fecha transacción", "fecha movimiento"…).
    // findIndex toma la primera: en cartolas con Fecha Transacción + Fecha
    // Contable gana la de la transacción, que es la que corresponde al gasto.
    const fechaIdx = norm.findIndex((c) => c === "fecha" || c.startsWith("fecha "));

    // Simple template format: Fecha + Glosa + Monto (no cargo/abono)
    const glosaIdx = norm.findIndex((c) => c === "glosa");
    const montoIdx = norm.findIndex((c) => c === "monto");

    if (fechaIdx >= 0 && glosaIdx >= 0 && montoIdx >= 0 && !encabezadoBancario(r)) {
      // Columnas OPCIONALES de la plantilla extendida (2026-09-02): el cliente
      // puede clasificar tipo/receptor/medio de pago fila a fila. Se detectan
      // por prefijo del header ("Tipo (opcional)", "RUT receptor (opcional…)").
      const tipoIdx = norm.findIndex((c) => c.startsWith("tipo"));
      const rutRecIdx = norm.findIndex((c) => c.startsWith("rut receptor"));
      const nomRecIdx = norm.findIndex((c) => c.startsWith("nombre receptor"));
      const medioIdx = norm.findIndex((c) => c.startsWith("medio de pago"));
      return {
        header_row: i,
        skip_rows_before_data: i + 1,
        date_format: "dd/mm/yyyy",
        number_format: "chilean",
        layout: "transactions_log",
        plantilla: true,
        plantilla_cols: { tipo: tipoIdx, receptor_rut: rutRecIdx, receptor_nombre: nomRecIdx, medio_pago: medioIdx },
        default_tipo_flujo: "entrada",
        columns: {
          fecha: fechaIdx,
          descripcion: glosaIdx,
          monto: montoIdx,
          cargo: montoIdx,
          abono: montoIdx,
          n_documento: -1,
          saldo: -1,
        },
      };
    }

    // Bank cartola format: Fecha + Descripción + Cargo + Abono
    const descIdx = norm.findIndex((c) => c.includes("descripci"));
    // Vocabulario único (encabezados.ts). Un título que calza con salida Y entrada
    // ("CARGO/ABONO" de Santander) es una columna de TIPO, no de monto: con
    // includes() calzaba como cargo y abono a la vez, en el mismo índice.
    const t = r.map(normalizarTitulo);
    const esSalida = (c: string) => RE_SALIDA.test(c) && !RE_ENTRADA.test(c);
    const esEntrada = (c: string) => RE_ENTRADA.test(c) && !RE_SALIDA.test(c);
    const cargoIdx = t.findIndex(esSalida);
    const abonoIdx = t.findIndex(esEntrada);
    const ndocIdx = t.findIndex((c) => /^(n[°ºo.]?\s*)?(de\s+)?documento\b|\bn[°ºo.]?\s*(de\s+)?doc(umento)?\b/.test(c) && !/\btipo\b/.test(c));
    const saldoIdx = t.findIndex((c) => RE_SALDO.test(c) && !/\b(inicial|anterior|final)\b/.test(c));

    if (fechaIdx >= 0 && descIdx >= 0 && cargoIdx >= 0 && abonoIdx >= 0 && cargoIdx !== abonoIdx) {
      return {
        header_row: i,
        skip_rows_before_data: i + 1,
        date_format: "dd/mm/yyyy",
        number_format: derivarNumberFormat(rows as unknown[][], i + 1, [cargoIdx, abonoIdx, saldoIdx]),
        columns: {
          fecha: fechaIdx,
          descripcion: descIdx,
          n_documento: ndocIdx,
          cargo: cargoIdx,
          abono: abonoIdx,
          saldo: saldoIdx,
        },
      };
    }
  }
  return null;
}
