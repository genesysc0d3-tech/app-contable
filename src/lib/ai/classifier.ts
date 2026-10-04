import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MovimientoExtraido, PropuestaExtraida } from "./types";
import { CONFIANZA_MAX_A_PRUEBA, CONFIANZA_MAX_EN_DISPUTA, esEstadoRegla, type EstadoRegla } from "./regla-evidencia";

/**
 * Deterministic rules-based classifier.
 *
 * Runs BEFORE OpenCode in the bypass path. For each movimiento, tries to
 * match a user rule (empresa_id set) first, then a global rule
 * (empresa_id NULL), in order of `prioridad` ascending. First match wins.
 *
 * Movimientos that don't match any rule are returned in `noClasificados`
 * for OpenCode to handle as a fallback. OpenCode-classified propuestas are
 * then capped at confianza ≤ 0.75 by the processor so they always land
 * in the "requires review" bucket — protecting the user from silent
 * OpenCode mistakes that could matter for SII compliance.
 */

export interface ClasificacionRegla {
  id: string;
  empresa_id: string | null;
  nombre: string;
  patron: string;
  patron_tipo: "contains" | "regex" | "starts_with" | "exact";
  tipo_flujo_match: "entrada" | "salida" | null;
  tipo_propuesto: string;
  receptor_nombre_default: string | null;
  receptor_rut_default: string | null;
  confianza: number;
  prioridad: number;
  /**
   * DTE recordado de una decisión humana (39 afecta / 41 exenta / null = no
   * forzar). Solo las reglas de USUARIO lo aprovechan: cuando matchean, la
   * propuesta nace con tipo_dte persistido y el gate la manda directo a
   * "listas" en vez de rebotar a Check (ver aprender-regla.ts).
   */
  tipo_dte: number | null;
  /** Desempate final del orden determinista (más antigua primero). */
  created_at?: string | null;
  /**
   * Estado con historial (Fase 3, regla-evidencia.ts). Sin valor = firme (las reglas
   * de antes). Las globales son firmes siempre.
   */
  estado?: string | null;
  /** Regla 39 confirmada por una persona sobre cartola P2P/forex (reemplaza la confianza 0.99). */
  aprendida_bajo_marca?: boolean | null;
}

/** Estado EFECTIVO de una regla para clasificar: global → firme; sin estado → firme. */
export function estadoEfectivo(r: Pick<ClasificacionRegla, "empresa_id" | "estado">): EstadoRegla {
  if (!r.empresa_id) return "firme";
  return esEstadoRegla(r.estado) ? r.estado : "firme";
}

/**
 * ORDEN DETERMINISTA de las reglas (antes lo decidía Postgres en los empates de
 * `prioridad`: dos reglas con la misma prioridad podían ganar distinto entre
 * corridas). Se ordena EN CÓDIGO, siempre igual:
 *   1. regla de usuario (empresa_id) antes que global (seed);
 *   2. prioridad ascendente (menor número = manda);
 *   3. patrón más largo primero (más específico);
 *   4. created_at ascendente (la más antigua);
 *   5. id (desempate total).
 * No muta la entrada.
 */
export function ordenarReglas<T extends Pick<ClasificacionRegla, "empresa_id" | "prioridad" | "patron" | "id"> & { created_at?: string | null }>(
  reglas: readonly T[],
): T[] {
  return [...reglas].sort((a, b) => {
    const ua = a.empresa_id ? 0 : 1;
    const ub = b.empresa_id ? 0 : 1;
    if (ua !== ub) return ua - ub;
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    const la = (a.patron ?? "").length;
    const lb = (b.patron ?? "").length;
    if (la !== lb) return lb - la;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface ClassifierResult {
  clasificados: Array<{
    movimiento_index: number;
    propuesta: PropuestaExtraida;
    regla_id: string;
    fuente: "regla_usuario" | "regla_global";
    /**
     * tipo_dte a persistir en la propuesta. Solo != null para reglas de
     * usuario que lo recordaron; las globales (seed) lo dejan null para no
     * cambiar su comportamiento (el gate sigue decidiendo por ellas).
     * Una regla en_disputa tampoco estampa (null).
     */
    tipo_dte: number | null;
    /** Estado efectivo de la regla (a_prueba → la fila nace pendiente, ver decidirEstadoInicial). */
    regla_estado: EstadoRegla;
    /** La regla 39 fue confirmada en una cartola P2P/forex: no se vuelve a preguntar. */
    regla_bajo_marca: boolean;
  }>;
  noClasificados: Array<{
    movimiento_index: number;
    movimiento: MovimientoExtraido;
  }>;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

/**
 * Load active rules for an empresa (user rules + global rules), en el orden
 * determinista de `ordenarReglas` (usuario > global, prioridad, largo, antigüedad, id).
 */
export async function loadReglas(empresaId: string): Promise<ClasificacionRegla[]> {
  try {
    const sb = getServiceClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from("clasificacion_reglas")
      .select("*")
      .or(`empresa_id.eq.${empresaId},empresa_id.is.null`)
      .eq("activa", true)
      .order("prioridad", { ascending: true });
    // (activa=false ya excluye deshechas y huérfanas: lo exige un CHECK de la base;
    // classifyWithRules igual las salta si llegaran.)
    if (error || !data) return [];
    return ordenarReglas(data as ClasificacionRegla[]);
  } catch {
    return [];
  }
}

/**
 * Test whether a movimiento matches a rule. Case-insensitive for contains/
 * starts_with/exact. Regex uses the `i` flag.
 */
export function ruleMatches(
  mov: MovimientoExtraido,
  rule: ClasificacionRegla
): boolean {
  // Flow must match if the rule specifies one
  if (rule.tipo_flujo_match && rule.tipo_flujo_match !== mov.tipo_flujo) {
    return false;
  }
  const desc = (mov.descripcion ?? "").trim();
  if (!desc) return false;

  switch (rule.patron_tipo) {
    case "contains":
      return desc.toLowerCase().includes(rule.patron.toLowerCase());
    case "starts_with":
      return desc.toLowerCase().startsWith(rule.patron.toLowerCase());
    case "exact":
      return desc.toLowerCase() === rule.patron.toLowerCase();
    case "regex":
      try {
        return new RegExp(rule.patron, "i").test(desc);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Derive a receptor name from a movimiento description when the rule doesn't
 * specify a default. For P2P transfers we take whatever follows "TRANSFER DE"
 * or "TRANSFER A" as the counterparty name. Simple heuristic, not exhaustive.
 */
function inferReceptorNombre(mov: MovimientoExtraido): string | null {
  const desc = (mov.descripcion ?? "").trim();
  // Alineado con el patrón de la regla global P2P: las glosas reales dicen
  // "Transferencia recibida de NOMBRE" y el regex viejo exigía la forma
  // abreviada "TRANSF DE" → 0/160 receptores extraídos en la auditoría
  // cerebro 2026-09-02, incluso sobre 135 UF donde la identidad es obligatoria.
  const m = desc.match(/\btransf(?:er(?:encia)?)?\.?\s+(?:recibida\s+|enviada\s+)?(?:de|a|desde|para)\s+([A-ZÁÉÍÓÚÑ].+)/i);
  if (m && m[1]) return m[1].trim();
  return null;
}

/**
 * Build a propuesta from a matched rule + movimiento. Sets confianza, total,
 * and receptor fields. Always forces total = monto so numeric integrity is
 * preserved.
 */
function buildPropuestaFromRule(
  mov: MovimientoExtraido,
  movIndex: number,
  rule: ClasificacionRegla
): PropuestaExtraida {
  const receptor_nombre =
    rule.receptor_nombre_default ?? inferReceptorNombre(mov);
  const total = mov.monto;
  // IVA SOLO en factura afecta. La boleta de honorarios (BHE) NO lleva IVA: su
  // total es el bruto y el impuesto asociado es una RETENCIÓN que retiene el
  // pagador, no IVA — computarle IVA 19% contradice la ley (antes se incluía acá,
  // partía mal el neto/iva de toda propuesta de honorarios).
  const hasIva = rule.tipo_propuesto === "factura_afecta";
  const monto_neto = hasIva ? Math.round(total / 1.19) : total;
  const iva = hasIva ? total - monto_neto : 0;

  return {
    movimiento_index: movIndex,
    tipo_propuesto: rule.tipo_propuesto as PropuestaExtraida["tipo_propuesto"],
    receptor_nombre,
    receptor_rut: rule.receptor_rut_default,
    monto_neto,
    iva,
    total,
    confianza: rule.confianza,
    // notas = detalle IMPRIMIBLE en la boleta (máxima precedencia en resolverGlosa).
    // NO metemos el nombre de la regla acá: sobre el umbral de identificación se
    // imprimiría en el DTE y la regla aprendida lleva el nombre de la contraparte
    // (tercero) → fuga de datos (misma clase que cerró PR #56). Sin nota, la glosa
    // cae a la glosa común de la cartola o al genérico. El humano puede escribir
    // su propio detalle después.
    notas: null,
    spread_compra: null,
    spread_venta: null,
    spread_ganancia: null,
  };
}

/**
 * Sufijos societarios chilenos (conjunto cerrado por ley): si la contraparte de
 * una transferencia es una persona JURÍDICA, NORMALMENTE corresponde factura.
 * DOCTRINA (fundador 2026-09-02): esto es un DISCLAIMER, jamás un cambio de
 * estado — la propuesta queda BOLETA tal como salió de la regla, y la señal
 * viaja como advertencia ignorable (triángulo en Emitir). Si el clasificador
 * se equivoca (un spa de masajes, un apellido raro), ignorarlo cuesta CERO
 * clicks; boletear a una empresa es legal y decisión del emisor.
 * Caso real de la auditoría: 26 transferencias de "M & E SpA".
 */
export const SUFIJO_SOCIETARIO = /\b(spa|ltda\.?|limitada|eirl|e\.i\.r\.l\.?|s\.a\.?)(?=[\s,.]|$)/i;

/**
 * Classify a batch of movimientos using the loaded rules.
 *
 * For each movimiento, the first matching rule (orden de `ordenarReglas`)
 * wins. Movimientos without any matching rule go to `noClasificados`.
 */
export function classifyWithRules(
  movimientos: MovimientoExtraido[],
  reglas: ClasificacionRegla[]
): ClassifierResult {
  const clasificados: ClassifierResult["clasificados"] = [];
  const noClasificados: ClassifierResult["noClasificados"] = [];
  // Orden determinista en código: el que llama puede pasar las reglas en cualquier
  // orden y gana siempre la misma.
  // Una deshecha/huérfana nunca clasifica (la base ya las apaga; defensa en profundidad).
  const ordenadas = ordenarReglas(reglas).filter((r) => {
    const e = estadoEfectivo(r);
    return e !== "deshecha" && e !== "huerfana";
  });

  for (let i = 0; i < movimientos.length; i++) {
    const mov = movimientos[i];
    const matchingRule = ordenadas.find((r) => ruleMatches(mov, r));
    if (matchingRule) {
      const propuesta = buildPropuestaFromRule(mov, i, matchingRule);
      const estado = estadoEfectivo(matchingRule);
      // Fase 3: una regla NUEVA (a_prueba) todavía no se ganó el "listo" automático:
      // la fila nace con el tipo pre-estampado pero bajo el umbral de auto-stage (0.85)
      // → pendiente; "Poner listas" (≥0.8) la toma. En disputa: ni tipo ni bulk.
      if (estado === "a_prueba") propuesta.confianza = Math.min(propuesta.confianza ?? 0, CONFIANZA_MAX_A_PRUEBA);
      if (estado === "en_disputa") propuesta.confianza = Math.min(propuesta.confianza ?? 0, CONFIANZA_MAX_EN_DISPUTA);
      clasificados.push({
        movimiento_index: i,
        propuesta,
        regla_id: matchingRule.id,
        fuente: matchingRule.empresa_id ? "regla_usuario" : "regla_global",
        // Solo las reglas de usuario (empresa_id set) auto-pasan a listas con el
        // tipo recordado. Las globales dejan tipo_dte null → el gate decide.
        tipo_dte: matchingRule.empresa_id && estado !== "en_disputa" ? (matchingRule.tipo_dte ?? null) : null,
        regla_estado: estado,
        regla_bajo_marca: Boolean(matchingRule.empresa_id) && matchingRule.aprendida_bajo_marca === true,
      });
    } else {
      noClasificados.push({ movimiento_index: i, movimiento: mov });
    }
  }

  return { clasificados, noClasificados };
}

/**
 * Suma veces_aplicada (y last_used_at) de las reglas que clasificaron. ATÓMICO en la
 * base (rpc incrementar_uso_reglas, migración 20261005120000): antes era leer-y-
 * escribir por regla y dos cartolas en paralelo se pisaban la cuenta. Un id repetido N
 * veces suma N. Best-effort: un fallo acá no afecta la clasificación.
 */
export async function incrementRuleUsage(reglaIds: string[]): Promise<void> {
  if (reglaIds.length === 0) return;
  try {
    const sb = getServiceClient();
    if (!sb) return;
    await sb.rpc("incrementar_uso_reglas", { p_regla_ids: reglaIds });
  } catch {
    /* non-blocking */
  }
}

/**
 * Reglas SOBRE lo que extrajo la IA (carril texto/OCR, sin parser).
 *
 * Incidente 2026-09-23: dos cartolas BancoEstado cayeron al carril de
 * extracción; DeepSeek escribió la glosa ("Abono por transferencia de X") y las
 * clasificó FACTURA AFECTA por el giro de la empresa. Esa glosa calzaba con las
 * reglas globales de transferencias, pero en ese carril las reglas nunca corrían.
 * Misma precedencia que el carril con parser: regla > IA para el TIPO. El receptor
 * lo pone la IA si lo identificó (en este carril ya leyó el documento entero; la
 * regla solo recorta la glosa), si no, el de la regla.
 */
export type ReglaAplicada = {
  regla_id: string;
  fuente: "regla_usuario" | "regla_global";
  tipo_dte: number | null;
  regla_estado: EstadoRegla;
  regla_bajo_marca: boolean;
};

export function reclasificarConReglas(
  movimientos: MovimientoExtraido[],
  propuestas: PropuestaExtraida[],
  reglas: ClasificacionRegla[],
): { propuestas: PropuestaExtraida[]; reglaPorIndex: Map<number, ReglaAplicada> } {
  const reglaPorIndex = new Map<number, ReglaAplicada>();
  if (reglas.length === 0 || movimientos.length === 0) return { propuestas, reglaPorIndex };
  const { clasificados } = classifyWithRules(movimientos, reglas);
  if (clasificados.length === 0) return { propuestas, reglaPorIndex };
  const porIndex = new Map(clasificados.map((c) => [c.movimiento_index, c]));
  const out = propuestas.map((p) => {
    const c = porIndex.get(p.movimiento_index);
    if (!c) return p;
    reglaPorIndex.set(p.movimiento_index, {
      regla_id: c.regla_id, fuente: c.fuente, tipo_dte: c.tipo_dte,
      regla_estado: c.regla_estado, regla_bajo_marca: c.regla_bajo_marca,
    });
    return {
      ...c.propuesta,
      receptor_nombre: p.receptor_nombre ?? c.propuesta.receptor_nombre ?? null,
      receptor_rut: p.receptor_rut ?? c.propuesta.receptor_rut ?? null,
    };
  });
  return { propuestas: out, reglaPorIndex };
}
