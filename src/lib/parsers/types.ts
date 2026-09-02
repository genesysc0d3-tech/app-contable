// Shared types for the layered parser system.

export type Row = (string | number | null | undefined)[];

export interface AdapterConfig {
  header_row: number;
  skip_rows_before_data: number;
  date_format: "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "unknown";
  number_format: "chilean" | "generic";
  /**
   * Layout variants:
   *  - "two_cols": separate cargo and abono columns (Banco de Chile style)
   *  - "single_col": one monto column + one tipo_flujo column with values
   *    like "Abono"/"Cargo" or "Crédito"/"Débito"
   *  - "transactions_log": one monto column, no tipo flag, no saldo. Used
   *    for sales/income logs and exchange P2P exports where all rows are
   *    entradas implícitas (or salidas — see default_tipo_flujo).
   */
  layout?: "two_cols" | "single_col" | "transactions_log";
  /**
   * FIRMA de la plantilla massDTE (headers exactos Fecha|Glosa|Monto que emite
   * /api/generar-template). SOLO la pone detectByNames — la heurística también
   * emite layout transactions_log como last-resort para cartolas de una columna
   * (caso real: BCI editada por el cliente), así que el layout NO basta como
   * firma. Auditoría cerebro 2026-09-02.
   */
  plantilla?: boolean;
  /** Columnas OPCIONALES de la plantilla massDTE extendida (índices, -1 = no existe). */
  plantilla_cols?: { tipo: number; receptor_rut: number; receptor_nombre: number; medio_pago: number };
  /** Only meaningful when layout = "transactions_log". Default: "entrada". */
  default_tipo_flujo?: "entrada" | "salida";
  columns: {
    fecha: number;
    descripcion: number;
    n_documento: number; // -1 if not present
    cargo: number;        // two_cols: cargo column | single_col: ignored (use monto)
    abono: number;        // two_cols: abono column | single_col: ignored
    saldo: number;        // -1 if not present
    monto?: number;       // single_col only: the numeric amount column
    tipo_flujo_col?: number; // single_col only: text column with "Abono"/"Cargo"
  };
}

export interface AdapterRow {
  id: string;
  fingerprint: string;
  nombre: string | null;
  tipo_doc: string | null;
  source: "heuristic" | "named" | "mistral" | "manual";
  config: AdapterConfig;
  confianza: number;
  usage_count: number;
  success_count: number;
  failure_count: number;
  disabled_until: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    rows: number;
    entradas: number;
    salidas: number;
    sumEntradas: number;
    sumSalidas: number;
    minMonto: number;
    maxMonto: number;
    medianMonto: number;
  };
}

export interface ParsedLine {
  tipo: "ENTRADA" | "SALIDA";
  fecha: string;
  monto: number;
  descripcion: string;
  n_documento: string;
  /** Campos opcionales de la plantilla massDTE extendida (el cliente clasificó). */
  plantilla_tipo?: string | null;
  plantilla_receptor_rut?: string | null;
  plantilla_receptor_nombre?: string | null;
  plantilla_medio_pago?: string | null;
  /** 1-based row number in the original Excel sheet (for user-facing display). */
  excel_row?: number;
  /** Saldo de la fila si la cartola tiene columna saldo. Usado para validar duplicados. */
  saldo?: number;
}

export interface OrchestratorResult {
  content: string;              // Newline-joined lines, ready for processor
  capa_usada: number;           // Which layer succeeded (0, 2, 3, 4)
  fingerprint: string;
  adapter_id: string | null;    // Non-null if we used or created an adapter
  rows_extracted: number;
  validator_failed_checks: string[];
  warnings: string[];
  error: string | null;
  /**
   * Pre-extracted movimientos in the AI layer format. Populated whenever a
   * deterministic layer (0, 2, 3) succeeds, enabling the bypass path in the
   * processor that skips OpenCode extraction entirely.
   * `null` when the legacy fallback (layer 4) was used.
   */
  preExtracted: PreExtractedMovimiento[] | null;
  /** true solo si el adapter que parseó lleva la FIRMA de la plantilla massDTE. */
  plantilla: boolean;
}

export interface PreExtractedMovimiento {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  origen: string;
  n_documento: string | null;
  /** Campos opcionales de la plantilla massDTE extendida. */
  plantilla_tipo?: string | null;
  plantilla_receptor_rut?: string | null;
  plantilla_receptor_nombre?: string | null;
  plantilla_medio_pago?: string | null;
  excel_row?: number;
  saldo?: number;
}
