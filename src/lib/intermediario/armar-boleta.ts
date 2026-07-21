/**
 * ARMADOR DE PAYLOAD DE BOLETA — la fuente ÚNICA de verdad de qué información
 * lleva impresa una boleta, sin importar de qué carril venga (cartola/lote,
 * comprobante de Telegram, o boleta única).
 *
 * Antes, cada carril armaba la glosa/receptor/medio de pago a su manera:
 *   - lote: glosa = glosa cruda del banco, medio de pago fijo, ignoraba el
 *     detalle editado (`notas`) y la glosa común de la cartola.
 *   - boleta única: el detalle tipeado sí llegaba.
 * Resultado: "lo que editás" no era "lo que se emite". Esta función centraliza
 * esas reglas para que TODOS los carriles produzcan el mismo `BoletaInput`
 * (el contrato que ya valida `validarBoleta` y persiste cada endpoint).
 *
 * PURA (sin I/O) → testeable sin Supabase ni red.
 *
 * PROTECCIÓN DE DATOS (rev. 2026-07-05): la glosa NUNCA cae a la descripción cruda
 * del banco. Esa glosa trae nombre + RUT de un TERCERO ("TRANSFERENCIA DE JUAN PEREZ
 * 12.345.678-9") que no es cliente ni consintió — imprimirlo en el DTE viola la
 * minimización (Ley 19.628, ya vigente) y describe quién pagó, no qué se vendió. Si
 * no hay detalle editado ni glosa común, se usa un genérico neutro por tipo.
 */

import type { BoletaInput } from "../sii/validation";

/** Glosa impresa máx. 80 chars (campo Detalle del DTE en el SII). */
const GLOSA_MAX = 80;
/** Genérico neutro cuando no hay detalle ni glosa común. Nunca la glosa del banco. */
export const GLOSA_FALLBACK = "Servicio prestado";
export const GLOSA_FALLBACK_EXENTA = "Venta exenta";

export type GlosaFuentes = {
  /** Detalle que el humano editó a mano (máxima precedencia). */
  notas?: string | null;
  /** Glosa común de la cartola (aplica a todo el lote si está activa). */
  glosaComun?: string | null;
  glosaComunActiva?: boolean | null;
};

/**
 * Precedencia de la glosa de la boleta:
 *   detalle editado (`notas`)  ›  glosa común de la cartola (si activa)  ›  genérico por tipo.
 * NUNCA la glosa cruda del banco (dato personal de terceros). Recorta a 80, nunca vacío.
 */
export function resolverGlosa(f: GlosaFuentes, tipoDte?: 39 | 41): string {
  const notas = f.notas?.trim();
  if (notas) return notas.slice(0, GLOSA_MAX);
  if (f.glosaComunActiva && f.glosaComun?.trim()) return f.glosaComun.trim().slice(0, GLOSA_MAX);
  return tipoDte === 41 ? GLOSA_FALLBACK_EXENTA : GLOSA_FALLBACK;
}

export type PropuestaEmisionData = GlosaFuentes & {
  /** Tipo DTE ya decidido por el caller (clasificador o override de UI). */
  tipoDte: 39 | 41;
  /** Monto total bruto (CLP). */
  total: number;
  receptorRut?: string | null;
  receptorNombre?: string | null;
  receptorDireccion?: string | null;
  receptorComuna?: string | null;
  /** Medio de pago elegido en la propuesta (si el humano lo tocó). */
  medioPago?: string | null;
};

export type ArmarOpts = {
  /**
   * Medio de pago por defecto del carril cuando la propuesta no trae uno.
   * Ej.: en el lote masivo la cartola es siempre "Transferencia Electrónica".
   */
  medioPagoDefault?: string;
};

/**
 * Arma el `BoletaInput` canónico desde una propuesta. ÚNICO lugar donde se
 * deciden glosa, receptor, medio de pago y monto de la boleta.
 */
export function armarBoletaPayload(d: PropuestaEmisionData, opts?: ArmarOpts): BoletaInput {
  const total = Math.round(d.total);
  return {
    tipo_dte: d.tipoDte,
    receptor_rut: d.receptorRut?.trim() || undefined,
    receptor_razon_social: d.receptorNombre?.trim() || undefined,
    receptor_direccion: d.receptorDireccion?.trim() || undefined,
    receptor_comuna: d.receptorComuna?.trim() || undefined,
    medio_pago: d.medioPago?.trim() || opts?.medioPagoDefault || undefined,
    detalles: [{ nombre: resolverGlosa(d, d.tipoDte), monto: total }],
    monto_total: total,
  };
}
