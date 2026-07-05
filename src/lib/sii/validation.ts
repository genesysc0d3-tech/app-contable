/**
 * Validaciones que el SII real aplica a boletas electrónicas.
 * Replican las reglas reales para que el flujo se sienta como producción.
 */

const IVA_RATE = 0.19;
/**
 * Res. Ex. SII N°44/2025 (vigente desde 01-09-2025): en boletas electrónicas
 * que superen 135 UF por operación debe identificarse al comprador (RUT,
 * nombre y apellido, medio de pago, detalle del producto/servicio).
 * NO existe restricción ni umbral a $180.000 — la regla anterior era errónea
 * (confirmado por el contador del equipo, 2026-06).
 * La UF del día se obtiene en runtime vía lib/sii/uf.ts (mindicador.cl con
 * caché 12h); estas constantes son el FALLBACK si la API no responde y el
 * default síncrono de validarBoleta cuando no se inyecta el umbral.
 */
export const UMBRAL_IDENTIFICACION_UF = 135;
export const UF_REFERENCIA_CLP = 40_611; // fallback referencial — la fuente viva es uf.ts
export const RECEPTOR_OBLIGATORIO_DESDE = UMBRAL_IDENTIFICACION_UF * UF_REFERENCIA_CLP; // ≈ $5.482.485

/**
 * Predicado ÚNICO del umbral de identificación (Res. Ex. SII 44/2025): sobre él,
 * el receptor es OBLIGATORIO; en o bajo él, OPCIONAL. Lo usa tanto la validación
 * de emisión (exigir el receptor) como el clasificador (minimizar: no guardar la
 * identidad del tercero bajo umbral, Ley 19.628). Una sola fuente de verdad: el
 * dato que se guarda es exactamente el que la emisión podría exigir.
 */
export function receptorObligatorio(totalClp: number, umbralClp: number): boolean {
  return totalClp > umbralClp;
}

export type DteAfecto = 39;
export type DteExento = 41;
export type DteNotaCredito = 61;
export type TipoDTE = DteAfecto | DteExento | DteNotaCredito;

// ============================================================
// RUT validation — algoritmo módulo 11 oficial (SII)
// ============================================================

export function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toUpperCase();
}

export function formatRut(rut: string): string {
  const clean = cleanRut(rut);
  if (clean.length < 2) return rut;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

export function validarRut(rut: string): boolean {
  const clean = cleanRut(rut);
  if (!/^[0-9]+[0-9K]$/.test(clean) || clean.length < 2 || clean.length > 10) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number.parseInt(body[i]!, 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  const dvCalc = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return dvCalc === dv;
}

// ============================================================
// Cálculo IVA y validación matemática
// ============================================================

/** Calcula IVA al 19% redondeado al peso entero (como exige SII). */
export function calcularIVA(neto: number): number {
  return Math.round(neto * IVA_RATE);
}

/**
 * Dado un total bruto, descompone en neto + IVA con redondeo al peso.
 * Útil cuando el usuario ingresa el total final y no el neto.
 */
export function descomponerBruto(total: number): { neto: number; iva: number; total: number } {
  // total = neto * 1.19 → neto = total / 1.19
  const neto = Math.round(total / (1 + IVA_RATE));
  const iva = total - neto;
  return { neto, iva, total };
}

// ============================================================
// Línea de detalle
// ============================================================

export interface DetalleLinea {
  nombre: string;
  cantidad?: number;
  precio_unitario?: number;
  monto: number;
}

export interface BoletaInput {
  tipo_dte: DteAfecto | DteExento;
  receptor_rut?: string;
  receptor_razon_social?: string;
  receptor_direccion?: string;
  receptor_comuna?: string;
  /** Obligatorio en operaciones sobre 135 UF (Res. Ex. SII 44/2025). */
  medio_pago?: string | null;
  detalles: DetalleLinea[];
  /** Si se provee, se usa como override; si no, se calcula desde detalles. */
  monto_total?: number;
}

export type ValidationError = { code: string; message: string };

/**
 * Aplica TODAS las validaciones del SII para boleta tipo 39/41.
 * Retorna [] si todo OK, o array de errores.
 */
export function validarBoleta(
  input: BoletaInput,
  opts?: {
    /**
     * Umbral de identificación del comprador en pesos (135 UF al día). Las
     * rutas server lo resuelven con getUmbralIdentificacionClp() (UF viva);
     * sin opts se usa la constante referencial — la función sigue síncrona.
     */
    umbralIdentificacionClp?: number;
  },
): {
  ok: boolean;
  errors: ValidationError[];
  /** Computed totals (canonical, used for storage) */
  totales?: { neto: number; exento: number; iva: number; total: number };
} {
  const errors: ValidationError[] = [];
  const umbralIdentificacion = opts?.umbralIdentificacionClp ?? RECEPTOR_OBLIGATORIO_DESDE;

  // --- Detalle obligatorio ---
  if (!input.detalles || input.detalles.length === 0) {
    errors.push({ code: "DETALLE_VACIO", message: "Debe haber al menos una línea de detalle" });
  }
  for (const [i, d] of (input.detalles ?? []).entries()) {
    if (!d.nombre || !d.nombre.trim()) {
      errors.push({ code: "LINEA_SIN_NOMBRE", message: `Línea ${i + 1}: falta nombre del item` });
    }
    if (typeof d.monto !== "number" || d.monto <= 0) {
      errors.push({ code: "LINEA_MONTO_INVALIDO", message: `Línea ${i + 1}: monto debe ser > 0` });
    }
    if (!Number.isInteger(d.monto)) {
      errors.push({ code: "LINEA_MONTO_NO_ENTERO", message: `Línea ${i + 1}: monto debe ser entero (sin decimales)` });
    }
  }

  // --- Totales calculados desde el detalle ---
  const sumaDetalle = (input.detalles ?? []).reduce((s, d) => s + (d.monto ?? 0), 0);
  const totalProvisto = input.monto_total ?? sumaDetalle;

  if (totalProvisto <= 0) {
    errors.push({ code: "MONTO_TOTAL_INVALIDO", message: "El monto total debe ser mayor a 0" });
  }

  // Tolerancia de redondeo ±1 peso entre suma de detalle y monto_total
  if (input.monto_total !== undefined && Math.abs(input.monto_total - sumaDetalle) > 1) {
    errors.push({
      code: "DETALLE_NO_CUADRA",
      message: `Suma del detalle ($${sumaDetalle.toLocaleString("es-CL")}) no coincide con el total ($${input.monto_total.toLocaleString("es-CL")})`,
    });
  }

  // --- Cómputo de neto/IVA según tipo ---
  let neto = 0, exento = 0, iva = 0;
  if (input.tipo_dte === 39) {
    // Boleta afecta — el total es BRUTO, descomponer
    const dec = descomponerBruto(totalProvisto);
    neto = dec.neto;
    iva = dec.iva;
  } else if (input.tipo_dte === 41) {
    // Boleta exenta — total = exento, sin IVA
    exento = totalProvisto;
  }

  // --- Identificación del comprador sobre 135 UF (Res. Ex. SII 44/2025) ---
  if (receptorObligatorio(totalProvisto, umbralIdentificacion)) {
    if (!input.receptor_rut) {
      errors.push({
        code: "RECEPTOR_RUT_OBLIGATORIO",
        message: `Operación sobre ${UMBRAL_IDENTIFICACION_UF} UF (~$${umbralIdentificacion.toLocaleString("es-CL")}): la normativa exige RUT del comprador (Res. Ex. SII 44/2025)`,
      });
    }
    if (!input.receptor_razon_social || !input.receptor_razon_social.trim()) {
      errors.push({
        code: "RECEPTOR_RAZON_SOCIAL_OBLIGATORIA",
        message: `Operación sobre ${UMBRAL_IDENTIFICACION_UF} UF (~$${umbralIdentificacion.toLocaleString("es-CL")}): la normativa exige nombre del comprador (Res. Ex. SII 44/2025)`,
      });
    }
    if (!input.medio_pago || !input.medio_pago.trim()) {
      errors.push({
        code: "MEDIO_PAGO_OBLIGATORIO",
        message: `Operación sobre ${UMBRAL_IDENTIFICACION_UF} UF (~$${umbralIdentificacion.toLocaleString("es-CL")}): la normativa exige registrar el medio de pago (Res. Ex. SII 44/2025)`,
      });
    }
  }

  // --- RUT receptor válido (si se provee) ---
  if (input.receptor_rut && !validarRut(input.receptor_rut)) {
    errors.push({ code: "RUT_INVALIDO", message: `RUT receptor inválido: ${input.receptor_rut}` });
  }

  // --- Tipo DTE consistente ---
  if (input.tipo_dte !== 39 && input.tipo_dte !== 41) {
    errors.push({ code: "TIPO_DTE_INVALIDO", message: "Solo se permite tipo 39 (afecta) o 41 (exenta) en este endpoint" });
  }

  return {
    ok: errors.length === 0,
    errors,
    totales: errors.length === 0 ? { neto, exento, iva, total: totalProvisto } : undefined,
  };
}
