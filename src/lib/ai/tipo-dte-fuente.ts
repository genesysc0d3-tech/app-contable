/**
 * DE DÓNDE SALIÓ EL 39/41 al nacer una propuesta (Fase 1 medición). Se graba en
 * `propuestas_ia.orig_tipo_dte_fuente` (foto inmutable) para poder medir precisión
 * y cobertura POR FUENTE: regla de usuario, categoría exenta, auto determinista…
 *
 * Esta función solo EXPLICA: no decide. La decisión vive en processor.ts (el
 * insert de propuestas). `explicarTipoDte` replica su precedencia para poder
 * nombrar la rama; `fuenteTipoDteAlNacer` compara con lo que el processor
 * realmente persistió y, si no calzan (alguien cambió la decisión sin tocar esto),
 * devuelve 'desconocido' en vez de mentir — se ve al medir ("salud del sello").
 *
 * Lista cerrada: espejo del CHECK de la migración 20261004140000 (lo vigila
 * escrituras-propuestas.test.ts).
 */
import {
  decidirTipoDteAutoConMotivo,
  type ClasificacionResult,
  type DocumentoHint,
  type MotivoTipoDteAuto,
} from "@/lib/sii/clasificador-tipo";

export const FUENTES_TIPO_DTE = [
  // processor (cartolas)
  "salida_o_no_boletar",
  "categoria_exenta",
  "regla",
  "regla_forzada_exenta",
  "no_venta",
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
  // no informado / no calza con lo persistido
  "desconocido",
] as const;

export type FuenteTipoDte = (typeof FUENTES_TIPO_DTE)[number];

export type EntradaTipoDte = {
  /** entrada y no no_boletar (guardarraíl duro del processor). */
  puedePersistirTipo: boolean;
  /** puedePersistirTipo && tipo de VENTA auto (TIPOS_VENTA_AUTO). */
  esVentaCandidata: boolean;
  /** categoría exenta por naturaleza (P2P/cripto/forex/exenta). */
  exentoPorCategoria: boolean;
  /** tipo_dte que trae la regla de usuario (enriched.__tipo_dte). */
  reglaTipoDte: unknown;
  /** emisor exento en el carril (exentoFinal || empExento). */
  emisorExento: boolean;
  /** resultado de decidirTipoDteAutoConMotivo (null si no es venta candidata). */
  auto: { tipo: 39 | 41 | null; motivo: MotivoTipoDteAuto } | null;
};

/** Precedencia de processor.ts (cable de auto-clasificación de tipo_dte). Pura. */
export function explicarTipoDte(e: EntradaTipoDte): { tipoDte: 39 | 41 | null; fuente: FuenteTipoDte } {
  if (!e.puedePersistirTipo) return { tipoDte: null, fuente: "salida_o_no_boletar" };
  if (e.exentoPorCategoria) return { tipoDte: 41, fuente: "categoria_exenta" };
  if (e.reglaTipoDte === 39 || e.reglaTipoDte === 41) {
    if (e.emisorExento) return { tipoDte: 41, fuente: e.reglaTipoDte === 39 ? "regla_forzada_exenta" : "regla" };
    return { tipoDte: e.reglaTipoDte, fuente: "regla" };
  }
  if (!e.esVentaCandidata || !e.auto) return { tipoDte: null, fuente: "no_venta" };
  return { tipoDte: e.auto.tipo, fuente: `auto_${e.auto.motivo}` as FuenteTipoDte };
}

/**
 * Lo que el processor graba en `orig_tipo_dte_fuente`. Recibe las mismas variables
 * locales que usa la decisión + lo que se persistió de verdad.
 */
export function fuenteTipoDteAlNacer(args: {
  puedePersistirTipo: boolean;
  esVentaCandidata: boolean;
  exentoPorCategoria: boolean;
  reglaTipoDte: unknown;
  emisorExento: boolean;
  clasif: ClasificacionResult;
  docHint: DocumentoHint;
  tipoContribuyente?: string | null;
  tipoDtePersistido: number | null;
}): FuenteTipoDte {
  try {
    const auto = args.esVentaCandidata
      ? decidirTipoDteAutoConMotivo(args.clasif, { docHint: args.docHint, tipoContribuyente: args.tipoContribuyente })
      : null;
    const r = explicarTipoDte({ ...args, auto });
    return r.tipoDte === (args.tipoDtePersistido ?? null) ? r.fuente : "desconocido";
  } catch {
    return "desconocido"; // medir nunca rompe el insert
  }
}
