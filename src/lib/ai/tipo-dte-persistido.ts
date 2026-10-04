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
import { decidirTipoDteAuto, type ClasificacionResult, type DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { esExentoPorTipo, esVentaEmitible } from "@/lib/sii/destino";

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
}

const HINTS_EXENTOS_POR_LEY: ReadonlySet<string> = new Set(["p2p_cripto", "forex_divisas"]);

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
  const tipoDteAuto: 39 | 41 | null = !esVentaCandidata
    ? null
    : decidirTipoDteAuto(i.clasif, { docHint: i.docHint, tipoContribuyente: i.tipoContribuyente });

  if (!esVentaCandidata) return { tipoDte: null, tipoDteAuto, conflictoMarcaCartola: false };
  // Incidente 2026-09-24: una categoría EXENTA por naturaleza jamás nace 39.
  if (esExentoPorTipo(i.tipoBase)) return { tipoDte: 41, tipoDteAuto, conflictoMarcaCartola: false };
  // Precedencia: la regla de usuario manda; el emisor exento se fuerza a 41.
  if (i.reglaTipoDte === 39 || i.reglaTipoDte === 41) {
    if (i.emisorExento) return { tipoDte: 41, tipoDteAuto, conflictoMarcaCartola: false };
    // La marca de la cartola (P2P/forex, exenta por ley) protege contra una regla 39
    // vieja: no se emite afecta ni se adivina exenta → a revisar.
    if (i.reglaTipoDte === 39 && i.docHint != null && HINTS_EXENTOS_POR_LEY.has(i.docHint)) {
      return { tipoDte: null, tipoDteAuto, conflictoMarcaCartola: true };
    }
    return { tipoDte: i.reglaTipoDte, tipoDteAuto, conflictoMarcaCartola: false };
  }
  return { tipoDte: tipoDteAuto, tipoDteAuto, conflictoMarcaCartola: false };
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
