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

export interface DuplicadoDetalle {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo_flujo: string;
  n_documento?: string | null;
  origen_movimiento_id: string;
  origen_documento_nombre: string;
  origen_documento_fecha: string;
  motivo: string;
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
