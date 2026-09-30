// Shared types for the layered parser system.

export type Row = (string | number | null | undefined)[];

export interface AdapterConfig {
  header_row: number;
  skip_rows_before_data: number;
  /** mm/dd/yyyy solo si la COLUMNA lo prueba (algún "09/13/2026"); en Chile, dd/mm por defecto. */
  date_format: "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "mm/dd/yyyy" | "unknown";
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
  /**
   *  - "monto_con_signo": UNA columna de monto con signo (negativo = cargo,
   *    positivo = abono), como Banco Falabella (vuelta 2, P5).
   */
  layout?: "two_cols" | "single_col" | "transactions_log" | "monto_con_signo";
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
  /**
   * Títulos normalizados de la fila de encabezado con que se derivó el mapa.
   * Sirve para avisar un cambio de formato: "esperaba encabezado X, llegó Y".
   */
  titulos?: string[];
  /**
   * Huella (sha256 corto) de la cuenta BANCARIA de la cartola con que se derivó
   * el mapa: el consenso global exige cuentas bancarias distintas (vuelta 2, N1).
   */
  cuenta_huella?: string;
  /** Only meaningful when layout = "transactions_log". Default: "entrada". */
  default_tipo_flujo?: "entrada" | "salida";
  /**
   * El cliente revisó las columnas de UN documento en el popup "Revisa las
   * columnas" y dijo "Listo" (o "solo abonos"). El reproceso de ESE documento,
   * si lee exactamente lo mismo (`firma`), queda sellado `cliente`. Otras
   * cartolas del formato no heredan el sello: solo usan el mapa confirmado.
   */
  revision_cliente?: { documento_id: string; firma: string; solo_abonos?: boolean };
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
  source: "heuristic" | "named" | "mistral" | "manual" | "ia_estructura";
  config: AdapterConfig;
  confianza: number;
  /**
   * provisorio = derivado por heurística/nombres/IA y SIN prueba; confirmado =
   * lo probó el saldo o el total del banco, o lo confirmó el cliente. Ausente
   * (columna aún no migrada en prod) = provisorio (fail-safe).
   */
  estado?: "provisorio" | "confirmado" | null;
  confirmado_por?: string | null;
  creado_por_empresa_id?: string | null;
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
  /** El monto venía como TEXTO en la celda ("$100"): la fórmula SUMA del banco no lo cuenta. */
  monto_texto?: boolean;
  /** Saldo de la fila si la cartola tiene columna saldo. Usado para validar duplicados. */
  saldo?: number;
  /** Filas (1-based) de continuación de glosa pegadas a este movimiento (glosa partida en 2 filas). */
  filas_glosa_continuada?: number[];
}

/**
 * Una fila de la hoja con PLATA (algún monto distinto de cero) que el lector no
 * convirtió en movimiento. `legitimo` = fila de totales/saldos/resumen, que no es
 * una transacción; todo lo demás es una pérdida y se reporta.
 */
export interface DescarteFila {
  excel_row: number;
  /**
   * monto_ambiguo: la columna mezcla formatos ("1.234.567" y "250,000") y la
   *   celda no se puede leer sin adivinar (numeros.ts).
   * sin_leer: el censo INDEPENDIENTE del mapeo vio fecha + plata en la fila y el
   *   mapeo no la leyó ni la descartó (plata en una columna que el mapa no mira).
   */
  /**
   * fila_de_saldo: fila CON fecha y plata cuya glosa empieza con "SALDO INICIAL/
   *   FINAL…" y cuyo monto no es su propio saldo: no se lee como movimiento (no
   *   es una venta) ni se esconde como resumen (una palabra no basta).
   */
  motivo: "sin_fecha" | "fecha_ilegible" | "fecha_imposible" | "fecha_fuera_de_rango" | "tipo_desconocido" | "cargo_y_abono" | "resumen" | "monto_ambiguo" | "sin_leer" | "fila_de_saldo";
  legitimo: boolean;
  fecha: string | null;
  monto: number;
  tipo_flujo: "entrada" | "salida" | null;
  descripcion: string;
  /** La celda de fecha tal como vino (diagnóstico: "32/13/2026", un serial…). */
  fecha_cruda?: string | null;
  /** Subtotal (del día) reconocido por estructura: no es el total de la cartola. */
  subtotal?: boolean;
}

/**
 * SELLO de verificación de una cartola (2026-09-30). Qué PRUEBA respalda la
 * lectura — nunca un "OK" implícito porque ningún chequeo protestó:
 *   saldo         el saldo corrido cierra la ecuación fila a fila
 *   total_banco   el resumen/total/fórmula SUM impreso por el banco calza al peso
 *   cliente       el cliente revisó las columnas de ESTA cartola y dijo "Listo"
 *   sin_comprobar no hay prueba (o algo la contradice): se pide confirmación
 */
export type TipoVerificacion = "saldo" | "total_banco" | "cliente" | "sin_comprobar";
export interface VerificacionCartola {
  tipo: TipoVerificacion;
  /** Por qué (en castellano, para el log y la UI). */
  detalle: string;
  /**
   * Algo CONTRADICE la lectura (el banco no calza, plata sin leer, monto
   * ambiguo, dos opiniones distintas, cambio de formato): hay que mirar aunque
   * el mapa esté confirmado.
   */
  alerta?: boolean;
  /**
   * La cartola trae UNA sola dirección y cada salto del saldo se explica por
   * movimientos del otro signo que no vienen (export filtrado "solo abonos").
   * No hay sello, pero el cliente puede confirmarla explícitamente (vuelta 2, N4).
   */
  filtrada?: "abonos" | "cargos";
  /**
   * Sin sello pleno por algo que solo el cliente puede juzgar (la primera fila no
   * se pudo comprobar; el signo del monto no dice la dirección): se le pide
   * revisar las columnas aunque el mapa ya estuviera confirmado (vuelta 3).
   */
  revisar?: boolean;
  /**
   * El BANCO contradice la lectura: el total/resumen impreso no calza ("banco")
   * o el saldo corrido no cierra ("saldo"). Con esto un mapa no se puede guardar
   * como bueno en el popup "Revisa las columnas" (tampoco en el server).
   */
  contradice?: "banco" | "saldo";
}

/** Estado del mapa de columnas con que se leyó la cartola. */
export interface MapaUsado {
  adapter_id: string | null;
  estado: "provisorio" | "confirmado";
  /** true si el mapa se derivó en ESTA lectura (formato nuevo para la empresa). */
  nuevo: boolean;
  /** Aviso de cambio de formato ("esperaba encabezado X, llegó Y"). */
  cambio_formato?: string | null;
  /** Dos opiniones (lector + IA de estructura) que no coincidieron. */
  disputa?: string | null;
  /** Con qué se confirmó el mapa (saldo, total_banco, cliente, manual…), si se sabe. */
  confirmado_por?: string | null;
}

/** Censo de la hoja leída: toda fila con plata queda contada. */
export interface CensoCartola {
  hoja: string;
  filas_con_monto: number;
  leidas: number;
  descartes: DescarteFila[];
  /** Otras hojas del libro que parecen traer movimientos y NO se leyeron. */
  otras_hojas_con_datos: string[];
  /**
   * Filas (N° de fila de Excel) OCULTAS que traen plata: un filtro o filas
   * escondidas. Se leen igual, pero la cartola no se sella y se muestran
   * (batería de sellos falsos, 2026-09-30).
   */
  filas_ocultas?: number[];
  /** Sello de verificación de la lectura (ausente en censos viejos). */
  verificacion?: VerificacionCartola;
  /** Saldo al inicio / al final del período, si la cartola permite saberlo. */
  saldo_inicial?: number | null;
  saldo_final?: number | null;
  /** Cuenta bancaria del encabezado (huella + últimos 4), para encadenar cartolas. */
  cuenta?: { huella: string; sufijo: string } | null;
  mapa?: MapaUsado;
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
  /** Censo de filas de la hoja leída (null en la capa 4 legacy/IA). */
  censo?: CensoCartola | null;
  /** true solo si el adapter que parseó lleva la FIRMA de la plantilla massDTE. */
  plantilla: boolean;
  /** Sello de verificación (null en la capa 4 legacy/IA: nada que sellar). */
  verificacion?: VerificacionCartola | null;
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
