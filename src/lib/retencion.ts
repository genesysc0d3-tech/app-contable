// Retención / minimización de datos (Ley 19.628 vigente hoy; 21.719 dic-2026).
//
// La glosa cruda del banco (movimientos_raw.descripcion) puede contener el
// nombre y el RUT de un TERCERO que transfirió — dato personal NO consentido.
// El Código Tributario obliga a conservar la información contable 6 años; pasado
// ese plazo la política de privacidad declara eliminar o ANONIMIZAR.
//
// Anonimizamos la glosa (no borramos la fila): así el rastro contable hacia la
// boleta sobrevive (fecha, monto, dirección, vínculo) y solo se scrubbea el
// texto libre que carga el PII del tercero. Borrar la fila cascadearía a
// propuestas_ia y cortaría el enlace boleta→movimiento origen.

export const RETENCION_ANOS = 6;

// Reemplazo de la glosa caducada. Sin dígitos ni nombres: por construcción no
// puede contener PII de terceros. También sirve de centinela idempotente (el
// cron salta las filas ya anonimizadas con neq).
export const GLOSA_CADUCADA = "[glosa caducada por retención]";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * ISO del corte de retención. Las filas con `created_at` ANTERIOR a este valor
 * ya cumplieron los años y deben anonimizarse. El corte siempre queda en el
 * PASADO respecto de `nowMs` — nunca anonimiza datos recientes.
 */
export function cutoffRetencionISO(nowMs: number, anos = RETENCION_ANOS): string {
  return new Date(nowMs - anos * 365.25 * DIA_MS).toISOString();
}
