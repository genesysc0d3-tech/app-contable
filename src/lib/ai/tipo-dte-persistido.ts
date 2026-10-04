/**
 * Cable de auto-clasificación de tipo_dte (extraído de processor.ts, PURO y testeable).
 *
 * Persistir tipo_dte apaga `sinDecisionHumana` en el gate (la propuesta nace en
 * "listas", no rebota a Check). Solo cuando la decisión es DETERMINISTA — no un guess
 * de la IA: (1) regla de usuario, (2) empresa EXENTA (siempre 41), (3) hint de la
 * cartola, o (4) glosa inequívoca. Gated a VENTAS de entrada (destino único,
 * `@/lib/sii/destino`) y NUNCA sobre no_boletar (préstamo/cuenta propia/sueldo se
 * apartan aunque la cartola sea cripto).
 */
import { decidirTipoDteAutoConMotivo, type ClasificacionResult, type DocumentoHint } from "@/lib/sii/clasificador-tipo";
import type { FuenteTipoDte } from "./tipo-dte-fuente";
import { esExentoPorTipo, esVentaEmitible, FUENTE_CONFLICTO_MARCA } from "@/lib/sii/destino";

export interface DecidirTipoDteInput {
  /** tipo_flujo del movimiento ("entrada" | "salida"). */
  tipoFlujo: string | null | undefined;
  /** tipo_propuesto normalizado (antes de normalizar por emisor exento). */
  tipoBase: string;
  /** Resultado de clasificarBoleta para este movimiento. */
  clasif: ClasificacionResult;
  /** Marca de la cartola puesta por el usuario ("toda P2P cripto", "forex"…). */
  docHint: DocumentoHint;
  tipoContribuyente?: string | null;
  /** tipo_dte recordado por la regla que calzó (solo reglas de usuario lo traen). */
  reglaTipoDte: number | null | undefined;
  /** El emisor (empresa o carril) es exento → nunca 39. */
  emisorExento: boolean;
  /**
   * La regla 39 ya fue CONFIRMADA por una persona sobre una cartola marcada P2P/forex
   * (eligió "Afecta" en una fila "¿?"): no se vuelve a preguntar → corta el loop.
   */
  reglaConfirmadaEnMarca?: boolean;
}

export interface DecidirTipoDteResultado {
  tipoDte: 39 | 41 | null;
  /** Lo que habría decidido el auto (sin regla); sube la confianza a bulk-elegible. */
  tipoDteAuto: 39 | 41 | null;
  /**
   * La regla dijo 39 pero la cartola está marcada P2P/forex (exenta por ley): no se
   * estampa nada y la fila queda a revisar (familia del incidente 2026-09-24).
   */
  conflictoMarcaCartola: boolean;
  /**
   * Qué rama decidió (Fase 1 medición): se graba como orig_tipo_dte_fuente, la foto
   * inmutable al nacer. Sale de ESTA función, así nunca se desalinea de la decisión.
   */
  fuente: FuenteTipoDte;
}

const HINTS_EXENTOS_POR_LEY: ReadonlySet<string> = new Set(["p2p_cripto", "forex_divisas"]);

/** La cartola está marcada como exenta por ley (P2P cripto / forex). */
export function esHintExentoPorLey(h: string | null | undefined): boolean {
  return h != null && HINTS_EXENTOS_POR_LEY.has(h);
}

/**
 * Confianza con que la regla aprendida queda marcada como "Afecta confirmada sobre
 * una cartola P2P/forex" (aprender-regla.ts). Las reglas de usuario normales usan 0.95.
 */
export const CONFIANZA_REGLA_CONFIRMADA_EN_MARCA = 0.99;

/** Techo de confianza de una fila "por decidir": bajo BULK_MIN_CONFIANZA (0.8) → no entra a "Poner listas". */
export const CONFIANZA_MAX_POR_DECIDIR = 0.5;

/**
 * Una fila en conflicto regla↔marca nace "por decidir" DE HECHO: fuente
 * FUENTE_CONFLICTO_MARCA (destinoPropuesta → "preguntar": Check la muestra "¿?",
 * Emitir y los jobs no la emiten) y confianza bajo el umbral del bulk.
 */
export function ajustarPorConflicto(
  conflicto: boolean,
  actual: { confianza: number | null; fuente: string },
): { confianza: number | null; fuente: string } {
  if (!conflicto) return actual;
  return { confianza: Math.min(actual.confianza ?? 0, CONFIANZA_MAX_POR_DECIDIR), fuente: FUENTE_CONFLICTO_MARCA };
}

export function decidirTipoDtePersistido(i: DecidirTipoDteInput): DecidirTipoDteResultado {
  // GUARDARRAÍL DURO: nunca persistir tipo_dte sobre un no_boletar (préstamo/cuenta
  // propia/sueldo/aporte capital/devolución) ni sobre una SALIDA. Vale para TODOS los
  // orígenes (regla de usuario, auto o exento).
  const puedePersistirTipo = i.tipoFlujo === "entrada" && i.clasif.sugerencia !== "no_boletar";
  // Solo una VENTA (destino boleta/factura) recibe tipo_dte. Arriendo/comisión
  // ("preguntar") y las no-ventas nacen sin tipo, aunque una regla traiga uno.
  const esVentaCandidata = puedePersistirTipo && esVentaEmitible(i.tipoBase);
  // Política de auto-persistencia: el default de cuenta NO cortocircuita, y un 39
  // exige evidencia real. El hint por-cartola y el exento sí son autoritativos.
  const auto = !esVentaCandidata
    ? null
    : decidirTipoDteAutoConMotivo(i.clasif, { docHint: i.docHint, tipoContribuyente: i.tipoContribuyente });
  const tipoDteAuto: 39 | 41 | null = auto?.tipo ?? null;
  const r = (tipoDte: 39 | 41 | null, fuente: FuenteTipoDte, conflictoMarcaCartola = false): DecidirTipoDteResultado =>
    ({ tipoDte, tipoDteAuto, conflictoMarcaCartola, fuente });

  if (!puedePersistirTipo) return r(null, "salida_o_no_boletar");
  if (!esVentaCandidata || !auto) return r(null, "no_venta");
  // Incidente 2026-09-24: una categoría EXENTA por naturaleza jamás nace 39.
  if (esExentoPorTipo(i.tipoBase)) return r(41, "categoria_exenta");
  // Precedencia: la regla de usuario manda; el emisor exento se fuerza a 41.
  if (i.reglaTipoDte === 39 || i.reglaTipoDte === 41) {
    if (i.emisorExento) return r(41, i.reglaTipoDte === 39 ? "regla_forzada_exenta" : "regla");
    // La marca de la cartola (P2P/forex, exenta por ley) protege contra una regla 39
    // vieja: no se emite afecta ni se adivina exenta → a revisar.
    if (i.reglaTipoDte === 39 && !i.reglaConfirmadaEnMarca && esHintExentoPorLey(i.docHint)) {
      return r(null, "conflicto_marca_cartola", true);
    }
    return r(i.reglaTipoDte, "regla");
  }
  return r(tipoDteAuto, `auto_${auto.motivo}`);
}

/** Pre-stageo: banda ALTA del visor. */
export const AUTO_STAGE_THRESHOLD = 0.85;

/**
 * Estado con el que NACE una propuesta. "listo" (staged, NO emitido) solo si:
 *  - viene de una regla REAL (regla_id) con confianza ≥ AUTO_STAGE_THRESHOLD, y
 *  - su destino es una VENTA (boleta/factura): un sobregiro / no_comercial / gasto de
 *    una regla global nunca nace "listo" (no hay nada que emitir; debe juzgarse), y
 *  - no hubo conflicto entre la regla y la marca de la cartola.
 */
export function decidirEstadoInicial(i: {
  confianza: number | null;
  reglaId: string | null | undefined;
  tipoPropuesto: string;
  conflictoMarcaCartola?: boolean;
}): "listo" | "pendiente" {
  return i.confianza != null
    && i.confianza >= AUTO_STAGE_THRESHOLD
    && i.reglaId != null
    && esVentaEmitible(i.tipoPropuesto)
    && !i.conflictoMarcaCartola
    ? "listo"
    : "pendiente";
}
