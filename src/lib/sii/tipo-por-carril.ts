/**
 * Qué tipo tributario manda para CADA carril (boletas 39/41, facturas 33/34).
 *
 * Antes había un solo `empresas.tipo_contribuyente` que decidía las dos cosas,
 * y una empresa mixta —arriendo exento por un lado, servicios afectos por
 * otro— tenía que elegir una sola verdad. Ahora cada carril tiene el suyo.
 *
 * PUNTO ÚNICO A PROPÓSITO (2026-09-04): la regla vive acá y en ningún otro
 * lado. Hoy mismo nos mordieron tres bugs del mismo patrón —una condición
 * escrita para el mundo de ayer, repetida en varios archivos, que al aparecer
 * un caso nuevo quedó mal clasificada en silencio— así que la decisión de "qué
 * tipo aplica" no se vuelve a repartir por el código. Quien necesite saberlo
 * llama a esta función con la mesa del documento.
 *
 * Herencia: si el carril no tiene valor propio (NULL), manda el general de la
 * empresa. Así nada cambia para quien nunca tocó la configuración.
 */

export type TipoTributario = "afecto" | "exento" | "auto";
export type CarrilDocumento = "boleta" | "factura";

export interface EmpresaTipos {
  tipo_contribuyente?: string | null;
  boletas_tipo_default?: string | null;
  facturas_tipo_default?: string | null;
}

function normalizar(valor: string | null | undefined): TipoTributario | null {
  const v = (valor ?? "").trim().toLowerCase();
  return v === "afecto" || v === "exento" || v === "auto" ? v : null;
}

/**
 * El tipo que aplica a un documento de ese carril. `auto` significa "que decida
 * la clasificación": no es una respuesta tributaria, es la ausencia de una.
 */
export function tipoDelCarril(empresa: EmpresaTipos | null | undefined, carril: CarrilDocumento): TipoTributario {
  if (!empresa) return "auto";
  const propio = carril === "factura"
    ? normalizar(empresa.facturas_tipo_default)
    : normalizar(empresa.boletas_tipo_default);
  return propio ?? normalizar(empresa.tipo_contribuyente) ?? "auto";
}

/**
 * ¿Los documentos de este carril son exentos por configuración del emisor?
 *
 * OJO: esto NO decide sola. Una exención POR LEY (cripto, forex, P2P — Of. SII
 * 963/2018) manda siempre por encima de la configuración: el default puede
 * volver exento algo afecto, jamás afecto algo que la ley declaró exento. Esa
 * precedencia vive en el clasificador y no se toca desde acá.
 */
export function carrilEsExento(empresa: EmpresaTipos | null | undefined, carril: CarrilDocumento): boolean {
  return tipoDelCarril(empresa, carril) === "exento";
}
