// Shared types for the layered parser system.

export type Row = (string | number | null | undefined)[];

export interface AdapterConfig {
  header_row: number;
  skip_rows_before_data: number;
  date_format: "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "unknown";
  number_format: "chilean" | "generic";
  columns: {
    fecha: number;
    descripcion: number;
    n_documento: number; // -1 if not present
    cargo: number;
    abono: number;
    saldo: number; // -1 if not present
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
   * processor that skips Mistral extraction entirely.
   * `null` when the legacy fallback (layer 4) was used.
   */
  preExtracted: PreExtractedMovimiento[] | null;
}

export interface PreExtractedMovimiento {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  origen: string;
  n_documento: string | null;
}
