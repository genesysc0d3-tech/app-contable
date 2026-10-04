/**
 * DE DÓNDE SALIÓ EL 39/41 al nacer una propuesta (Fase 1 medición). Se graba en
 * `propuestas_ia.orig_tipo_dte_fuente` (foto inmutable) para medir precisión y
 * cobertura POR FUENTE: regla de usuario, categoría exenta, auto determinista…
 *
 * En cartolas la fuente la entrega la PROPIA decisión (`decidirTipoDtePersistido`
 * → `.fuente`, en tipo-dte-persistido.ts): una sola lógica, nunca se desalinea.
 * Los otros caminos de nacimiento (Telegram, plantilla, factura única, cuadre)
 * usan su fuente fija. Un insert que no informa queda 'desconocido' (trigger).
 *
 * Lista cerrada: espejo del CHECK de la migración 20261004160000 (lo vigila
 * escrituras-propuestas.test.ts).
 */

export const FUENTES_TIPO_DTE = [
  // processor (cartolas) — ramas de decidirTipoDtePersistido
  "salida_o_no_boletar",
  "no_venta",
  "categoria_exenta",
  "regla",
  "regla_forzada_exenta",
  "conflicto_marca_cartola",
  "auto_empresa_exenta",
  "auto_no_firme",
  "auto_glosa_exenta",
  "auto_sin_tipo",
  "auto_contribuyente_afecto",
  "auto_glosa_afecta",
  "auto_hint_afecta",
  "auto_sin_evidencia_afecta",
  // otros caminos de nacimiento
  "telegram_comprobante",
  "telegram_asegurada",
  "telegram_manual",
  "plantilla_facturas",
  "factura_unica",
  "cuadre_cartola",
  // no informado
  "desconocido",
] as const;

export type FuenteTipoDte = (typeof FUENTES_TIPO_DTE)[number];
