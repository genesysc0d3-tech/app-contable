export interface MovimientoExtraido {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  origen: string;
  n_documento?: string | null;
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
}

export interface AIProvider {
  extractMovimientos(
    contenido: string,
    systemPrompt: string
  ): Promise<AIResponse>;
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
  repeticiones?: number;
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
