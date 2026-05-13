export interface MovimientoExtraido {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  origen: string;
  n_documento?: string | null;
  /** 1-based row in the original Excel sheet (only set in bypass path). */
  excel_row?: number;
  /** Running balance at this row, if cartola has saldo column (bypass only). */
  saldo?: number;
}

export interface PropuestaExtraida {
  movimiento_index: number;
  tipo_propuesto: "boleta" | "factura" | "gasto" | "registro_crypto" | "ignorar" | "boleta_honorarios" | "factura_afecta" | "compraventa_crypto" | "transferencia_p2p" | "operacion_forex" | "gasto_egreso" | "no_comercial";
  receptor_nombre: string | null;
  receptor_rut: string | null;
  monto_neto: number;
  iva: number;
  total: number;
  confianza: number;
  notas: string | null;
  spread_compra: number | null;
  spread_venta: number | null;
  spread_ganancia: number | null;
}

export interface AIExtractionResult {
  movimientos: MovimientoExtraido[];
  propuestas: PropuestaExtraida[];
}

export interface AIResponse {
  result: AIExtractionResult;
  tokens_input: number;
  tokens_output: number;
  modelo: string;
  finish_reason?: string | null;
  raw_response_length?: number;
}

export interface ClassifyOnlyResponse {
  propuestas: PropuestaExtraida[];
  tokens_input: number;
  tokens_output: number;
  modelo: string;
  finish_reason?: string | null;
  raw_response_length?: number;
}

export interface AIProvider {
  extractMovimientos(
    contenido: string,
    systemPrompt: string
  ): Promise<AIResponse>;
  /**
   * Classify a batch of already-extracted movimientos.
   * Used by the pre-extracted bypass path: the parser did deterministic
   * extraction so we only need Mistral to assign tipo_propuesto, receptor,
   * confianza, etc. — never touching fechas/montos.
   */
  classifyMovimientos?(
    movimientos: MovimientoExtraido[],
    systemPrompt: string
  ): Promise<ClassifyOnlyResponse>;

  /** Calculate cost in USD for given token usage. */
  getCost(tokensInput: number, tokensOutput: number): number;
}

export type TipoDuplicado =
  | "otro_doc_confirmado"    // 1: exists in another processed document
  | "mismo_ndoc_mismo_arch"  // 2: same n_documento within same file
  | "mismo_ndoc_otro_arch"   // 3: same n_documento in another file
  | "loose_mismo_arch"       // 4: same monto+desc+fecha no n_doc, same file
  | "loose_otro_arch"        // 5: same monto+desc+fecha no n_doc, other file
  | "multi_transfer_p2p";    // 6: multiple transfers to same person same day

export interface DuplicadoDetalle {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: string;
  n_documento?: string | null;
  tipo: TipoDuplicado;
  origen_movimiento_id: string;
  origen_documento_nombre: string;
  origen_documento_fecha: string;
  motivo: string;
  indice_archivo?: number;
  indice_conflicto?: number;
  /** Fila real del Excel (1-based) — preferida sobre indice_archivo cuando existe. */
  excel_row?: number;
  /** Fila real del Excel del registro con el que duplica. */
  excel_row_conflicto?: number;
  /**
   * Resultado positivo de la validación matemática del saldo para duplicados
   * intra-archivo. Solo se setea cuando `|saldo[i] − saldo[ref]| ≈ monto`
   * con tolerancia de ±1 peso, lo que prueba que son dos operaciones reales
   * separadas y no un duplicado de exportación.
   *
   * No usamos un valor negativo: cartolas filtradas (solo abonos) o con
   * orden no-cronológico estricto pueden tener movimientos intercalados
   * invisibles que rompen el cálculo, lo que daría falsos positivos
   * recomendando omitir transacciones legítimas. Mejor no clasificar.
   */
  saldo_check?: "operaciones_reales";
  repeticiones?: number;
  oculto?: boolean;
  /**
   * True when this entry is informational only: the movimiento was KEPT
   * in the database (not skipped) but flagged for the user to review.
   * Used in bypass mode for intra-file duplicates that are legitimately
   * separate transactions (e.g. multiple cargos same day same monto).
   */
  info_only?: boolean;
}

export interface ProgresoIA {
  estado: "procesando" | "completado" | "error";
  lote_actual?: number;
  total_lotes?: number;
  movimientos_encontrados?: number;
  duplicados_saltados?: number;
  duplicados_detalle?: DuplicadoDetalle[];
  falsos_duplicados_warning?: boolean;
  error?: string;
}
