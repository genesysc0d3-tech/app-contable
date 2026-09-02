import type { AdapterConfig, Row } from "./types";

/**
 * Legacy named-header detector: inspects the first ~50 rows looking for a
 * header row with specific Spanish bank-statement column names (Banco de
 * Chile style). Also detects the simplified "plantilla boletas" format
 * with Fecha, Glosa, Monto columns.
 */
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

    if (fechaIdx >= 0 && glosaIdx >= 0 && montoIdx >= 0) {
      return {
        header_row: i,
        skip_rows_before_data: i + 1,
        date_format: "dd/mm/yyyy",
        number_format: "chilean",
        layout: "transactions_log",
        plantilla: true,
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
    const cargoIdx = norm.findIndex(
      (c) => c.includes("cargo") || c.includes("cheques") || c.includes("débito") || c.includes("debito") || c.includes("egreso")
    );
    const abonoIdx = norm.findIndex(
      (c) => c.includes("abono") || c.includes("depósit") || c.includes("deposit") || c.includes("crédito") || c.includes("credito") || c.includes("ingreso")
    );
    const ndocIdx = norm.findIndex(
      (c) => c.includes("documento") || c === "n° documento" || c === "n documento"
    );
    const saldoIdx = norm.findIndex((c) => c.includes("saldo"));

    if (fechaIdx >= 0 && descIdx >= 0 && cargoIdx >= 0 && abonoIdx >= 0) {
      return {
        header_row: i,
        skip_rows_before_data: i + 1,
        date_format: "dd/mm/yyyy",
        number_format: "chilean",
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
