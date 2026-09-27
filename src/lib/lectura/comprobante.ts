/**
 * Lectura DETERMINÍSTICA de un comprobante de transferencia a partir del texto
 * del OCR (plan del flujo OCR → determinístico → IA, PR 4/8, 2026-09-27).
 *
 * Una sola lectura para todos los carriles: nació dentro de la ingesta de
 * Telegram y se movió acá tal cual (mismo comportamiento, probado con golden
 * tests) para que la app — imagen suelta, PDF-comprobante, álbum — use el mismo
 * camino. Es PURA: sin base de datos ni red; las identidades del contribuyente
 * entran como parámetro (ver ./identidades.ts).
 *
 * Resultado:
 *  - "parsed"       → seguro: monto por consenso, dirección, fecha.
 *  - "ambiguous"    → hay señales en conflicto: la clienta debe aclarar.
 *  - "unrecognized" → no parece un comprobante: sigue la IA.
 */
import type { Json } from "@/lib/database.types";
import {
  destinoDesdeTextoTelegram,
  fechaDesdeTextoTelegram,
  lineasOcrTelegram,
  nombreContraparteTelegram,
  origenDesdeTextoTelegram,
  resolverDireccionTelegram,
  resolverMontoTelegram,
  rutDesdeTextoTelegram,
  tipoVentaDesdeTextoTelegram,
} from "@/lib/telegram/deterministico";

export function extraerCodigoTransaccion(text: string): string | null {
  const patterns = [
    /c[oó]digo\s+de\s+transacci[oó]n\s*:?\s*([a-z0-9?_-]+)/i,
    /n[uú]mero\s+de\s+operaci[oó]n(?:\s+de\s+[^\n]+)?\s*:?\s*([a-z0-9?_-]+)/i,
    /operaci[oó]n\s*(?:n[°ºo.]*)?\s*:?\s*([a-z0-9-]{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().toUpperCase();
  }
  return null;
}

export type ComprobanteLeido = {
  fecha: string;
  fechaVisible: boolean;
  /** La dirección salió de la identidad del contribuyente (no solo de un verbo). */
  direccionPorIdentidad: boolean;
  monto: number;
  tipo_flujo: "entrada" | "salida";
  contraparte_nombre: string | null;
  contraparte_rut: string | null;
  tipo_venta: "compraventa_crypto" | "operacion_forex" | null;
  descripcion: string;
  n_documento: string | null;
  diagnostico: Record<string, Json>;
};

export type ResultadoLectura =
  | { kind: "parsed"; parsed: ComprobanteLeido }
  | { kind: "ambiguous"; motivo: string; diagnostico: Record<string, Json>; aclaracion?: Aclaracion }
  | { kind: "unrecognized" };

/**
 * Lo que la lectura dejó resuelto cuando algo quedó AMBIGUO, más qué falta
 * preguntarle a la clienta (plan PR 7/8: "si no está seguro, que aclare"). Con
 * su respuesta, `completarComprobante` arma la misma lectura que una segura.
 */
export type Aclaracion = {
  pendientes: Array<"monto" | "direccion">;
  /** Montos candidatos distintos que vio el lector (si falta el monto). */
  opcionesMonto: number[];
  monto: number | null;
  tipo_flujo: "entrada" | "salida" | null;
  direccionPorIdentidad: boolean;
  fecha: string;
  fechaVisible: boolean;
  n_documento: string | null;
  origen: string;
  destino: string;
  rut: string | null;
  tipoVentaSiEntrada: "compraventa_crypto" | "operacion_forex" | null;
};

export function leerComprobante(
  ocrText: string,
  ctx: { identidades: string[]; fechaFallback: string },
): ResultadoLectura {
  const { identidades, fechaFallback } = ctx;
  const lines = lineasOcrTelegram(ocrText);
  const text = lines.join("\n");
  // "transferiste/enviaste/te transfirió" = el pantallazo típico del comprador
  // (antes no calzaba con "transferenc" y se iba entero a la IA, 2026-09-27).
  const pareceTransferencia = /transferenc|transferiste|te transfiri|enviaste|recibiste|pagaste|abono|monto\s+transferid|a la cuenta|cuenta destino|destinatario/i.test(text);
  const pareceComprobante = /comprobante/i.test(text);
  if (!pareceTransferencia && !pareceComprobante) return { kind: "unrecognized" };

  const monto = resolverMontoTelegram(lines);
  const destino = destinoDesdeTextoTelegram(lines);
  const origen = origenDesdeTextoTelegram(lines);
  const direccion = resolverDireccionTelegram({ text, destino, origen, identidades });
  const fecha = fechaDesdeTextoTelegram(lines, fechaFallback);
  const rutCrudo = rutDesdeTextoTelegram(text);
  // RUT de la contraparte, descartando el de la propia empresa.
  const rut = rutCrudo && !identidades.some((id) => id.replace(/[.\-\s]/g, "") === rutCrudo.replace(/[.\-\s]/g, "")) ? rutCrudo : null;
  const base: Aclaracion = {
    pendientes: [],
    opcionesMonto: [],
    monto: monto.decision?.monto ?? null,
    tipo_flujo: direccion?.tipo_flujo ?? null,
    direccionPorIdentidad: direccion ? direccion.decision !== "verbal_fuerte" : false,
    fecha: fecha.fecha,
    fechaVisible: fecha.visible,
    n_documento: extraerCodigoTransaccion(text),
    origen,
    destino,
    rut,
    tipoVentaSiEntrada: tipoVentaDesdeTextoTelegram(text),
  };

  if (!monto.decision) {
    if (!pareceTransferencia) return { kind: "unrecognized" };
    const opciones = [...new Set((monto.diagnostics.votos ?? []).map((v) => v.monto))].slice(0, 3);
    return {
      kind: "ambiguous",
      motivo: monto.ambiguous ? "monto_conflictivo" : "monto_sin_consenso",
      diagnostico: {
        monto_parser: monto.diagnostics as Json,
      },
      aclaracion: { ...base, pendientes: direccion ? ["monto"] : ["monto", "direccion"], opcionesMonto: opciones },
    };
  }

  if (!direccion) {
    if (!pareceTransferencia) return { kind: "unrecognized" };
    return {
      kind: "ambiguous",
      motivo: "direccion_sin_consenso",
      diagnostico: {
        monto_elegido: monto.decision.monto,
        linea_monto: monto.decision.linea_monto,
        monto_parser: monto.diagnostics as Json,
        direccion_parser: { destino_detectado: destino, origen_detectado: origen } as Json,
      },
      aclaracion: { ...base, pendientes: ["direccion"] },
    };
  }

  const leido = construirLeido(base, monto.decision.monto, direccion.tipo_flujo);
  leido.diagnostico = {
    monto_elegido: monto.decision.monto,
    linea_monto: monto.decision.linea_monto,
    candidatos_descartados: monto.diagnostics.candidatos_descartados as Json,
    consenso_monto: monto.diagnostics as Json,
    direccion_decision: direccion as unknown as Json,
    fecha_elegida: fecha.fecha,
    fecha_visible: fecha.visible,
    linea_fecha: fecha.linea ?? null,
    decision_fecha: fecha.decision,
  };
  return { kind: "parsed", parsed: leido };
}

/** Arma la lectura final a partir de las piezas + monto y dirección ya decididos. */
function construirLeido(a: Aclaracion, monto: number, tipoFlujo: "entrada" | "salida"): ComprobanteLeido {
  const fuenteContraparte = tipoFlujo === "entrada" ? a.origen : a.destino;
  const contraparte = nombreContraparteTelegram(fuenteContraparte || (tipoFlujo === "entrada" ? "cliente" : "destinatario"));
  // Contraparte REAL = nombre extraído de una etiqueta (no el fallback genérico ni un número).
  const contraparteReal = fuenteContraparte && contraparte && !/^(cliente|destinatario)$/i.test(contraparte) && /[a-záéíóúñ]/i.test(contraparte) ? contraparte : null;
  // Tipo de venta (crypto/forex = exenta por ley) solo para entradas (ventas).
  const tipoVenta = tipoFlujo === "entrada" ? a.tipoVentaSiEntrada : null;
  const etiqueta = tipoVenta === "compraventa_crypto" ? "Venta de cripto" : tipoVenta === "operacion_forex" ? "Venta de divisa" : "Transferencia recibida";
  return {
    fecha: a.fecha,
    fechaVisible: a.fechaVisible,
    direccionPorIdentidad: a.direccionPorIdentidad,
    monto,
    tipo_flujo: tipoFlujo,
    contraparte_nombre: contraparteReal,
    contraparte_rut: a.rut,
    tipo_venta: tipoVenta,
    descripcion: tipoFlujo === "entrada"
      ? `${etiqueta} de ${contraparte} por $${monto.toLocaleString("es-CL")}`
      : `Transferencia a ${contraparte} por $${monto.toLocaleString("es-CL")}`,
    n_documento: a.n_documento,
    diagnostico: {},
  };
}

/**
 * La clienta respondió lo que faltaba: arma la lectura igual que una segura. La
 * dirección que ELLA eligió cuenta como identidad (lo sabe ella, no un verbo).
 * null si todavía falta algo (hay que hacerle la siguiente pregunta).
 */
export function completarComprobante(
  a: Aclaracion,
  respuesta: { monto?: number; tipo_flujo?: "entrada" | "salida" },
): ComprobanteLeido | null {
  const monto = respuesta.monto ?? a.monto;
  const tipoFlujo = respuesta.tipo_flujo ?? a.tipo_flujo;
  if (monto == null || !tipoFlujo) return null;
  const leido = construirLeido(
    { ...a, direccionPorIdentidad: respuesta.tipo_flujo ? true : a.direccionPorIdentidad },
    monto,
    tipoFlujo,
  );
  leido.diagnostico = { aclarado_por_clienta: respuesta as unknown as Json };
  return leido;
}

/**
 * Álbum (varias imágenes de UNA venta: orden, chat, comprobante): cada imagen se
 * lee por separado. Si hay al menos una lectura segura y todas las seguras
 * coinciden en monto y dirección, es una sola operación → devuelve el texto de
 * ese comprobante. Si no hay ninguna segura, o hay montos/direcciones distintos,
 * null → el álbum sigue a la IA. (plan PR 6/8)
 */
export function elegirComprobanteDelAlbum(
  textos: string[],
  ctx: { identidades: string[]; fechaFallback: string },
): string | null {
  const seguras: Array<{ texto: string; parsed: ComprobanteLeido }> = [];
  for (const texto of textos) {
    const r = leerComprobante(texto, ctx);
    if (r.kind === "parsed") seguras.push({ texto, parsed: r.parsed });
  }
  if (seguras.length === 0) return null;
  const operaciones = new Set(seguras.map((x) => `${x.parsed.monto}:${x.parsed.tipo_flujo}`));
  return operaciones.size === 1 ? seguras[0].texto : null;
}
